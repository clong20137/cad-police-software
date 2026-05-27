import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
  Radio,
  Send,
  Shield,
  Siren,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runtimeConfig } from '../config/runtimeConfig';
import { authClient } from '../services/authClient';
import { Incident, IncidentUnitStatus, User } from '../types/auth';

interface OfficerGoogleMaps {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: GoogleMarkerOptions) => GoogleMarkerInstance;
  LatLngBounds: new () => GoogleLatLngBoundsInstance;
}

interface GoogleMapInstance {
  setCenter: (location: { lat: number; lng: number }) => void;
  fitBounds: (bounds: GoogleLatLngBoundsInstance) => void;
}

interface GoogleMarkerOptions {
  position: { lat: number; lng: number };
  map: GoogleMapInstance;
  title?: string;
  label?: string;
  icon?: Record<string, unknown>;
}

interface GoogleMarkerInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleLatLngBoundsInstance {
  extend: (location: { lat: number; lng: number }) => void;
}

const liveLocationHeartbeatMs = 5000;
const liveLocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000
};

const priorityClasses: Record<Incident['priority'], string> = {
  Low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Normal: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  High: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Emergency: 'bg-red-600 text-white'
};

const statusClasses: Record<IncidentUnitStatus, string> = {
  Assigned: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  'En Route': 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  'On Scene': 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
  Cleared: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800'
};

const formatTime = (value: Date | string): string =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const navigationUrl = (incident: Incident): string => {
  const destination = incident.lat && incident.lon ? `${incident.lat},${incident.lon}` : incident.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
};

const getMyUnitStatus = (incident: Incident, userId?: string): IncidentUnitStatus | null =>
  incident.units.find((unit) => unit.userId === userId)?.status || null;

export const OfficerDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<'starting' | 'live' | 'blocked' | 'error'>('starting');
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const latestLocationRef = useRef<{ lat: number; lon: number; speedMph?: number | null } | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapInstance | null>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapMarkersRef = useRef<GoogleMarkerInstance[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const assignedIncidents = useMemo(
    () => incidents.filter((incident) => incident.units.some((unit) => unit.userId === user?.id && unit.status !== 'Cleared')),
    [incidents, user?.id]
  );
  const selectedIncident = assignedIncidents.find((incident) => incident.id === selectedIncidentId) || assignedIncidents[0] || null;
  const selectedStatus = selectedIncident ? getMyUnitStatus(selectedIncident, user?.id) : null;

  const loadIncidents = useCallback(async () => {
    const activeIncidents = await authClient.getIncidents();
    setIncidents(activeIncidents);
  }, []);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    const token = authClient.getAccessToken();
    if (!token) return;

    const socket = io(runtimeConfig.socketUrl, {
      transports: ['websocket', 'polling'],
      auth: { token }
    });
    socketRef.current = socket;
    socket.on('incidents:update', (nextIncidents: Incident[]) => setIncidents(nextIncidents));
    socket.on('units:update', (units: User[]) => {
      const me = units.find((unit) => unit.id === user?.id);
      if (me?.speedMph !== undefined) {
        setCurrentSpeed(Number(me.speedMph));
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationState('blocked');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const speedMph =
          position.coords.speed === null || position.coords.speed === undefined
            ? null
            : Math.max(0, position.coords.speed * 2.23694);
        latestLocationRef.current = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          speedMph
        };
        setCurrentLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
        setCurrentSpeed(speedMph);
        setLocationState('live');
      },
      () => setLocationState('error'),
      liveLocationOptions
    );

    const heartbeat = window.setInterval(async () => {
      const nextLocation = latestLocationRef.current;
      if (!nextLocation) return;
      try {
        await authClient.updateLocation(nextLocation.lat, nextLocation.lon, nextLocation.speedMph);
        setLocationState('live');
      } catch {
        setLocationState('error');
      }
    }, liveLocationHeartbeatMs);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
    };
  }, []);

  useEffect(() => {
    if (!runtimeConfig.googleMapsApiKey) {
      return;
    }

    if (window.google?.maps) {
      setMapReady(true);
      return;
    }

    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => setMapReady(true), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${runtimeConfig.googleMapsApiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapReady(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    const googleMaps = window.google?.maps as unknown as OfficerGoogleMaps | undefined;
    if (!mapReady || !googleMaps || !mapElementRef.current) {
      return;
    }

    if (mapInstanceRef.current && mapHostRef.current === mapElementRef.current) {
      return;
    }

    mapHostRef.current = mapElementRef.current;
    mapInstanceRef.current = new googleMaps.Map(mapElementRef.current, {
      center: currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lon } : { lat: 39.7684, lng: -86.1581 },
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
  }, [currentLocation, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const googleMaps = window.google?.maps as unknown as OfficerGoogleMaps | undefined;
    if (!map || !googleMaps) {
      return;
    }

    mapMarkersRef.current.forEach((marker) => marker.setMap(null));
    mapMarkersRef.current = [];
    const bounds = new googleMaps.LatLngBounds();

    if (currentLocation) {
      const location = { lat: currentLocation.lat, lng: currentLocation.lon };
      bounds.extend(location);
      mapMarkersRef.current.push(
        new googleMaps.Marker({
          position: location,
          map,
          title: 'My location',
          icon: {
            path: 0,
            scale: 9,
            fillColor: '#16a34a',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3
          }
        })
      );
      map.setCenter(location);
    }

    assignedIncidents.forEach((incident) => {
      if (incident.lat === undefined || incident.lon === undefined) {
        return;
      }
      const location = { lat: incident.lat, lng: incident.lon };
      bounds.extend(location);
      mapMarkersRef.current.push(
        new googleMaps.Marker({
          position: location,
          map,
          title: `${incident.callNumber} ${incident.type}`,
          label: incident.priority === 'Emergency' ? '!' : ''
        })
      );
    });

    if (currentLocation || assignedIncidents.some((incident) => incident.lat !== undefined && incident.lon !== undefined)) {
      map.fitBounds(bounds);
    }
  }, [assignedIncidents, currentLocation]);

  const updateStatus = async (status: IncidentUnitStatus) => {
    if (!selectedIncident) return;
    setBusy(true);
    setMessage('');
    try {
      const updated = await authClient.updateMyIncidentStatus(selectedIncident.id, status);
      setIncidents((current) => current.map((incident) => (incident.id === updated.id ? updated : incident)));
      setMessage(`Status updated to ${status}.`);
    } catch {
      setMessage('Unable to update status for this call.');
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!selectedIncident || !noteBody.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await authClient.addMyIncidentNote(selectedIncident.id, noteBody);
      await loadIncidents();
      setNoteBody('');
      setMessage('Note added.');
    } catch {
      setMessage('Unable to add note.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cad-blue text-white">
              <Shield size={20} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-500 dark:text-slate-400">
                {user?.cadUnitNumber || user?.unitNumber || user?.badge || 'Patrol Unit'}
              </p>
              <h1 className="truncate text-lg font-bold">{user?.name || 'Officer Console'}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Location</p>
                <p className="mt-1 text-sm font-semibold">
                  {locationState === 'live' ? 'Live tracking active' : locationState === 'starting' ? 'Starting GPS' : 'Location needs attention'}
                </p>
              </div>
              {locationState === 'live' ? <Wifi className="text-emerald-500" size={22} /> : <WifiOff className="text-amber-500" size={22} />}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-950">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Speed</p>
                <p className="mt-1 text-xl font-bold">{currentSpeed === null ? '--' : Math.round(currentSpeed)} mph</p>
              </div>
              <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-950">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Assigned</p>
                <p className="mt-1 text-xl font-bold">{assignedIncidents.length}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">My Calls</h2>
              <ClipboardList size={18} className="text-slate-500" />
            </div>
            <div className="max-h-[52vh] overflow-auto p-2">
              {assignedIncidents.length === 0 && (
                <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                  No assigned calls.
                </div>
              )}
              {assignedIncidents.map((incident) => {
                const status = getMyUnitStatus(incident, user?.id);
                const selected = selectedIncident?.id === incident.id;
                return (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() => setSelectedIncidentId(incident.id)}
                    className={`mb-2 w-full rounded-md border p-3 text-left transition ${
                      selected
                        ? 'border-cad-blue bg-blue-50 dark:border-blue-500 dark:bg-blue-950'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{incident.callNumber}</p>
                        <p className="truncate text-sm text-slate-600 dark:text-slate-300">{incident.type}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${priorityClasses[incident.priority]}`}>
                        {incident.priority}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{incident.address}</p>
                    {status && (
                      <span className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-bold ring-1 ${statusClasses[status]}`}>
                        {status}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {!selectedIncident ? (
            <div className="grid min-h-[70vh] grid-rows-[minmax(320px,1fr)_auto]">
              <OfficerMap
                mapElementRef={mapElementRef}
                hasGoogleKey={Boolean(runtimeConfig.googleMapsApiKey)}
                currentLocation={currentLocation}
              />
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <Radio size={42} className="text-slate-400" />
                <h2 className="mt-4 text-xl font-bold">No active assignment</h2>
                <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300">
                  Assigned calls will appear here with response controls, notes, navigation, and live map context.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[70vh] lg:grid-cols-[1fr_320px]">
              <div className="p-4 sm:p-6">
                <OfficerMap
                  mapElementRef={mapElementRef}
                  hasGoogleKey={Boolean(runtimeConfig.googleMapsApiKey)}
                  currentLocation={currentLocation}
                />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${priorityClasses[selectedIncident.priority]}`}>
                        {selectedIncident.priority}
                      </span>
                      {selectedStatus && (
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusClasses[selectedStatus]}`}>
                          {selectedStatus}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 text-2xl font-black">{selectedIncident.type}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {selectedIncident.callNumber} opened {formatTime(selectedIncident.createdAt)}
                    </p>
                  </div>
                  <a
                    href={navigationUrl(selectedIncident)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
                  >
                    <Navigation size={18} />
                    Navigate
                  </a>
                </div>

                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-start gap-3">
                    <MapPin size={20} className="mt-0.5 text-cad-blue" />
                    <div>
                      <p className="text-sm font-bold">{selectedIncident.address}</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {selectedIncident.description || 'No additional call details.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => updateStatus('En Route')}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <Siren size={18} />
                    En Route
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => updateStatus('On Scene')}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    <AlertTriangle size={18} />
                    On Scene
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => updateStatus('Cleared')}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 size={18} />
                    Clear
                  </button>
                </div>

                <div className="mt-5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-200" htmlFor="officer-note">
                    Add call note
                  </label>
                  <textarea
                    id="officer-note"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    rows={4}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                    placeholder="Add road-side update..."
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</p>
                    <button
                      type="button"
                      disabled={busy || !noteBody.trim()}
                      onClick={addNote}
                      className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-950"
                    >
                      <Send size={16} />
                      Send
                    </button>
                  </div>
                </div>
              </div>

              <aside className="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 lg:border-l lg:border-t-0">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Timeline</h3>
                <div className="mt-3 space-y-3">
                  {selectedIncident.notes.length === 0 && (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No notes yet.</p>
                  )}
                  {selectedIncident.notes.slice().reverse().map((note) => (
                    <div key={note.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">{note.userName || 'CAD'}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{formatTime(note.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">{note.body}</p>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </section>
      </section>

      <nav className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-cad-blue text-white" title="Map">
          <MapPin size={20} />
        </button>
        <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800" title="Messages">
          <MessageCircle size={20} />
        </button>
      </nav>
    </main>
  );
};

const OfficerMap: React.FC<{
  mapElementRef: React.RefObject<HTMLDivElement>;
  hasGoogleKey: boolean;
  currentLocation: { lat: number; lon: number } | null;
}> = ({ mapElementRef, hasGoogleKey, currentLocation }) => (
  <div className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800">
    {hasGoogleKey ? (
      <div ref={mapElementRef} className="h-[320px] w-full" />
    ) : (
      <div className="flex h-[320px] items-center justify-center bg-slate-900 p-6 text-center text-sm text-slate-300">
        Add REACT_APP_GOOGLE_API_KEY to show the live officer map.
      </div>
    )}
    <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white">
      <span>Live patrol map</span>
      <span>{currentLocation ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)}` : 'Waiting for GPS'}</span>
    </div>
  </div>
);
