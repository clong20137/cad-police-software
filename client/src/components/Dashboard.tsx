import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Layers,
  LogOut,
  MapPin,
  Radio,
  Settings,
  Shield,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authClient } from '../services/authClient';
import { UnitStatus, User } from '../types/auth';

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
        Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
        InfoWindow: new (options: Record<string, unknown>) => GoogleInfoWindowInstance;
      };
    };
  }
}

interface GoogleMapInstance {
  setCenter: (location: { lat: number; lng: number }) => void;
}

interface GoogleMarkerInstance {
  addListener: (eventName: string, callback: () => void) => void;
}

interface GoogleInfoWindowInstance {
  open: (options: { map: GoogleMapInstance; anchor: GoogleMarkerInstance }) => void;
}

type TrackedUnit = User & { lat: number; lon: number };

const statusStyles: Record<UnitStatus, string> = {
  Available: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Dispatched: 'bg-amber-50 text-amber-700 ring-amber-200',
  'En Route': 'bg-blue-50 text-blue-700 ring-blue-200',
  'On Scene': 'bg-red-50 text-red-700 ring-red-200',
  Transporting: 'bg-violet-50 text-violet-700 ring-violet-200'
};

const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
const realtimeUrl = process.env.REACT_APP_SOCKET_URL || apiUrl.replace(/\/api\/?$/, '');
const googleMapsApiKey =
  process.env.REACT_APP_GOOGLE_MAPS_API_KEY || process.env.REACT_APP_GOOGLE_API_KEY;

const isTrackedUnit = (user: User): user is TrackedUnit =>
  typeof user.lat === 'number' && typeof user.lon === 'number';

const displayStatus = (unit: User): UnitStatus => unit.status || 'Available';
const displayUnitNumber = (unit: User): string => unit.unitNumber || unit.badge || 'Unassigned';
const displayCadUnitNumber = (unit: User): string =>
  unit.cadUnitNumber || (unit.unitNumber ? `CAD-${unit.unitNumber}` : unit.name);
const splitName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || ''
  };
};

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [units, setUnits] = useState<TrackedUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationError, setLocationError] = useState<string>('');
  const [unitLoadError, setUnitLoadError] = useState<string>('');
  const mapRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || units[0] || null;
  const center = currentLocation || selectedUnit || { lat: 39.7684, lon: -86.1581 };

  const loadUnits = useCallback(async () => {
    try {
      const response = await authClient.getTrackedUnits();
      const trackedUnits = response.filter(isTrackedUnit);
      setUnits(trackedUnits);
      setUnitLoadError('');
      setSelectedUnitId((current) => {
        if (current && trackedUnits.some((unit) => unit.id === current)) {
          return current;
        }
        return trackedUnits[0]?.id || '';
      });
    } catch {
      setUnitLoadError('Unable to load tracked units.');
    }
  }, []);

  const statusCounts = useMemo(
    () =>
      units.reduce<Record<UnitStatus, number>>(
        (counts, unit) => ({
          ...counts,
          [displayStatus(unit)]: counts[displayStatus(unit)] + 1
        }),
        { Available: 0, Dispatched: 0, 'En Route': 0, 'On Scene': 0, Transporting: 0 }
      ),
    [units]
  );

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    const socket = io(realtimeUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true
    });

    socketRef.current = socket;
    socket.on('units:update', (nextUnits: User[]) => {
      const trackedUnits = nextUnits.filter(isTrackedUnit);
      setUnits(trackedUnits);
      setUnitLoadError('');
      setSelectedUnitId((current) => {
        if (current && trackedUnits.some((unit) => unit.id === current)) {
          return current;
        }
        return trackedUnits[0]?.id || '';
      });
    });
    socket.on('connect_error', () => {
      setUnitLoadError('Live unit stream unavailable. Retrying connection.');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Location unavailable');
      return;
    }

    const watcherId = navigator.geolocation.watchPosition(
      async (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        };
        setCurrentLocation(nextLocation);
        setLocationError('');

          try {
          const updatedUser = await authClient.updateLocation(nextLocation.lat, nextLocation.lon);
          if (isTrackedUnit(updatedUser)) {
            setUnits((currentUnits) => {
              const others = currentUnits.filter((unit) => unit.id !== updatedUser.id);
              return [updatedUser, ...others];
            });
            setSelectedUnitId((current) => current || updatedUser.id);
          }
        } catch {
          setLocationError('Location detected, but the server did not save it.');
        }
      },
      () => setLocationError('Allow browser location access to track your position.'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watcherId);
  }, [loadUnits]);

  useEffect(() => {
    if (!googleMapsApiKey || !mapRef.current) {
      return;
    }

    const scriptId = 'google-maps-script';
    const initializeMap = () => {
      if (!window.google?.maps || !mapRef.current) {
        return;
      }

      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: center.lat, lng: center.lon },
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true
      });

      units.forEach((unit) => {
        const marker = new window.google!.maps.Marker({
          map,
          position: { lat: unit.lat, lng: unit.lon },
          title: `${displayCadUnitNumber(unit)} ${displayStatus(unit)}`
        });
        const infoWindow = new window.google!.maps.InfoWindow({
          content: `<strong>${displayCadUnitNumber(unit)}</strong><br>${unit.name}<br>${displayStatus(unit)}`
        });
        marker.addListener('click', () => infoWindow.open({ map, anchor: marker }));
      });

      map.setCenter({ lat: center.lat, lng: center.lon });
    };

    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      initializeMap();
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}`;
    script.async = true;
    script.onload = initializeMap;
    document.head.appendChild(script);
  }, [center.lat, center.lon, units]);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-cad-ink">
      <header className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-cad-navy px-4 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((value) => !value)}
            className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label={sidebarOpen ? 'Collapse unit list' : 'Expand unit list'}
          >
            {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
          <div>
            <h1 className="text-xl font-semibold">CAD Dispatch</h1>
            <p className="text-xs text-slate-300">Live unit location dashboard</p>
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label="Settings"
          >
            <Settings size={19} />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-cad-line bg-white py-2 text-cad-ink shadow-xl">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="truncate text-sm font-semibold">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`shrink-0 overflow-hidden border-r border-cad-line bg-white transition-all duration-200 ${
            sidebarOpen ? 'w-80' : 'w-0'
          }`}
        >
          <div className="flex h-full w-80 flex-col">
            <div className="border-b border-cad-line p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">
                    Units
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">{units.length} tracked units</p>
                </div>
                <Users className="text-cad-blue" size={22} />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {units.length === 0 && (
                <div className="p-4 text-sm text-slate-600">
                  {unitLoadError || 'No users have shared a live location yet.'}
                </div>
              )}

              {units.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => setSelectedUnitId(unit.id)}
                  className={`w-full border-b border-slate-100 p-4 text-left transition hover:bg-slate-50 ${
                    selectedUnit?.id === unit.id ? 'bg-blue-50' : 'bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-bold">{displayCadUnitNumber(unit)}</p>
                      <p className="text-sm text-slate-600">{unit.name}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${
                        statusStyles[displayStatus(unit)]
                      }`}
                    >
                      {displayStatus(unit)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>
                      <dt className="font-semibold text-slate-500">Unit</dt>
                      <dd>{displayUnitNumber(unit)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">District</dt>
                      <dd>{unit.district || 'Unassigned'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Group</dt>
                      <dd>{unit.group || 'Unassigned'}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Location</dt>
                      <dd>
                        {unit.lat.toFixed(3)}, {unit.lon.toFixed(3)}
                      </dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <section className="grid h-full min-h-[760px] gap-4 xl:grid-cols-[1fr_420px]">
            <div className="flex min-h-0 flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard icon={<Radio size={18} />} label="Available" value={statusCounts.Available} />
                <MetricCard icon={<Shield size={18} />} label="Dispatched" value={statusCounts.Dispatched} />
                <MetricCard icon={<Layers size={18} />} label="En Route" value={statusCounts['En Route']} />
                <MetricCard icon={<MapPin size={18} />} label="On Scene" value={statusCounts['On Scene']} />
              </div>

              <div className="relative min-h-[520px] flex-1 overflow-hidden rounded-lg border border-cad-line bg-slate-900 shadow-control">
                {googleMapsApiKey ? (
                  <div ref={mapRef} className="h-full min-h-[520px] w-full" />
                ) : (
                  <FallbackMap
                    units={units}
                    selectedUnit={selectedUnit}
                    currentLocation={currentLocation}
                    onSelectUnit={(unit) => setSelectedUnitId(unit.id)}
                  />
                )}

                <div className="absolute left-4 top-4 rounded-lg border border-cad-line bg-white/95 p-3 shadow-control">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Crosshair size={16} className="text-cad-blue" />
                    Location Tracking
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {currentLocation
                      ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)}`
                      : locationError || 'Waiting for browser location'}
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 rounded-lg border border-cad-line bg-white shadow-control">
              <div className="border-b border-cad-line p-4">
                <h2 className="text-lg font-bold">Unit Detail</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedUnit ? `${displayCadUnitNumber(selectedUnit)} selected` : 'No tracked unit selected'}
                </p>
              </div>
              <div className="p-4">
                {selectedUnit ? (
                  <dl className="grid gap-3 text-sm">
                    <Detail label="Unit Number" value={displayUnitNumber(selectedUnit)} />
                    <Detail label="First Name" value={splitName(selectedUnit.name).firstName || 'N/A'} />
                    <Detail label="Last Name" value={splitName(selectedUnit.name).lastName || 'N/A'} />
                    <Detail label="CAD Unit Number" value={displayCadUnitNumber(selectedUnit)} />
                    <Detail label="Status" value={displayStatus(selectedUnit)} />
                    <Detail label="Group" value={selectedUnit.group || 'Unassigned'} />
                    <Detail label="District" value={selectedUnit.district || 'Unassigned'} />
                    <Detail label="Lat" value={selectedUnit.lat.toFixed(6)} />
                    <Detail label="Lon" value={selectedUnit.lon.toFixed(6)} />
                  </dl>
                ) : (
                  <p className="text-sm text-slate-600">
                    When a real user signs in and allows location access, they will appear here.
                  </p>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({
  icon,
  label,
  value
}) => (
  <div className="rounded-lg border border-cad-line bg-white p-4 shadow-control">
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      <span className="text-cad-blue">{icon}</span>
    </div>
    <p className="mt-3 text-3xl font-bold">{value}</p>
  </div>
);

const Detail: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 pb-3">
    <dt className="font-semibold text-slate-500">{label}</dt>
    <dd className="font-medium text-cad-ink">{value}</dd>
  </div>
);

const FallbackMap: React.FC<{
  units: TrackedUnit[];
  selectedUnit: TrackedUnit | null;
  currentLocation: { lat: number; lon: number } | null;
  onSelectUnit: (unit: TrackedUnit) => void;
}> = ({ units, selectedUnit, currentLocation, onSelectUnit }) => {
  const points = currentLocation
    ? [...units, { id: 'current-location', lat: currentLocation.lat, lon: currentLocation.lon }]
    : units;
  const minLat = Math.min(...points.map((point) => point.lat), 39.7);
  const maxLat = Math.max(...points.map((point) => point.lat), 39.85);
  const minLon = Math.min(...points.map((point) => point.lon), -86.25);
  const maxLon = Math.max(...points.map((point) => point.lon), -86.05);

  const position = (lat: number, lon: number) => ({
    left: `${((lon - minLon) / Math.max(maxLon - minLon, 0.01)) * 82 + 9}%`,
    top: `${(1 - (lat - minLat) / Math.max(maxLat - minLat, 0.01)) * 78 + 11}%`
  });

  return (
    <div className="relative h-full min-h-[520px] w-full overflow-hidden bg-[linear-gradient(90deg,rgba(148,163,184,.18)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,.18)_1px,transparent_1px)] bg-[size:48px_48px]">
      <div className="absolute inset-0 bg-slate-900/80" />
      <div className="absolute inset-x-8 top-1/2 h-1 -translate-y-1/2 bg-slate-500/50" />
      <div className="absolute left-1/2 top-8 h-[calc(100%-4rem)] w-1 -translate-x-1/2 bg-slate-500/50" />

      {units.map((unit) => (
        <button
          key={unit.id}
          type="button"
          onClick={() => onSelectUnit(unit)}
          className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold shadow-lg ring-2 ${
            selectedUnit?.id === unit.id
              ? 'bg-cad-blue text-white ring-white'
              : 'bg-white text-cad-ink ring-slate-300'
          }`}
          style={position(unit.lat, unit.lon)}
        >
          <span className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cad-blue/50 location-pulse" />
          <MapPin size={14} />
          {displayCadUnitNumber(unit)}
        </button>
      ))}

      {currentLocation && (
        <div
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-emerald-500 px-2 py-1 text-xs font-bold text-white shadow-lg ring-2 ring-white"
          style={position(currentLocation.lat, currentLocation.lon)}
        >
          <span className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-emerald-400/60 location-pulse" />
          <Crosshair size={14} />
          You
        </div>
      )}

      <div className="absolute bottom-4 right-4 rounded bg-white/90 px-3 py-2 text-xs font-medium text-slate-600">
        Add REACT_APP_GOOGLE_API_KEY or REACT_APP_GOOGLE_MAPS_API_KEY for Google Maps
      </div>
    </div>
  );
};
