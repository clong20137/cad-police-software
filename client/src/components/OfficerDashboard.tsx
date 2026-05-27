import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  GripVertical,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
  Radio,
  Send,
  Settings,
  Shield,
  Siren,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runtimeConfig } from '../config/runtimeConfig';
import { authClient } from '../services/authClient';
import { Incident, IncidentUnitStatus, User } from '../types/auth';

type DockItem = 'calls' | 'call-detail' | 'notes' | 'messages' | 'location' | 'settings' | 'navigation' | 'status';
type DockSlot = DockItem | null;

interface OfficerGoogleMaps {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: GoogleMarkerOptions) => GoogleMarkerInstance;
  LatLngBounds: new () => GoogleLatLngBoundsInstance;
}

interface GoogleMapInstance {
  setCenter: (location: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
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
  setPosition: (position: { lat: number; lng: number }) => void;
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

const dockItems: Array<{ id: DockItem; label: string; icon: React.ReactNode }> = [
  { id: 'calls', label: 'Calls', icon: <ClipboardList size={18} /> },
  { id: 'call-detail', label: 'Detail', icon: <Shield size={18} /> },
  { id: 'notes', label: 'Notes', icon: <Send size={18} /> },
  { id: 'messages', label: 'Messages', icon: <MessageCircle size={18} /> },
  { id: 'location', label: 'Location', icon: <MapPin size={18} /> },
  { id: 'navigation', label: 'Navigate', icon: <Navigation size={18} /> },
  { id: 'status', label: 'Status', icon: <Radio size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> }
];
const defaultDockSlots: DockSlot[] = ['calls', 'call-detail', 'notes', 'messages', 'location', 'navigation', 'status', 'settings'];

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
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [activeDockItem, setActiveDockItem] = useState<DockItem | null>(null);
  const [dockSlots, setDockSlots] = useState<DockSlot[]>(() => {
    const stored = localStorage.getItem('cad_officer_quick_slots');
    if (!stored) return defaultDockSlots;
    try {
      const parsed = JSON.parse(stored) as DockSlot[];
      return parsed.length === 8 ? parsed : defaultDockSlots;
    } catch {
      return defaultDockSlots;
    }
  });
  const [customizingSlot, setCustomizingSlot] = useState<number | null>(null);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const latestLocationRef = useRef<{ lat: number; lon: number; speedMph?: number | null } | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapInstance | null>(null);
  const selfMarkerRef = useRef<GoogleMarkerInstance | null>(null);
  const callMarkersRef = useRef<Record<string, GoogleMarkerInstance>>({});
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
    localStorage.setItem('cad_officer_quick_slots', JSON.stringify(dockSlots));
  }, [dockSlots]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDockItem(null);
        setCustomizingSlot(null);
        setChangePasswordOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    if (!runtimeConfig.googleMapsApiKey) return;
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
    if (!mapReady || !googleMaps || !mapElementRef.current || mapInstanceRef.current) return;

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
    if (!map || !googleMaps) return;

    const bounds = new googleMaps.LatLngBounds();
    let hasCallBounds = false;

    if (currentLocation) {
      const location = { lat: currentLocation.lat, lng: currentLocation.lon };
      if (selfMarkerRef.current) {
        selfMarkerRef.current.setPosition(location);
      } else {
        selfMarkerRef.current = new googleMaps.Marker({
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
        });
      }
    }

    const activeCallIds = new Set(assignedIncidents.map((incident) => incident.id));
    Object.entries(callMarkersRef.current).forEach(([incidentId, marker]) => {
      if (!activeCallIds.has(incidentId)) {
        marker.setMap(null);
        delete callMarkersRef.current[incidentId];
      }
    });

    assignedIncidents.forEach((incident) => {
      if (incident.lat === undefined || incident.lon === undefined) return;
      const location = { lat: incident.lat, lng: incident.lon };
      bounds.extend(location);
      hasCallBounds = true;
      if (callMarkersRef.current[incident.id]) {
        callMarkersRef.current[incident.id].setPosition(location);
        return;
      }
      callMarkersRef.current[incident.id] = new googleMaps.Marker({
          position: location,
          map,
          title: `${incident.callNumber} ${incident.type}`,
          label: incident.priority === 'Emergency' ? '!' : incident.callNumber.slice(-2)
        });
    });

    if (hasCallBounds) {
      if (currentLocation) bounds.extend({ lat: currentLocation.lat, lng: currentLocation.lon });
      map.fitBounds(bounds);
    } else if (currentLocation) {
      map.setCenter({ lat: currentLocation.lat, lng: currentLocation.lon });
      map.setZoom(15);
    }
  }, [assignedIncidents, currentLocation]);

  const recenterMap = () => {
    if (!currentLocation) return;
    mapInstanceRef.current?.setCenter({ lat: currentLocation.lat, lng: currentLocation.lon });
    mapInstanceRef.current?.setZoom(15);
  };

  const assignDockSlot = (index: number, value: DockSlot) => {
    setDockSlots((current) => current.map((slot, slotIndex) => (slotIndex === index ? value : slot)));
    setCustomizingSlot(null);
  };

  const swapDockSlots = (targetIndex: number) => {
    if (draggedSlotIndex === null || draggedSlotIndex === targetIndex) return;
    setDockSlots((current) => {
      const next = [...current];
      const source = next[draggedSlotIndex];
      next[draggedSlotIndex] = next[targetIndex];
      next[targetIndex] = source;
      return next;
    });
    setDraggedSlotIndex(null);
  };

  const openDockItem = (item: DockItem) => {
    if (item === 'settings') {
      setSettingsOpen(false);
    }
    setActiveDockItem(item);
  };

  const changePassword = async () => {
    if (passwordForm.newPassword.length < 12) {
      setPasswordMessage('New password must be at least 12 characters.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage('New passwords do not match.');
      return;
    }
    try {
      await authClient.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordMessage('Password updated.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch {
      setPasswordMessage('Unable to change password. Check your current password.');
    }
  };

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
      setNoteBody('');
      setMessage('Note added.');
    } catch {
      setMessage('Unable to add note.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative h-screen overflow-hidden bg-slate-950 text-slate-950 dark:text-white">
      <div className="absolute inset-0">
        {runtimeConfig.googleMapsApiKey ? (
          <div ref={mapElementRef} className="h-full w-full" />
        ) : (
          <FallbackOfficerMap
            currentLocation={currentLocation}
            assignedIncidents={assignedIncidents}
            currentUserLabel={user?.cadUnitNumber || user?.unitNumber || user?.badge || 'ME'}
          />
        )}
      </div>

      <header className="absolute left-0 right-0 top-0 z-30 flex min-h-16 items-center justify-between border-b border-slate-800 bg-cad-navy px-4 text-white shadow-xl">
        <div>
          <h1 className="text-xl font-semibold">Officer CAD</h1>
          <p className="text-xs text-slate-300">{user?.cadUnitNumber || user?.unitNumber || user?.badge || user?.name}</p>
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
            <div className="absolute right-0 z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-2 text-slate-950 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-white">
              <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                <p className="truncate text-sm font-semibold">{user?.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChangePasswordOpen(true);
                  setSettingsOpen(false);
                  setPasswordMessage('');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Lock size={16} />
                Change password
              </button>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <button
        type="button"
        onClick={recenterMap}
        className="absolute bottom-4 left-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-cad-blue shadow-xl backdrop-blur hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-200"
        title="My location"
      >
        <MapPin size={19} />
      </button>

      <button
        type="button"
        onClick={() => setLeftOpen((value) => !value)}
        className="absolute top-1/2 z-30 inline-flex h-12 w-8 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-slate-200 bg-white/95 text-slate-700 shadow-xl transition-all duration-300 dark:border-slate-700 dark:bg-slate-900/95 dark:text-white"
        style={{ left: leftOpen ? 'min(22rem, calc(100vw - 3rem))' : 0 }}
        title={leftOpen ? 'Collapse left panel' : 'Open left panel'}
      >
        {leftOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>

      <aside
        className={`absolute bottom-24 left-4 top-20 z-20 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
          leftOpen ? 'translate-x-0 opacity-100' : '-translate-x-[calc(100%+2rem)] opacity-0'
        }`}
      >
        <section className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Live Tracking</p>
              <p className="mt-1 text-sm font-semibold">
                {locationState === 'live' ? 'Active' : locationState === 'starting' ? 'Starting GPS' : 'Needs attention'}
              </p>
            </div>
            {locationState === 'live' ? <Wifi className="text-emerald-500" size={22} /> : <WifiOff className="text-amber-500" size={22} />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-900">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Speed</p>
              <p className="mt-1 text-xl font-bold">{currentSpeed === null ? '--' : Math.round(currentSpeed)} mph</p>
            </div>
            <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-900">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Calls</p>
              <p className="mt-1 text-xl font-bold">{assignedIncidents.length}</p>
            </div>
          </div>
        </section>

        <section className="min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">My Calls</h2>
            <ClipboardList size={17} className="text-slate-500" />
          </div>
          <div className="h-full overflow-auto p-2">
            {assignedIncidents.length === 0 && (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">No assigned calls.</p>
            )}
            {assignedIncidents.map((incident) => (
              <IncidentButton
                key={incident.id}
                incident={incident}
                selected={selectedIncident?.id === incident.id}
                status={getMyUnitStatus(incident, user?.id)}
                onClick={() => setSelectedIncidentId(incident.id)}
              />
            ))}
          </div>
        </section>
      </aside>

      <button
        type="button"
        onClick={() => setRightOpen((value) => !value)}
        className="absolute right-4 top-20 z-30 inline-flex h-9 w-12 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-700 shadow-xl transition dark:border-slate-700 dark:bg-slate-900/95 dark:text-white"
        title={rightOpen ? 'Collapse assignments' : 'Open assignments'}
      >
        <ChevronUp className={`transition-transform duration-300 ${rightOpen ? '' : 'rotate-180'}`} size={18} />
      </button>

      <aside
        className={`absolute right-4 top-32 z-20 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
          rightOpen ? 'translate-y-0 opacity-100' : '-translate-y-4 pointer-events-none opacity-0'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Active Assignments</h2>
          <span className="rounded-full bg-cad-blue px-2 py-1 text-xs font-bold text-white">{assignedIncidents.length}</span>
        </div>
        <div className="mt-3 grid gap-2">
          {assignedIncidents.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No active assignments.</p>}
          {assignedIncidents.map((incident) => (
            <button
              key={incident.id}
              type="button"
              onClick={() => setSelectedIncidentId(incident.id)}
              className="rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{incident.callNumber}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{incident.type}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${priorityClasses[incident.priority]}`}>{incident.priority}</span>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{incident.address}</p>
            </button>
          ))}
        </div>
      </aside>

      <QuickDock
        slots={dockSlots}
        activeItem={activeDockItem}
        onOpen={openDockItem}
        onCustomize={setCustomizingSlot}
        onDragStart={setDraggedSlotIndex}
        onDrop={swapDockSlots}
      />

      {activeDockItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/25 p-4 backdrop-blur-sm sm:items-center" onMouseDown={() => setActiveDockItem(null)}>
          <div
            className="w-full max-w-3xl origin-bottom animate-[dockModalIn_160ms_ease-out] rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{dockItems.find((item) => item.id === activeDockItem)?.label}</h2>
              <button type="button" onClick={() => setActiveDockItem(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              <DockContent
                activeItem={activeDockItem}
                incidents={assignedIncidents}
                selectedIncident={selectedIncident}
                selectedStatus={selectedStatus}
                currentLocation={currentLocation}
                currentSpeed={currentSpeed}
                locationState={locationState}
                currentUserId={user?.id}
                noteBody={noteBody}
                setNoteBody={setNoteBody}
                busy={busy}
                message={message}
                onSelectIncident={setSelectedIncidentId}
                onUpdateStatus={updateStatus}
                onAddNote={addNote}
                onLogout={logout}
              />
            </div>
          </div>
        </div>
      )}

      {customizingSlot !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCustomizingSlot(null);
          }}
        >
          <div
            className="w-full max-w-lg origin-bottom animate-[dockModalIn_220ms_ease-out] rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
              <h2 className="text-lg font-bold">Customize Slot {customizingSlot + 1}</h2>
              <button type="button" onClick={() => setCustomizingSlot(null)} className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {dockItems.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => assignDockSlot(customizingSlot, option.id)}
                  className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-blue-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="text-cad-blue">{option.icon}</span>
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => assignDockSlot(customizingSlot, null)}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <X size={18} className="text-slate-500" />
                Empty
              </button>
            </div>
          </div>
        </div>
      )}

      {changePasswordOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setChangePasswordOpen(false);
          }}
        >
          <div
            className="w-full max-w-md origin-center animate-[dockModalIn_120ms_ease-out] rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
              <h2 className="text-lg font-bold">Change Password</h2>
              <button type="button" onClick={() => setChangePasswordOpen(false)} className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 p-4">
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((value) => ({ ...value, currentPassword: event.target.value }))}
                placeholder="Current password"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((value) => ({ ...value, newPassword: event.target.value }))}
                placeholder="New password"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((value) => ({ ...value, confirmPassword: event.target.value }))}
                placeholder="Confirm new password"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              {passwordMessage && <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{passwordMessage}</p>}
              <button type="button" onClick={changePassword} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

const IncidentButton: React.FC<{
  incident: Incident;
  selected: boolean;
  status: IncidentUnitStatus | null;
  onClick: () => void;
}> = ({ incident, selected, status, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`mb-2 w-full rounded-md border p-3 text-left transition ${
      selected
        ? 'border-cad-blue bg-blue-50 dark:border-blue-500 dark:bg-blue-950'
        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900'
    }`}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{incident.callNumber}</p>
        <p className="truncate text-sm text-slate-600 dark:text-slate-300">{incident.type}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${priorityClasses[incident.priority]}`}>{incident.priority}</span>
    </div>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{incident.address}</p>
    {status && <span className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-bold ring-1 ${statusClasses[status]}`}>{status}</span>}
  </button>
);

const QuickDock: React.FC<{
  slots: DockSlot[];
  activeItem: DockItem | null;
  onOpen: (item: DockItem) => void;
  onCustomize: (index: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
}> = ({ slots, activeItem, onOpen, onCustomize, onDragStart, onDrop }) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
    <div className="pointer-events-auto grid grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 text-slate-950 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95 dark:text-white md:grid-cols-8">
      {slots.map((slot, index) => {
        const item = dockItems.find((option) => option.id === slot);
        return (
          <div
            key={`officer-quick-slot-${index}`}
            draggable
            onDragStart={() => onDragStart(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop(index)}
            className="relative flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-950 transition hover:border-blue-200 hover:bg-blue-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
          >
            <GripVertical className="absolute left-1 top-1 text-slate-400 dark:text-white/45" size={12} />
            <button
              type="button"
              onClick={() => (item ? onOpen(item.id) : onCustomize(index))}
              className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold ${
                activeItem === item?.id ? 'text-cad-blue dark:text-blue-200' : ''
              }`}
              aria-label={item ? `Open ${item.label}` : `Customize slot ${index + 1}`}
            >
              {item?.icon || <Settings size={18} />}
              <span className="max-w-full truncate px-1">{item?.label || 'Empty'}</span>
            </button>
            <button
              type="button"
              onClick={() => onCustomize(index)}
              className="absolute right-1 top-1 rounded bg-black/5 p-1 text-slate-500 hover:text-slate-950 dark:bg-white/10 dark:text-white/70 dark:hover:text-white"
              aria-label={`Customize slot ${index + 1}`}
            >
              <Settings size={11} />
            </button>
          </div>
        );
      })}
    </div>
  </div>
);

const DockContent: React.FC<{
  activeItem: DockItem;
  incidents: Incident[];
  selectedIncident: Incident | null;
  selectedStatus: IncidentUnitStatus | null;
  currentLocation: { lat: number; lon: number } | null;
  currentSpeed: number | null;
  locationState: string;
  currentUserId?: string;
  noteBody: string;
  setNoteBody: (value: string) => void;
  busy: boolean;
  message: string;
  onSelectIncident: (id: string) => void;
  onUpdateStatus: (status: IncidentUnitStatus) => void;
  onAddNote: () => void;
  onLogout: () => void;
}> = ({
  activeItem,
  incidents,
  selectedIncident,
  selectedStatus,
  currentLocation,
  currentSpeed,
  locationState,
  currentUserId,
  noteBody,
  setNoteBody,
  busy,
  message,
  onSelectIncident,
  onUpdateStatus,
  onAddNote,
  onLogout
}) => {
  if (activeItem === 'calls') {
    return (
      <div className="grid gap-2">
        {incidents.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No active assignments.</p>}
        {incidents.map((incident) => (
          <IncidentButton
            key={incident.id}
            incident={incident}
            selected={selectedIncident?.id === incident.id}
            status={getMyUnitStatus(incident, currentUserId)}
            onClick={() => onSelectIncident(incident.id)}
          />
        ))}
      </div>
    );
  }

  if (activeItem === 'call-detail' || activeItem === 'navigation') {
    if (!selectedIncident) return <p className="text-sm text-slate-600 dark:text-slate-300">No call selected.</p>;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${priorityClasses[selectedIncident.priority]}`}>{selectedIncident.priority}</span>
            <h3 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">{selectedIncident.type}</h3>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedIncident.callNumber} opened {formatTime(selectedIncident.createdAt)}</p>
          </div>
          <a href={navigationUrl(selectedIncident)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white">
            <Navigation size={18} />
            Navigate
          </a>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-sm font-bold">{selectedIncident.address}</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{selectedIncident.description || 'No additional call details.'}</p>
        </div>
      </div>
    );
  }

  if (activeItem === 'status') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Current status: {selectedStatus || 'No call selected'}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <StatusButton disabled={busy || !selectedIncident} onClick={() => onUpdateStatus('En Route')} icon={<Siren size={18} />} label="En Route" className="bg-blue-600 hover:bg-blue-700" />
          <StatusButton disabled={busy || !selectedIncident} onClick={() => onUpdateStatus('On Scene')} icon={<AlertTriangle size={18} />} label="On Scene" className="bg-red-600 hover:bg-red-700" />
          <StatusButton disabled={busy || !selectedIncident} onClick={() => onUpdateStatus('Cleared')} icon={<CheckCircle2 size={18} />} label="Clear" className="bg-emerald-600 hover:bg-emerald-700" />
        </div>
        {message && <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</p>}
      </div>
    );
  }

  if (activeItem === 'notes') {
    return (
      <div className="space-y-4">
        <textarea
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          placeholder="Add road-side update..."
        />
        <button type="button" disabled={busy || !noteBody.trim() || !selectedIncident} onClick={onAddNote} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">
          <Send size={16} />
          Add note
        </button>
        {selectedIncident?.notes.slice().reverse().map((note) => (
          <div key={note.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{note.userName || 'CAD'}</span>
              <span className="text-xs text-slate-500">{formatTime(note.createdAt)}</span>
            </div>
            <p className="mt-1 text-slate-600 dark:text-slate-300">{note.body}</p>
          </div>
        ))}
      </div>
    );
  }

  if (activeItem === 'location') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Tracking" value={locationState === 'live' ? 'Active' : locationState} />
        <Metric label="Speed" value={currentSpeed === null ? '--' : `${Math.round(currentSpeed)} mph`} />
        <Metric label="Position" value={currentLocation ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)}` : 'Waiting'} />
      </div>
    );
  }

  if (activeItem === 'messages') {
    return <p className="text-sm text-slate-600 dark:text-slate-300">Messages stay live through the CAD message system. Officer message compose can be wired into this dock next.</p>;
  }

  return (
    <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white dark:bg-white dark:text-slate-950">
      <LogOut size={16} />
      Sign out
    </button>
  );
};

const StatusButton: React.FC<{
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className: string;
}> = ({ disabled, onClick, icon, label, className }) => (
  <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-bold text-white disabled:opacity-60 ${className}`}>
    {icon}
    {label}
  </button>
);

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-950">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-1 break-words text-lg font-black text-slate-950 dark:text-white">{value}</p>
  </div>
);

const FallbackOfficerMap: React.FC<{
  currentLocation: { lat: number; lon: number } | null;
  assignedIncidents: Incident[];
  currentUserLabel: string;
}> = ({ currentLocation, assignedIncidents, currentUserLabel }) => (
  <div className="relative h-full w-full overflow-hidden bg-slate-900">
    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:48px_48px]" />
    <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500 ring-4 ring-white shadow-xl" title={currentUserLabel} />
    <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/40 location-pulse" />
    {assignedIncidents.map((incident, index) => (
      <div
        key={incident.id}
        className="absolute rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white ring-2 ring-white shadow-xl"
        style={{ left: `${58 + (index % 4) * 7}%`, top: `${42 + (index % 3) * 10}%` }}
      >
        {incident.callNumber}
      </div>
    ))}
    <div className="absolute bottom-4 right-4 rounded-md bg-white/90 px-3 py-2 text-xs font-bold text-slate-700">
      {currentLocation ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)}` : 'Waiting for GPS'}
    </div>
  </div>
);
