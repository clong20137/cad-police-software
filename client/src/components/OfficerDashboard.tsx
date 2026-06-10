import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  Check,
  CheckCheck,
  ChevronUp,
  ClipboardList,
  Clock,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  Navigation,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  SmilePlus,
  Siren,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runtimeConfig } from '../config/runtimeConfig';
import { authClient } from '../services/authClient';
import { AdminConfigurationItem, ChatMessage, Incident, IncidentPriority, IncidentUnitStatus, MessageThread, SendMessageAttachment, UrgentAlert, User, UserRole } from '../types/auth';
import { ChangePasswordModal } from './common/ChangePasswordModal';
import { MessageAttachmentPreview } from './common/MessageAttachmentPreview';
import { ModalShell } from './common/ModalShell';
import { QuickLaunchDock, QuickLaunchSlot } from './common/QuickLaunchDock';
import { InquiryPanel, InquirySubmission } from './common/InquiryPanel';
import { ShieldSidebar, ShieldSidebarItem } from './common/ShieldSidebar';
import { UrgentAlertOverlay } from './common/UrgentAlertOverlay';
import { callTypesFromConfig } from '../utils/adminConfig';
import { geofenceAssignmentForPoint, geofencesFromConfig } from '../utils/mapGeofences';
import { APP_NAME } from '../constants/branding';

type DockItem = 'calls' | 'call-detail' | 'notes' | 'messages' | 'inquiries' | 'location' | 'settings' | 'navigation' | 'status';
type DockSlot = QuickLaunchSlot<DockItem>;
type RealtimeReadyPayload = { serverTime?: string; onlineUserIds?: string[] };
type PendingCallFeedRow = { incident: Incident; exiting: boolean };
type CallTabId = 'all' | 'my' | 'pending' | 'closed';
type LiveFeedItem = {
  id: string;
  at: Date | string;
  actor: string;
  action: string;
  detail: string;
  tone: 'blue' | 'green' | 'yellow' | 'red' | 'slate';
};

interface OfficerGoogleMaps {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  OverlayView: new () => GoogleOverlayViewInstance;
  LatLng: new (lat: number, lng: number) => GoogleLatLngInstance;
  Polyline: new (options: GooglePolylineOptions) => GooglePolylineInstance;
  Polygon: new (options: GooglePolygonOptions) => GooglePolygonInstance;
  LatLngBounds: new () => GoogleLatLngBoundsInstance;
  InfoWindow: new (options: { content: string }) => GoogleInfoWindowInstance;
  DirectionsService: new () => GoogleDirectionsServiceInstance;
  DirectionsRenderer: new (options: Record<string, unknown>) => GoogleDirectionsRendererInstance;
  TrafficLayer: new () => GoogleTrafficLayerInstance;
  TravelMode: { DRIVING: string };
}

interface GoogleMapInstance {
  setCenter: (location: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: GoogleLatLngBoundsInstance) => void;
  setOptions: (options: Record<string, unknown>) => void;
}

interface GoogleOverlayViewInstance {
  setMap: (map: GoogleMapInstance | null) => void;
  getPanes: () => { overlayMouseTarget: HTMLElement } | null;
  getProjection: () => {
    fromLatLngToDivPixel: (position: GoogleLatLngInstance) => { x: number; y: number } | null;
  };
}

interface GoogleLatLngInstance {}

interface GooglePolylineOptions {
  path: Array<{ lat: number; lng: number }>;
  geodesic?: boolean;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  map?: GoogleMapInstance;
}

interface GooglePolylineInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GooglePolygonOptions {
  paths: Array<{ lat: number; lng: number }>;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
  map?: GoogleMapInstance;
}

interface GooglePolygonInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleLatLngBoundsInstance {
  extend: (location: { lat: number; lng: number }) => void;
}

interface GoogleInfoWindowInstance {
  open: (options: { map: GoogleMapInstance; position: { lat: number; lng: number } }) => void;
}

interface GoogleDirectionsServiceInstance {
  route: (options: Record<string, unknown>, callback: (result: unknown, status: string) => void) => void;
}

interface GoogleDirectionsRendererInstance {
  setMap: (map: GoogleMapInstance | null) => void;
  setDirections: (result: unknown) => void;
}

interface GoogleTrafficLayerInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

type NavigationSummary = {
  callNumber: string;
  distance: string;
  duration: string;
  status: 'ready' | 'loading' | 'unavailable';
  traffic: 'clear' | 'moderate' | 'heavy' | 'unknown';
};

type WakeLockSentinel = {
  release: () => Promise<void>;
  addEventListener: (eventName: 'release', handler: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
  };
};

const liveLocationHeartbeatMs = 5000;
const liveLocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 1500,
  timeout: 15000
};
const usableGpsAccuracyMeters = 150;
const fallbackGpsAccuracyMeters = 300;

const dockItems: Array<{ id: DockItem; label: string; icon: React.ReactNode }> = [
  { id: 'calls', label: 'Calls', icon: <ClipboardList size={18} /> },
  { id: 'call-detail', label: 'Detail', icon: <Shield size={18} /> },
  { id: 'notes', label: 'Notes', icon: <Send size={18} /> },
  { id: 'messages', label: 'Messages', icon: <MessageCircle size={18} /> },
  { id: 'inquiries', label: 'Inquiries', icon: <Search size={18} /> },
  { id: 'location', label: 'Location', icon: <MapPin size={18} /> },
  { id: 'navigation', label: 'Navigate', icon: <Navigation size={18} /> },
  { id: 'status', label: 'Status', icon: <Radio size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> }
];
const defaultDockSlots: DockSlot[] = ['calls', 'call-detail', 'notes', 'messages', 'inquiries', 'location', 'status', 'settings'];
const emojiCatalog = (() => {
  const priorityEmoji = ['😀', '😂', '👍', '🙏', '🚓', '🚑', '🚒', '📍', '✅', '⚠', '❗'];
  const ranges = [
    [0x1f300, 0x1f5ff],
    [0x1f600, 0x1f64f],
    [0x1f680, 0x1f6ff],
    [0x1f900, 0x1f9ff],
    [0x2600, 0x27bf]
  ];
  const generated = ranges.flatMap(([start, end]) =>
    Array.from({ length: end - start + 1 }, (_, index) => String.fromCodePoint(start + index)).filter((emoji) =>
      /\p{Emoji}/u.test(emoji)
    )
  );
  return Array.from(new Set([...priorityEmoji, ...generated]));
})();

const priorityClasses: Record<Incident['priority'], string> = {
  Low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Normal: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  High: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Emergency: 'bg-red-600 text-white'
};

const incidentStatusClasses: Record<Incident['status'], string> = {
  Pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  Dispatched: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'En Route': 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  'On Scene': 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
  Closed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
  Canceled: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
};

const statusClasses: Record<IncidentUnitStatus, string> = {
  Assigned: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  'En Route': 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
  'On Scene': 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
  Transporting: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800',
  'At Hospital': 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-950 dark:text-cyan-200 dark:ring-cyan-800',
  Staged: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
  Loaded: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800',
  Delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
  Acknowledged: 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  Cleared: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800'
};

const markerToneClass = {
  green: 'bg-emerald-500 text-white ring-white',
  yellow: 'bg-amber-400 text-slate-950 ring-white',
  red: 'bg-red-600 text-white ring-white',
  blue: 'bg-cad-blue text-white ring-white'
};

const markerPulseClass = {
  green: 'bg-emerald-300/25',
  yellow: 'bg-amber-200/30',
  red: 'bg-red-400/25',
  blue: 'bg-blue-300/25'
};

const trafficIndicatorClasses: Record<NavigationSummary['traffic'], string> = {
  clear: 'bg-blue-500 text-white',
  moderate: 'bg-orange-500 text-white',
  heavy: 'bg-red-600 text-white',
  unknown: 'bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-100'
};

const trafficIndicatorLabels: Record<NavigationSummary['traffic'], string> = {
  clear: 'Clear',
  moderate: 'Moderate',
  heavy: 'Heavy',
  unknown: 'Traffic'
};

const darkMapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111827' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#263244' }] }
];

const formatTime = (value: Date | string): string =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatMessageTime = (value?: Date | string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const messageReactionOptions = [
  { key: 'thumbsUp', label: 'Thumbs up', icon: '👍' },
  { key: 'check', label: 'Check', icon: '✅' },
  { key: 'laugh', label: 'Laugh', icon: '😂' },
  { key: 'heart', label: 'Heart', icon: '❤️' },
  { key: 'eyes', label: 'Eyes', icon: '👀' }
] as const;

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const getMessageReactionForUser = (message: ChatMessage, userId?: string): string | null => {
  if (!userId) return null;
  return message.senderId === userId ? message.senderReaction || null : message.recipientReaction || null;
};

const getMessageReactionForOtherUser = (message: ChatMessage, userId?: string): string | null => {
  if (!userId) return null;
  return message.senderId === userId ? message.recipientReaction || null : message.senderReaction || null;
};

const getReactionIcon = (reaction?: string | null): string =>
  messageReactionOptions.find((option) => option.key === reaction)?.icon || '';

const deliveryLabel = (message: ChatMessage): string => (message.readAt ? 'Read' : 'Delivered');

const elapsedTimeLabel = (from?: Date | string, now = Date.now()): string => {
  if (!from) return '--';
  const timestamp = new Date(from).getTime();
  if (!Number.isFinite(timestamp)) return '--';
  const totalSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });

const officerMapLabel = (officer: User): string =>
  officer.cadUnitNumber || officer.unitNumber || officer.badge || officer.name.split(' ')[0] || 'Unit';

const unitDisplayName = (name?: string, unitNumber?: string): string =>
  [name, unitNumber].filter(Boolean).join(' ') || 'CAD';

const officerMapDisplayLabel = (officer: User): string => {
  const unit = officerMapLabel(officer);
  const lastName = officer.name.trim().split(/\s+/).filter(Boolean).slice(-1)[0] || officer.name;
  return `${unit} ${lastName}`.trim();
};

const officerMapStatus = (officer: User, currentUserId?: string, selectedStatus?: IncidentUnitStatus | null): string =>
  officer.id === currentUserId && selectedStatus ? selectedStatus : officer.status || 'Available';

const officerMapTone = (status: string, isCurrentUser: boolean): keyof typeof markerToneClass => {
  if (isCurrentUser) return 'blue';
  if (status === 'En Route') return 'yellow';
  if (['On Scene', 'Traffic Stop', 'Transporting', 'Dispatched', 'Busy', 'At Hospital', 'Staged'].includes(status)) return 'red';
  return 'green';
};

const distanceMiles = (fromLat: number, fromLon: number, toLat: number, toLon: number): number => {
  const earthRadiusMiles = 3958.8;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const etaText = (
  currentLocation: { lat: number; lon: number } | null,
  incident: Incident,
  speedMph: number | null
): string => {
  if (!currentLocation || incident.lat === undefined || incident.lon === undefined) return 'ETA pending';
  const miles = distanceMiles(currentLocation.lat, currentLocation.lon, incident.lat, incident.lon);
  if (!speedMph || speedMph <= 1) return `${miles.toFixed(1)} mi, ETA pending speed`;
  return `${miles.toFixed(1)} mi, ${Math.max(1, Math.round((miles / speedMph) * 60))} min ETA`;
};

const fallbackNavigationSummary = (
  currentLocation: { lat: number; lon: number } | null,
  incident: Incident,
  speedMph: number | null
): NavigationSummary | null => {
  if (!currentLocation || incident.lat === undefined || incident.lon === undefined) return null;
  const miles = distanceMiles(currentLocation.lat, currentLocation.lon, incident.lat, incident.lon);
  const minutes = speedMph && speedMph > 1 ? Math.max(1, Math.round((miles / speedMph) * 60)) : null;
  return {
    callNumber: incident.callNumber,
    distance: `${miles.toFixed(1)} mi`,
    duration: minutes ? `${minutes} min` : 'ETA pending',
    status: 'unavailable',
    traffic: 'unknown'
  };
};

const directionsNavigationSummary = (result: unknown, callNumber: string): NavigationSummary | null => {
  const routes = (result as {
    routes?: Array<{
      legs?: Array<{
        distance?: { text?: string };
        duration?: { text?: string; value?: number };
        duration_in_traffic?: { text?: string; value?: number };
      }>;
    }>;
  }).routes;
  const leg = routes?.[0]?.legs?.[0];
  if (!leg?.distance?.text || !leg?.duration?.text) return null;
  const durationValue = leg.duration?.value;
  const trafficDurationValue = leg.duration_in_traffic?.value;
  const trafficRatio = durationValue && trafficDurationValue ? trafficDurationValue / durationValue : 0;
  const traffic = trafficRatio >= 1.35 ? 'heavy' : trafficRatio >= 1.15 ? 'moderate' : trafficRatio > 0 ? 'clear' : 'unknown';
  return {
    callNumber,
    distance: leg.distance.text,
    duration: leg.duration_in_traffic?.text || leg.duration.text,
    status: 'ready',
    traffic
  };
};

const assignmentAgeMinutes = (incident: Incident, userId?: string): number => {
  const assignment = incident.units.find((unit) => unit.userId === userId);
  const timestamp = assignment?.statusUpdatedAt || assignment?.assignedAt;
  if (!timestamp) return 0;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 60000)) : 0;
};

const assignmentWarning = (incident: Incident | null, userId?: string): string => {
  if (!incident) return '';
  const status = getMyUnitStatus(incident, userId);
  const age = assignmentAgeMinutes(incident, userId);
  if (status === 'Assigned' && age >= 5) return `Assignment waiting acknowledgement for ${age} min`;
  if (status === 'Acknowledged' && age >= 10) return `Acknowledged ${age} min ago, not en route`;
  if (status === 'En Route' && age >= 20) return `En route for ${age} min`;
  return '';
};

const workflowStatuses = (incident: Incident | null): IncidentUnitStatus[] => {
  const type = `${incident?.type || ''}`.toLowerCase();
  if (type.includes('ems') || type.includes('medical') || type.includes('ambulance')) {
    return ['Acknowledged', 'En Route', 'On Scene', 'Transporting', 'At Hospital', 'Cleared'];
  }
  if (type.includes('fire') || type.includes('alarm') || type.includes('rescue')) {
    return ['Acknowledged', 'En Route', 'Staged', 'On Scene', 'Cleared'];
  }
  if (type.includes('tow') || type.includes('impound') || type.includes('vehicle')) {
    return ['Acknowledged', 'En Route', 'On Scene', 'Loaded', 'Delivered', 'Cleared'];
  }
  return ['Acknowledged', 'En Route', 'On Scene', 'Cleared'];
};

const getMyUnitStatus = (incident: Incident, userId?: string): IncidentUnitStatus | null =>
  incident.units.find((unit) => unit.userId === userId)?.status || null;

const callActionText = (type: string): string => {
  const normalized = type.toLowerCase();
  if (normalized.includes('traffic stop')) return 'is making a traffic stop';
  if (normalized.includes('assist')) return 'is requesting assistance';
  if (normalized.includes('pursuit')) return 'started a pursuit';
  return `created ${type}`;
};

const unitStatusActionText = (status: IncidentUnitStatus): string => {
  if (status === 'En Route') return 'is en route to';
  if (status === 'On Scene') return 'arrived at';
  if (status === 'Transporting') return 'is transporting from';
  if (status === 'At Hospital') return 'arrived at hospital for';
  if (status === 'Staged') return 'is staged for';
  if (status === 'Cleared') return 'cleared';
  if (status === 'Acknowledged') return 'acknowledged';
  return 'was assigned to';
};

const feedToneForStatus = (status: IncidentUnitStatus): LiveFeedItem['tone'] => {
  if (status === 'En Route') return 'yellow';
  if (['On Scene', 'Transporting', 'At Hospital', 'Staged'].includes(status)) return 'red';
  if (status === 'Cleared') return 'green';
  return 'blue';
};

const addOfficerOverlay = ({
  map,
  lat,
  lon,
  label,
  tone,
  sublabel,
  onClick
}: {
  map: GoogleMapInstance;
  lat: number;
  lon: number;
  label: string;
  tone: keyof typeof markerToneClass;
  sublabel?: string;
  onClick?: () => void;
}): GoogleOverlayViewInstance | null => {
  const googleMaps = window.google?.maps as unknown as OfficerGoogleMaps | undefined;
  if (!googleMaps) return null;

  const position = new googleMaps.LatLng(lat, lon);

  class OfficerOverlay extends googleMaps.OverlayView {
    private container: HTMLElement | null = null;

    onAdd() {
      const container = document.createElement(onClick ? 'button' : 'div');
      if (container instanceof HTMLButtonElement) container.type = 'button';
      container.className = label
        ? `absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full px-2 py-1 text-xs font-bold shadow-lg ring-2 ${markerToneClass[tone]}`
        : `absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-lg ring-2 ${markerToneClass[tone]}`;
      container.style.cursor = onClick ? 'pointer' : 'default';

      const pulse = document.createElement('span');
      pulse.className = `pointer-events-none absolute inset-0 -z-10 rounded-full ${markerPulseClass[tone]} location-pulse`;
      container.appendChild(pulse);

      const pin = document.createElement('span');
      pin.className = label ? 'h-3 w-3 shrink-0 rounded-full bg-current ring-2 ring-white/70' : 'h-3 w-3 rounded-full bg-current';
      container.appendChild(pin);

      if (label) {
        const text = document.createElement('span');
        text.textContent = label;
        container.appendChild(text);
      }

      if (sublabel) {
        const detail = document.createElement('span');
        detail.className = 'ml-1 rounded-full bg-black/15 px-1.5 py-0.5 text-[10px]';
        detail.textContent = sublabel;
        container.appendChild(detail);
      }

      if (onClick) container.addEventListener('click', onClick);
      this.container = container;
      this.getPanes()?.overlayMouseTarget.appendChild(container);
    }

    draw() {
      const point = this.getProjection().fromLatLngToDivPixel(position);
      if (!point || !this.container) return;
      this.container.style.left = `${point.x}px`;
      this.container.style.top = `${point.y}px`;
    }

    onRemove() {
      this.container?.remove();
      this.container = null;
    }
  }

  const overlay = new OfficerOverlay();
  overlay.setMap(map);
  return overlay;
};

export const OfficerDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [appSidebarCollapsed, setAppSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [exitingPendingCalls, setExitingPendingCalls] = useState<Incident[]>([]);
  const [adminConfig, setAdminConfig] = useState<AdminConfigurationItem[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<'starting' | 'live' | 'blocked' | 'error'>('starting');
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [lastRealtimeSync, setLastRealtimeSync] = useState<Date | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationTrail, setLocationTrail] = useState<Array<{ lat: number; lon: number; speedMph?: number | null }>>([]);
  const [mapReady, setMapReady] = useState(false);
  const [navigatingIncidentId, setNavigatingIncidentId] = useState<string | null>(null);
  const [navigationSummary, setNavigationSummary] = useState<NavigationSummary | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [activeDockItem, setActiveDockItem] = useState<DockItem | null>(null);
  const [openDockItems, setOpenDockItems] = useState<DockItem[]>([]);
  const [dockZOrder, setDockZOrder] = useState<Record<DockItem, number>>({} as Record<DockItem, number>);
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
  const [officerEvent, setOfficerEvent] = useState<{ type: string; priority: IncidentPriority; description: string }>({
    type: 'Traffic Stop',
    priority: 'Normal',
    description: ''
  });
  const [directory, setDirectory] = useState<User[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [selectedMessageUserId, setSelectedMessageUserId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageThreadSummaries, setMessageThreadSummaries] = useState<MessageThread[]>([]);
  const [messageBody, setMessageBody] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageTextSearch, setMessageTextSearch] = useState('');
  const [pinnedMessageThreadIds, setPinnedMessageThreadIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cad_officer_pinned_message_threads') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const [pendingAttachments, setPendingAttachments] = useState<SendMessageAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [emojiButton, setEmojiButton] = useState(() => emojiCatalog[Math.floor(Math.random() * emojiCatalog.length)] || '😀');
  const [typingByThread, setTypingByThread] = useState<Record<string, { name: string; expiresAt: number }>>({});
  const [messagePendingDelete, setMessagePendingDelete] = useState<ChatMessage | null>(null);
  const [threadPendingDeleteUserId, setThreadPendingDeleteUserId] = useState<string | null>(null);
  const [sidebarNow, setSidebarNow] = useState(() => Date.now());
  const [urgentAlerts, setUrgentAlerts] = useState<UrgentAlert[]>([]);
  const [messageBadgeCount, setMessageBadgeCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const latestLocationRef = useRef<{ lat: number; lon: number; speedMph?: number | null; accuracy?: number | null } | null>(null);
  const currentLocationRef = useRef<{ lat: number; lon: number } | null>(null);
  const uploadingLocationRef = useRef(false);
  const lastLocationUploadAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapInstance | null>(null);
  const mapOverlaysRef = useRef<GoogleOverlayViewInstance[]>([]);
  const mapPolygonsRef = useRef<GooglePolygonInstance[]>([]);
  const trailPolylineRef = useRef<GooglePolylineInstance | null>(null);
  const routeRendererRef = useRef<GoogleDirectionsRendererInstance | null>(null);
  const routeFallbackPolylineRef = useRef<GooglePolylineInstance | null>(null);
  const trafficLayerRef = useRef<GoogleTrafficLayerInstance | null>(null);
  const hasFitCallBoundsRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const selectedMessageUserIdRef = useRef('');
  const activeQuickModalRef = useRef<DockItem | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const dockZCounterRef = useRef(60);
  const pendingCallFeedPreviousRef = useRef<Map<string, Incident>>(new Map());
  const pendingCallExitTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  const pendingCalls = useMemo(
    () =>
      incidents
        .filter((incident) => incident.status === 'Pending')
        .sort((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()),
    [incidents]
  );
  const pendingCallFeedRows = useMemo<PendingCallFeedRow[]>(() => {
    const rows = [
      ...pendingCalls.map((incident) => ({ incident, exiting: false })),
      ...exitingPendingCalls.map((incident) => ({ incident, exiting: true }))
    ];
    return rows.sort((first, second) => new Date(second.incident.createdAt).getTime() - new Date(first.incident.createdAt).getTime());
  }, [exitingPendingCalls, pendingCalls]);
  const assignedIncidents = useMemo(
    () => incidents.filter((incident) => incident.units.some((unit) => unit.userId === user?.id && unit.status !== 'Cleared')),
    [incidents, user?.id]
  );
  const myActiveIncident = useMemo(
    () =>
      assignedIncidents
        .slice()
        .sort((first, second) => {
          const priorityRank: Record<IncidentPriority, number> = { Emergency: 0, High: 1, Normal: 2, Low: 3 };
          const priorityDelta = priorityRank[first.priority] - priorityRank[second.priority];
          if (priorityDelta !== 0) return priorityDelta;
          return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
        })[0] || null,
    [assignedIncidents]
  );
  const assignmentMapKey = assignedIncidents.map((incident) => incident.id).join(',');
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || assignedIncidents[0] || incidents[0] || null;
  const mapRouteIncident = incidents.find((incident) => incident.id === navigatingIncidentId) || null;
  const configuredCallTypes = useMemo(() => callTypesFromConfig(adminConfig), [adminConfig]);
  const configuredGeofences = useMemo(() => geofencesFromConfig(adminConfig), [adminConfig]);
  const selectedStatus = selectedIncident ? getMyUnitStatus(selectedIncident, user?.id) : null;
  const selectedAssignmentWarning = assignmentWarning(selectedIncident, user?.id);
  const trackedOfficers = useMemo(() => {
    const byId = new Map<string, User>();
    directory
      .filter((item) => onlineUserIds.includes(item.id) && item.lat !== undefined && item.lon !== undefined)
      .forEach((item) => byId.set(item.id, item));

    if (user && currentLocation) {
      byId.set(user.id, {
        ...user,
        lat: currentLocation.lat,
        lon: currentLocation.lon,
        speedMph: currentSpeed ?? user.speedMph,
        status: user.status || 'Available'
      });
    }

    return Array.from(byId.values());
  }, [currentLocation, currentSpeed, directory, onlineUserIds, user]);
  const liveFeedItems = useMemo<LiveFeedItem[]>(() => {
    const usersById = new Map(directory.map((item) => [item.id, item]));
    const items: LiveFeedItem[] = [];

    urgentAlerts.forEach((alert) => {
      items.push({
        id: `alert-${alert.id}`,
        at: alert.createdAt,
        actor: alert.createdByName || 'CAD',
        action: `sent a ${alert.severity.toLowerCase()} alert`,
        detail: alert.title,
        tone: alert.severity === 'Critical' || alert.severity === 'Urgent' ? 'red' : alert.severity === 'Important' ? 'yellow' : 'blue'
      });
    });

    incidents.forEach((incident) => {
      const creator = usersById.get(incident.createdBy);
      const firstUnit = incident.units[0];
      items.push({
        id: `call-${incident.id}`,
        at: incident.createdAt,
        actor: unitDisplayName(creator?.name || firstUnit?.name, creator?.cadUnitNumber || creator?.unitNumber || firstUnit?.cadUnitNumber),
        action: callActionText(incident.type),
        detail: `${incident.callNumber} ${incident.address || ''}`.trim(),
        tone: incident.priority === 'Emergency' || incident.priority === 'High' ? 'red' : incident.status === 'Pending' ? 'yellow' : 'blue'
      });

      incident.units.forEach((unit) => {
        items.push({
          id: `unit-${incident.id}-${unit.userId}-${unit.status}`,
          at: unit.statusUpdatedAt || unit.assignedAt,
          actor: unitDisplayName(unit.name, unit.cadUnitNumber),
          action: unitStatusActionText(unit.status),
          detail: `${incident.callNumber} ${incident.type}`.trim(),
          tone: feedToneForStatus(unit.status)
        });
      });

      incident.notes.slice(-3).forEach((note) => {
        items.push({
          id: `note-${note.id}`,
          at: note.createdAt,
          actor: note.userName || 'CAD',
          action: note.noteType === 'status' ? 'updated' : note.noteType === 'assignment' ? 'assigned units on' : 'added a note to',
          detail: `${incident.callNumber}${note.body ? ` - ${note.body}` : ''}`,
          tone: note.noteType === 'status' ? 'blue' : 'slate'
        });
      });
    });

    return items
      .filter((item) => item.at && !Number.isNaN(new Date(item.at).getTime()))
      .sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime())
      .slice(0, 8);
  }, [directory, incidents, urgentAlerts]);
  const realtimeStatusLabel =
    realtimeState === 'live'
      ? `Live${lastRealtimeSync ? ` - synced ${lastRealtimeSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
      : realtimeState === 'reconnecting'
        ? 'Reconnecting'
        : realtimeState === 'offline'
          ? 'Offline'
          : 'Connecting';
  const realtimeStatusClass =
    realtimeState === 'live'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-300/30'
      : realtimeState === 'offline'
        ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/20 dark:text-red-100 dark:ring-red-300/30'
        : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/20 dark:text-amber-100 dark:ring-amber-300/30';
  const selectedMessageUser = directory.find((item) => item.id === selectedMessageUserId) || null;
  const messageThreadByUser = useMemo(
    () =>
      messageThreadSummaries.reduce<Record<string, MessageThread>>((threads, thread) => {
        threads[thread.userId] = thread;
        return threads;
      }, {}),
    [messageThreadSummaries]
  );
  const messageThreads = directory.filter((item) => {
    if (item.id === user?.id) return false;
    return !messageSearch.trim() || `${item.name} ${item.email} ${item.cadUnitNumber || ''}`.toLowerCase().includes(messageSearch.toLowerCase());
  }).sort((first, second) => {
    const firstPinned = pinnedMessageThreadIds.includes(first.id);
    const secondPinned = pinnedMessageThreadIds.includes(second.id);
    if (firstPinned !== secondPinned) return firstPinned ? -1 : 1;
    const firstThread = messageThreadByUser[first.id];
    const secondThread = messageThreadByUser[second.id];
    return new Date(secondThread?.updatedAt || 0).getTime() - new Date(firstThread?.updatedAt || 0).getTime();
  });
  const searchedMessages = messages.filter(
    (message) =>
      !messageTextSearch.trim() ||
      message.body.toLowerCase().includes(messageTextSearch.toLowerCase()) ||
      message.attachments.some((attachment) => attachment.fileName.toLowerCase().includes(messageTextSearch.toLowerCase()))
  );
  const selectedTyping = selectedMessageUserId ? typingByThread[selectedMessageUserId] : null;
  const filteredEmojis = emojiCatalog.filter((emoji) => !emojiSearch.trim() || emoji.includes(emojiSearch.trim()));
  const sidebarItems: ShieldSidebarItem[] = [
    { id: 'cjis', label: 'CJIS', icon: Shield, iconClassName: 'text-blue-700', onClick: () => setActiveDockItem('inquiries') },
    { id: 'unit-status', label: 'Unit Status', icon: Radio, iconClassName: 'text-indigo-700', onClick: () => setActiveDockItem('status') },
    { id: 'calls', label: 'My Case', icon: ClipboardList, iconClassName: 'text-amber-700', onClick: () => setActiveDockItem('calls') },
    { id: 'messages', label: 'Messages', icon: MessageCircle, badge: messageBadgeCount, iconClassName: 'text-emerald-700', onClick: () => openDockItem('messages') },
    { id: 'protect', label: 'Protect Ord', icon: Search, iconClassName: 'text-red-700', onClick: () => setActiveDockItem('inquiries') }
  ];
  useEffect(() => {
    localStorage.setItem('cad_officer_pinned_message_threads', JSON.stringify(pinnedMessageThreadIds));
  }, [pinnedMessageThreadIds]);

  const togglePinnedMessageThread = (threadId: string) => {
    setPinnedMessageThreadIds((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [threadId, ...current]
    );
  };

  const loadIncidents = useCallback(async () => {
    const activeIncidents = await authClient.getIncidents();
    setIncidents(activeIncidents);
  }, []);

  const loadMessageThreads = useCallback(async () => {
    try {
      const threads = await authClient.getMessageThreads();
      setMessageThreadSummaries(threads);
      setMessageBadgeCount(threads.reduce((count, thread) => count + thread.unreadCount, 0));
    } catch {
      setMessageThreadSummaries([]);
    }
  }, []);

  const loadUrgentAlerts = useCallback(async () => {
    try {
      setUrgentAlerts(await authClient.getUrgentAlerts());
    } catch {
      setUrgentAlerts([]);
    }
  }, []);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    loadUrgentAlerts();
  }, [loadUrgentAlerts]);

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => setSidebarNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextPendingById = new Map(pendingCalls.map((incident) => [incident.id, incident]));
    const previousPendingById = pendingCallFeedPreviousRef.current;
    const leavingCalls = Array.from(previousPendingById.values()).filter((incident) => !nextPendingById.has(incident.id));

    if (leavingCalls.length > 0) {
      setExitingPendingCalls((current) => {
        const currentIds = new Set(current.map((incident) => incident.id));
        return [...current, ...leavingCalls.filter((incident) => !currentIds.has(incident.id))];
      });

      leavingCalls.forEach((incident) => {
        window.clearTimeout(pendingCallExitTimersRef.current[incident.id]);
        pendingCallExitTimersRef.current[incident.id] = window.setTimeout(() => {
          setExitingPendingCalls((current) => current.filter((item) => item.id !== incident.id));
          delete pendingCallExitTimersRef.current[incident.id];
        }, 360);
      });
    }

    pendingCallFeedPreviousRef.current = nextPendingById;
  }, [pendingCalls]);

  useEffect(
    () => () => {
      Object.values(pendingCallExitTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    },
    []
  );

  useEffect(() => {
    authClient.getActiveConfiguration().then(setAdminConfig).catch(() => setAdminConfig([]));
  }, []);

  useEffect(() => {
    if (!officerEvent.type && configuredCallTypes[0]) {
      setOfficerEvent((value) => ({
        ...value,
        type: configuredCallTypes[0].label,
        priority: configuredCallTypes[0].priority
      }));
    }
  }, [configuredCallTypes, officerEvent.type]);

  useEffect(() => {
    authClient.getDirectory().then(setDirectory).catch(() => setDirectory([]));
    loadMessageThreads();
  }, [loadMessageThreads]);

  useEffect(() => {
    selectedMessageUserIdRef.current = selectedMessageUserId;
  }, [selectedMessageUserId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingByThread((current) => {
        const entries = Object.entries(current).filter(([, value]) => value.expiresAt > now);
        return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    activeQuickModalRef.current = activeDockItem;
  }, [activeDockItem]);

  useEffect(() => {
    if (!activeDockItem) return;
    setOpenDockItems((current) => (current.includes(activeDockItem) ? current : [...current, activeDockItem]));
    dockZCounterRef.current += 1;
    setDockZOrder((current) => ({ ...current, [activeDockItem]: dockZCounterRef.current }));
  }, [activeDockItem]);

  const focusDockItem = useCallback((item: DockItem) => {
    dockZCounterRef.current += 1;
    setActiveDockItem(item);
    setDockZOrder((current) => ({ ...current, [item]: dockZCounterRef.current }));
  }, []);

  const closeDockItem = useCallback((item: DockItem) => {
    setOpenDockItems((current) => current.filter((dockItem) => dockItem !== item));
    setActiveDockItem((current) => {
      if (current !== item) return current;
      const remaining = openDockItems.filter((dockItem) => dockItem !== item);
      return remaining[remaining.length - 1] || null;
    });
  }, [openDockItems]);

  useEffect(() => {
    if (!selectedMessageUserId) {
      setMessages([]);
      return;
    }
    authClient.getMessages(selectedMessageUserId, messageTextSearch)
      .then((conversation) => {
        setMessages(conversation);
        loadMessageThreads();
      })
      .catch(() => setMessages([]));
  }, [loadMessageThreads, messageTextSearch, selectedMessageUserId]);

  useEffect(() => {
    localStorage.setItem('cad_officer_quick_slots', JSON.stringify(dockSlots));
  }, [dockSlots]);

  useEffect(() => {
    hasFitCallBoundsRef.current = false;
  }, [assignmentMapKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeDockItem) {
          closeDockItem(activeDockItem);
          return;
        }
        setCustomizingSlot(null);
        setChangePasswordOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDockItem, closeDockItem]);

  useEffect(() => {
    const token = authClient.getAccessToken();
    if (!token) return;

    const socket = io(runtimeConfig.socketUrl, {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000
    });
    socketRef.current = socket;
    setRealtimeState('connecting');
    const requestResync = (reason: string) => {
      socket.emit('client:resync', { reason, clientTime: new Date().toISOString() });
    };
    socket.on('connect', () => {
      setRealtimeState('live');
      requestResync('connect');
    });
    socket.io.on('reconnect_attempt', () => setRealtimeState('reconnecting'));
    socket.io.on('reconnect', () => {
      setRealtimeState('live');
      requestResync('reconnect');
    });
    socket.io.on('reconnect_error', () => setRealtimeState('reconnecting'));
    socket.io.on('reconnect_failed', () => setRealtimeState('offline'));
    socket.on('disconnect', () => setRealtimeState('offline'));
    socket.on('connect_error', () => setRealtimeState('reconnecting'));
    socket.on('realtime:ready', (payload: RealtimeReadyPayload = {}) => {
      setRealtimeState('live');
      setLastRealtimeSync(new Date());
      if (payload.onlineUserIds) {
        setOnlineUserIds(payload.onlineUserIds);
      }
    });
    socket.on('realtime:resynced', () => {
      setRealtimeState('live');
      setLastRealtimeSync(new Date());
    });
    socket.on('assignment:changed', () => requestResync('assignment-changed'));
    socket.on('incidents:update', (nextIncidents: Incident[]) => setIncidents(nextIncidents));
    socket.on('urgent-alerts:update', () => {
      loadUrgentAlerts();
      setMessage('Urgent alert received.');
    });
    socket.on('presence:update', (presence: { onlineUserIds: string[]; users: User[] }) => {
      setOnlineUserIds(presence.onlineUserIds || []);
      setDirectory(presence.users || []);
    });
    socket.on('units:update', (units: User[]) => {
      const me = units.find((unit) => unit.id === user?.id);
      if (me?.speedMph !== undefined) {
        setCurrentSpeed(Number(me.speedMph));
      }
    });
    socket.on('message:new', (message: ChatMessage) => {
      const belongsToMe = message.senderId === user?.id || message.recipientId === user?.id;
      if (!belongsToMe) return;

      const otherUserId = message.senderId === user?.id ? message.recipientId : message.senderId;
      const conversationOpen = activeQuickModalRef.current === 'messages' && otherUserId === selectedMessageUserIdRef.current;
      if (conversationOpen) {
        setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
        if (message.recipientId === user?.id) {
          authClient.markMessagesRead(otherUserId).catch(() => undefined);
        }
      } else if (message.recipientId === user?.id) {
        setMessageBadgeCount((count) => count + 1);
      }
      setMessageThreadSummaries((current) => {
        const existing = current.find((thread) => thread.userId === otherUserId);
        const nextThread: MessageThread = {
          userId: otherUserId,
          lastMessage: conversationOpen && message.recipientId === user?.id ? { ...message, readAt: new Date() } : message,
          unreadCount: message.recipientId === user?.id && !conversationOpen ? (existing?.unreadCount || 0) + 1 : existing?.unreadCount || 0,
          updatedAt: message.createdAt
        };
        return [nextThread, ...current.filter((thread) => thread.userId !== otherUserId)];
      });
    });
    socket.on('message:read', (receipt: { readerId: string; senderId: string; messageIds: string[] }) => {
      setMessageThreadSummaries((current) =>
        current.map((thread) =>
          receipt.readerId === user?.id && thread.userId === receipt.senderId ? { ...thread, unreadCount: 0 } : thread
        )
      );
      if (receipt.readerId === user?.id) {
        loadMessageThreads();
      }
      if (receipt.senderId !== user?.id) return;
      setMessages((current) =>
        current.map((message) =>
          receipt.messageIds.includes(message.id) ? { ...message, readAt: message.readAt || new Date() } : message
        )
      );
    });
    socket.on('message:update', (message: ChatMessage) => {
      setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
      setMessageThreadSummaries((current) =>
        current.map((thread) => thread.lastMessage?.id === message.id ? { ...thread, lastMessage: message } : thread)
      );
    });
    socket.on('message:deleted', (payload: { actorId: string; otherUserId: string; messageIds: string[] }) => {
      if (payload.actorId !== user?.id) return;
      setMessages((current) => current.filter((message) => !payload.messageIds.includes(message.id)));
      loadMessageThreads();
    });
    socket.on('message:typing', (payload: { actorId: string; typingThreadId?: string; name?: string; isTyping?: boolean }) => {
      if (!payload.actorId || payload.actorId === user?.id) return;
      const threadId = payload.typingThreadId || payload.actorId;
      setTypingByThread((current) => {
        const next = { ...current };
        if (payload.isTyping === false) {
          delete next[threadId];
        } else {
          next[threadId] = { name: payload.name || 'Someone', expiresAt: Date.now() + 3500 };
        }
        return next;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadMessageThreads, loadUrgentAlerts, user?.id]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationState('blocked');
      return;
    }

    const uploadLatestLocation = async (force = false) => {
      const nextLocation = latestLocationRef.current;
      if (!nextLocation || uploadingLocationRef.current) return;
      const now = Date.now();
      if (!force && now - lastLocationUploadAtRef.current < 2500) return;

      uploadingLocationRef.current = true;
      try {
        await authClient.updateLocation(nextLocation.lat, nextLocation.lon, nextLocation.speedMph);
        lastLocationUploadAtRef.current = now;
        setLocationState('live');
      } catch {
        if (!latestLocationRef.current) {
          setLocationState('error');
        }
      } finally {
        uploadingLocationRef.current = false;
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = position.coords.accuracy;
        const speedMph =
          position.coords.speed === null || position.coords.speed === undefined
            ? null
            : Math.max(0, position.coords.speed * 2.23694);
        const accuracyUsable = !Number.isFinite(accuracy) || accuracy <= usableGpsAccuracyMeters;
        const accuracyAcceptable = !Number.isFinite(accuracy) || accuracy <= fallbackGpsAccuracyMeters || !currentLocationRef.current;
        latestLocationRef.current = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          speedMph,
          accuracy
        };
        const nextLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
        setLocationAccuracy(Number.isFinite(accuracy) ? accuracy : null);
        if (accuracyAcceptable) {
          setCurrentLocation(nextLocation);
          setLocationTrail((current) => {
            const previous = current[current.length - 1];
            if (previous && distanceMiles(previous.lat, previous.lon, nextLocation.lat, nextLocation.lon) < 0.005) {
              return current;
            }
            return [...current, { ...nextLocation, speedMph }].slice(-80);
          });
        }
        setCurrentSpeed(speedMph);
        setLocationState(accuracyUsable ? 'live' : 'starting');
        if (accuracyUsable) uploadLatestLocation();
      },
      (error) => setLocationState(error.code === error.PERMISSION_DENIED ? 'blocked' : 'error'),
      liveLocationOptions
    );

    const heartbeat = window.setInterval(async () => {
      uploadLatestLocation(true);
    }, liveLocationHeartbeatMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        uploadLatestLocation(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    const requestWakeLock = async () => {
      const wakeLock = (navigator as WakeLockNavigator).wakeLock;
      if (!wakeLock || document.visibilityState !== 'visible') return;
      try {
        wakeLockRef.current = await wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch {
        wakeLockRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (!canceled && document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestWakeLock();
      }
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      canceled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
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
      fullscreenControl: false,
      styles: theme === 'dark' ? darkMapStyles : []
    });
  }, [currentLocation, mapReady, theme]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const googleMaps = window.google?.maps as unknown as OfficerGoogleMaps | undefined;
    if (!map || !googleMaps) return;

    map.setOptions({ styles: theme === 'dark' ? darkMapStyles : [] });
    mapOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
    mapOverlaysRef.current = [];
    mapPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
    mapPolygonsRef.current = [];
    trailPolylineRef.current?.setMap(null);
    trailPolylineRef.current = null;
    routeRendererRef.current?.setMap(null);
    routeRendererRef.current = null;
    routeFallbackPolylineRef.current?.setMap(null);
    routeFallbackPolylineRef.current = null;
    trafficLayerRef.current?.setMap(null);
    trafficLayerRef.current = null;

    const bounds = new googleMaps.LatLngBounds();
    let hasCallBounds = false;

    configuredGeofences.forEach((geofence) => {
      if (!googleMaps.Polygon) return;
      geofence.rings.forEach((ring) => {
        const polygon = new googleMaps.Polygon({
          paths: ring.map((point) => ({ lat: point.lat, lng: point.lon })),
          strokeColor: geofence.color,
          strokeOpacity: geofence.kind === 'beat' ? 0.85 : 0.7,
          strokeWeight: geofence.kind === 'beat' ? 2 : 3,
          fillColor: geofence.color,
          fillOpacity: geofence.kind === 'beat' ? 0.08 : 0.05,
          map
        });
        mapPolygonsRef.current.push(polygon);
      });
    });

    trackedOfficers.forEach((officer) => {
      if (officer.lat === undefined || officer.lon === undefined) return;
      const status = officerMapStatus(officer, user?.id, selectedStatus);
      const isCurrentUser = officer.id === user?.id;
      const tone = officerMapTone(status, isCurrentUser);
      const label = officerMapDisplayLabel(officer);
      const infoWindow = new googleMaps.InfoWindow({
        content: `
          <div style="min-width:190px;font-family:Arial,sans-serif;color:#0f172a">
            <div style="font-weight:700;margin-bottom:2px">${escapeHtml(officer.name)}</div>
            <div>Unit ${escapeHtml(officerMapLabel(officer))}</div>
            <div style="margin-top:4px;font-size:12px;color:#475569">${escapeHtml(status)}</div>
            <div style="font-size:12px;color:#475569">${officer.lat.toFixed(5)}, ${officer.lon.toFixed(5)}</div>
          </div>
        `
      });
      const overlay = addOfficerOverlay({
        map,
        lat: officer.lat,
        lon: officer.lon,
        label,
        tone,
        onClick: () => infoWindow.open({ map, position: { lat: officer.lat as number, lng: officer.lon as number } })
      });
      if (overlay) mapOverlaysRef.current.push(overlay);
    });

    if (currentLocation) {
      const selectedIsEnRoute = selectedStatus === 'En Route';
      if (selectedIsEnRoute && locationTrail.length > 1) {
        trailPolylineRef.current = new googleMaps.Polyline({
          path: locationTrail.map((point) => ({ lat: point.lat, lng: point.lon })),
          geodesic: true,
          strokeColor: '#f59e0b',
          strokeOpacity: 0.9,
          strokeWeight: 4,
          map
        });
      }
    }

    if (currentLocation && mapRouteIncident?.lat !== undefined && mapRouteIncident.lon !== undefined) {
      setNavigationSummary((current) => current?.callNumber === mapRouteIncident.callNumber ? current : {
        callNumber: mapRouteIncident.callNumber,
        distance: 'Calculating',
        duration: 'Calculating',
        status: 'loading',
        traffic: 'unknown'
      });
      trafficLayerRef.current = new googleMaps.TrafficLayer();
      trafficLayerRef.current.setMap(map);
      routeRendererRef.current = new googleMaps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: '#2563eb',
          strokeOpacity: 0.92,
          strokeWeight: 5
        }
      });
      const directionsService = new googleMaps.DirectionsService();
      directionsService.route(
        {
          origin: { lat: currentLocation.lat, lng: currentLocation.lon },
          destination: { lat: mapRouteIncident.lat, lng: mapRouteIncident.lon },
          travelMode: googleMaps.TravelMode.DRIVING,
          drivingOptions: {
            departureTime: new Date(),
            trafficModel: 'bestguess'
          }
        },
        (result, status) => {
          if (status === 'OK' && routeRendererRef.current) {
            routeRendererRef.current.setDirections(result);
            setNavigationSummary(directionsNavigationSummary(result, mapRouteIncident.callNumber) || fallbackNavigationSummary(currentLocation, mapRouteIncident, currentSpeed));
            return;
          }
          setNavigationSummary(fallbackNavigationSummary(currentLocation, mapRouteIncident, currentSpeed));
          routeFallbackPolylineRef.current = new googleMaps.Polyline({
            path: [
              { lat: currentLocation.lat, lng: currentLocation.lon },
              { lat: mapRouteIncident.lat as number, lng: mapRouteIncident.lon as number }
            ],
            geodesic: true,
            strokeColor: '#2563eb',
            strokeOpacity: 0.8,
            strokeWeight: 4,
            map
          });
        }
      );
    } else if (!mapRouteIncident) {
      setNavigationSummary(null);
    }

    assignedIncidents.forEach((incident) => {
      if (incident.lat === undefined || incident.lon === undefined) return;
      const location = { lat: incident.lat, lng: incident.lon };
      bounds.extend(location);
      hasCallBounds = true;
      mapOverlaysRef.current.push(
        ...[
          addOfficerOverlay({
            map,
            lat: incident.lat,
            lon: incident.lon,
            label: incident.callNumber,
            tone: incident.priority === 'Emergency' ? 'red' : 'blue',
            sublabel: etaText(currentLocation, incident, currentSpeed),
            onClick: () => {
              setSelectedIncidentId(incident.id);
              setActiveDockItem('call-detail');
            }
          })
        ].filter(Boolean) as GoogleOverlayViewInstance[]
      );
    });

    if (hasCallBounds && !hasFitCallBoundsRef.current) {
      if (currentLocation) bounds.extend({ lat: currentLocation.lat, lng: currentLocation.lon });
      map.fitBounds(bounds);
      hasFitCallBoundsRef.current = true;
    }
  }, [assignedIncidents, configuredGeofences, currentLocation, currentSpeed, locationTrail, mapRouteIncident, selectedStatus, theme, trackedOfficers, user?.id]);

  const recenterMap = () => {
    if (!currentLocation) return;
    mapInstanceRef.current?.setCenter({ lat: currentLocation.lat, lng: currentLocation.lon });
    mapInstanceRef.current?.setZoom(15);
  };

  const cancelNavigation = () => {
    setNavigatingIncidentId(null);
    setNavigationSummary(null);
    authClient.updateDestination(null, null, null).catch(() => undefined);
    routeRendererRef.current?.setMap(null);
    routeRendererRef.current = null;
    routeFallbackPolylineRef.current?.setMap(null);
    routeFallbackPolylineRef.current = null;
    trafficLayerRef.current?.setMap(null);
    trafficLayerRef.current = null;
  };

  const focusSelectedIncidentRoute = async () => {
    if (!selectedIncident) return;
    if (selectedIncident.lat === undefined || selectedIncident.lon === undefined) {
      setNavigationSummary({
        callNumber: selectedIncident.callNumber,
        distance: 'No map pin',
        duration: 'Unavailable',
        status: 'unavailable',
        traffic: 'unknown'
      });
      return;
    }

    setSelectedIncidentId(selectedIncident.id);
    setNavigatingIncidentId(selectedIncident.id);
    authClient
      .updateDestination(selectedIncident.lat, selectedIncident.lon, selectedIncident.callNumber)
      .catch(() => undefined);
    setNavigationSummary({
      callNumber: selectedIncident.callNumber,
      distance: 'Calculating',
      duration: 'Calculating',
      status: 'loading',
      traffic: 'unknown'
    });

    if (!currentLocation && navigator.geolocation) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, liveLocationOptions);
        });
        const speedMph =
          position.coords.speed === null || position.coords.speed === undefined
            ? null
            : Math.max(0, position.coords.speed * 2.23694);
        const nextLocation = { lat: position.coords.latitude, lon: position.coords.longitude, speedMph };
        latestLocationRef.current = nextLocation;
        setCurrentLocation({ lat: nextLocation.lat, lon: nextLocation.lon });
        setCurrentSpeed(speedMph);
      } catch {
        setNavigationSummary(fallbackNavigationSummary(currentLocation, selectedIncident, currentSpeed) || {
          callNumber: selectedIncident.callNumber,
          distance: 'Waiting for GPS',
          duration: 'Unavailable',
          status: 'unavailable',
          traffic: 'unknown'
        });
      }
    }

    mapInstanceRef.current?.setCenter({ lat: selectedIncident.lat, lng: selectedIncident.lon });
    mapInstanceRef.current?.setZoom(16);
    setActiveDockItem(null);
    setOpenDockItems((current) => current.filter((item) => item !== 'call-detail' && item !== 'navigation'));
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
    if (item === 'messages') {
      setMessageBadgeCount(0);
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
      if (status === 'Cleared') {
        if (navigatingIncidentId === selectedIncident.id) cancelNavigation();
        setSelectedIncidentId(null);
      }
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

  const createOfficerEvent = async () => {
    if (!officerEvent.type.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const geofenceAssignment = geofenceAssignmentForPoint(currentLocation, configuredGeofences);
      const incident = await authClient.createOfficerEvent({
        type: officerEvent.type,
        priority: officerEvent.priority,
        description: officerEvent.description,
        district: geofenceAssignment.district || null,
        beat: geofenceAssignment.beat || null,
        lat: currentLocation?.lat ?? null,
        lon: currentLocation?.lon ?? null,
        address: currentLocation ? `Officer location ${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)}` : undefined
      });
      setIncidents((current) => (current.some((item) => item.id === incident.id) ? current : [incident, ...current]));
      setSelectedIncidentId(incident.id);
      setOfficerEvent((value) => ({ ...value, description: '' }));
      setMessage(`${incident.type} started.`);
      setActiveDockItem('call-detail');
    } catch {
      setMessage('Unable to start officer event.');
    } finally {
      setBusy(false);
    }
  };

  const sendOfficerEmergency = async () => {
    setBusy(true);
    setMessage('');
    try {
      await authClient.sendOfficerEmergency(currentLocation?.lat ?? null, currentLocation?.lon ?? null);
      setMessage('Officer emergency alert sent.');
    } catch {
      setMessage('Unable to send officer emergency alert.');
    } finally {
      setBusy(false);
    }
  };

  const acknowledgeUrgentAlert = async (alertId: string) => {
    try {
      await authClient.acknowledgeUrgentAlert(alertId);
      setUrgentAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch {
      setMessage('Unable to acknowledge urgent alert.');
    }
  };

  const submitInquiry = async (submission: InquirySubmission) => {
    setBusy(true);
    setMessage('');
    try {
      const geofenceAssignment = geofenceAssignmentForPoint(currentLocation, configuredGeofences);
      const incident = await authClient.createOfficerEvent({
        type: submission.title,
        priority: 'Normal',
        description: submission.description,
        district: geofenceAssignment.district || null,
        beat: geofenceAssignment.beat || null,
        lat: currentLocation?.lat ?? null,
        lon: currentLocation?.lon ?? null,
        address: currentLocation
          ? `${submission.type} inquiry at ${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)}`
          : `${submission.type} ${submission.kind.toUpperCase()} inquiry`
      });
      setIncidents((current) => (current.some((item) => item.id === incident.id) ? current : [incident, ...current]));
      setSelectedIncidentId(incident.id);
      setMessage(`${submission.type} submitted.`);
      setActiveDockItem('call-detail');
    } catch {
      setMessage('Unable to submit inquiry.');
    } finally {
      setBusy(false);
    }
  };

  const updateMessageBody = (value: string) => {
    setMessageBody(value);
    if (!selectedMessageUserId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1600) {
      lastTypingSentRef.current = now;
      authClient.sendMessageTyping(selectedMessageUserId, true).catch(() => undefined);
    }
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => {
      authClient.sendMessageTyping(selectedMessageUserId, false).catch(() => undefined);
    }, 1800);
  };

  const reactToMessage = async (chatMessage: ChatMessage, reaction: string) => {
    const currentReaction = getMessageReactionForUser(chatMessage, user?.id);
    const nextReaction = currentReaction === reaction ? null : reaction;
    try {
      const updated = await authClient.reactToMessage(chatMessage.id, nextReaction);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setMessage('Unable to update message reaction.');
    }
  };

  const deleteChatMessage = async (chatMessage: ChatMessage) => {
    try {
      const messageIds = await authClient.deleteMessage(chatMessage.id);
      setMessages((current) => current.filter((item) => !messageIds.includes(item.id)));
      setMessagePendingDelete(null);
      loadMessageThreads();
    } catch {
      setMessage('Unable to delete message.');
    }
  };

  const deleteMessageThread = async (threadUserId: string) => {
    try {
      const messageIds = await authClient.deleteMessageThread(threadUserId);
      setMessages((current) => current.filter((item) => !messageIds.includes(item.id)));
      setThreadPendingDeleteUserId(null);
      if (selectedMessageUserId === threadUserId) setSelectedMessageUserId('');
      setPinnedMessageThreadIds((current) => current.filter((id) => id !== threadUserId));
      loadMessageThreads();
    } catch {
      setMessage('Unable to delete conversation.');
    }
  };

  const sendMessage = async () => {
    if (!selectedMessageUserId || (!messageBody.trim() && pendingAttachments.length === 0)) return;
    const tempId = `pending-${Date.now()}`;
    const draftBody = messageBody;
    const draftAttachments = pendingAttachments;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      senderId: user?.id || '',
      recipientId: selectedMessageUserId,
      body: draftBody,
      encrypted: true,
      attachments: draftAttachments.map((attachment, index) => ({
        id: `${tempId}-${index}`,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: 0,
        dataUrl: attachment.dataUrl
      })),
      createdAt: new Date(),
      deliveryStatus: 'sending'
    };
    setMessages((current) => [...current, optimisticMessage]);
    setMessageBody('');
    setPendingAttachments([]);
    setEmojiOpen(false);
    authClient.sendMessageTyping(selectedMessageUserId, false).catch(() => undefined);
    try {
      const sent = await authClient.sendMessage(selectedMessageUserId, draftBody, draftAttachments);
      setMessages((current) => current.map((message) => (message.id === tempId ? { ...sent, deliveryStatus: 'sent' } : message)));
      loadMessageThreads();
      setEmojiButton(emojiCatalog[Math.floor(Math.random() * emojiCatalog.length)] || '😀');
    } catch {
      setMessages((current) => current.map((message) => (message.id === tempId ? { ...message, deliveryStatus: 'failed' } : message)));
      setMessage('Unable to send message. Try again.');
    }
  };

  const handleAttachment = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const dataUrl = reader.result;
      setPendingAttachments((current) => [
        ...current,
        {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataUrl
        }
      ]);
    };
    reader.readAsDataURL(file);
  };

  const openMyActiveCall = (incident: Incident) => {
    setSelectedIncidentId(incident.id);
    setActiveDockItem('call-detail');
  };

  const renderMyActiveCall = (compact: boolean) => {
    const incident = myActiveIncident;
    if (compact) {
      return (
        <button
          type="button"
          onClick={() => (incident ? openMyActiveCall(incident) : setActiveDockItem('calls'))}
          className={`relative flex h-11 w-full items-center justify-center rounded transition ${
            incident ? 'bg-white text-cad-blue hover:bg-blue-50' : 'bg-white/10 text-blue-50 hover:bg-white/15'
          }`}
          title={incident ? `${incident.callNumber} ${incident.type}` : 'No active call'}
        >
          <ClipboardList size={19} />
          {assignedIncidents.length > 0 && (
            <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-cad-alert px-1 text-[10px] font-bold text-white">
              {assignedIncidents.length > 9 ? '9+' : assignedIncidents.length}
            </span>
          )}
        </button>
      );
    }

    if (!incident) {
      return (
        <section className="rounded border border-white/10 bg-white/10 p-2.5 text-white shadow-inner">
          <button
            type="button"
            onClick={() => setActiveDockItem('calls')}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-white/10"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white text-cad-blue">
              <ClipboardList size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-blue-100">My Active Call</span>
              <span className="block truncate text-xs text-blue-50">No active assignment</span>
            </span>
          </button>
        </section>
      );
    }

    const myAssignment = incident.units.find((unit) => unit.userId === user?.id);
    const status = myAssignment?.status || 'Assigned';
    return (
      <section className="rounded border border-white/10 bg-white p-2.5 text-cad-ink shadow-inner">
        <button
          type="button"
          onClick={() => openMyActiveCall(incident)}
          className="w-full rounded text-left transition hover:bg-blue-50"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">My Active Call</span>
              <span className="mt-1 block truncate text-sm font-black text-slate-950">{incident.callNumber}</span>
              <span className="block truncate text-xs font-bold text-cad-blue">{incident.type}</span>
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${priorityClasses[incident.priority]}`}>
              {incident.priority}
            </span>
          </span>
          <span className="mt-2 grid grid-cols-2 gap-1.5">
            <span className="rounded bg-slate-100 px-2 py-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Timer</span>
              <span className="block text-xs font-black">{elapsedTimeLabel(incident.createdAt, sidebarNow)}</span>
            </span>
            <span className="rounded bg-slate-100 px-2 py-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Status</span>
              <span className="block truncate text-xs font-black">{status}</span>
            </span>
          </span>
          <span className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <MapPin size={11} />
            <span className="truncate">{incident.address || 'Address pending'}</span>
          </span>
        </button>
      </section>
    );
  };

  const renderOfficerSidebarWidgets = (compact: boolean) => (
    <div className="grid gap-2">
      {renderMyActiveCall(compact)}
      {renderPendingCallFeed(compact)}
    </div>
  );

  const renderPendingCallFeed = (compact: boolean) => {
    if (compact) {
      return (
        <button
          type="button"
          onClick={() => setActiveDockItem('calls')}
          className="relative flex h-11 w-full items-center justify-center rounded bg-white/10 text-blue-50 transition hover:bg-white/15"
          title={`${pendingCalls.length} pending calls`}
        >
          <Siren size={19} />
          {pendingCalls.length > 0 && (
            <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-cad-alert px-1 text-[10px] font-bold text-white">
              {pendingCalls.length > 9 ? '9+' : pendingCalls.length}
            </span>
          )}
        </button>
      );
    }

    return (
      <section className="rounded border border-white/10 bg-white/10 p-2.5 text-white shadow-inner">
        <button
          type="button"
          onClick={() => setActiveDockItem('calls')}
          className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left transition hover:bg-white/10"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-400 text-slate-950">
              <Siren size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-blue-100">Pending Calls</span>
              <span className="block truncate text-xs text-blue-50">Live feed</span>
            </span>
          </span>
          <span className="rounded bg-white px-2 py-0.5 text-xs font-black text-cad-blue">{pendingCalls.length}</span>
        </button>

        <div className="mt-2 grid gap-1.5">
          {pendingCallFeedRows.length === 0 && (
            <div className="rounded bg-black/15 px-3 py-2 text-xs font-semibold text-blue-50">No pending calls</div>
          )}
          {pendingCallFeedRows.slice(0, 5).map(({ incident, exiting }) => (
            <button
              key={incident.id}
              type="button"
              onClick={() => {
                setSelectedIncidentId(incident.id);
                setActiveDockItem('calls');
              }}
              className={`pending-call-feed-item overflow-hidden rounded border text-left shadow-sm transition-all duration-300 ease-out ${
                exiting
                  ? 'max-h-0 -translate-y-1 border-transparent bg-white/0 px-3 py-0 opacity-0'
                  : 'max-h-24 translate-y-0 border-white/10 bg-white px-3 py-2 opacity-100 hover:bg-blue-50'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-black text-cad-ink">{incident.callNumber}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${
                    incident.priority === 'Emergency' || incident.priority === 'High'
                      ? 'bg-red-600 text-white'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {incident.priority}
                </span>
              </span>
              <span className="mt-1 block truncate text-xs font-bold text-slate-700">{incident.type}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <MapPin size={11} />
                <span className="truncate">{incident.address || 'Address pending'}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  };

  return (
    <main className={`dashboard-enter flex h-screen overflow-hidden ${theme === 'dark' ? 'dark bg-gray-950 text-white' : 'bg-gray-50 text-slate-950'}`}>
      <ShieldSidebar
        title={APP_NAME}
        subtitle="Officer"
        user={user}
        collapsed={appSidebarCollapsed}
        onToggleCollapsed={() => setAppSidebarCollapsed((value) => !value)}
        items={sidebarItems}
        bottomContent={renderOfficerSidebarWidgets(appSidebarCollapsed)}
        onProfile={() => setSettingsOpen(true)}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden bg-slate-950">
      <div className="absolute inset-0">
        {runtimeConfig.googleMapsApiKey ? (
          <div ref={mapElementRef} className="h-full w-full" />
        ) : (
          <FallbackOfficerMap
            currentLocation={currentLocation}
            assignedIncidents={assignedIncidents}
            currentUserLabel={user?.cadUnitNumber || user?.unitNumber || user?.badge || 'ME'}
            currentSpeed={currentSpeed}
          />
        )}
      </div>

      <div className="pointer-events-auto fixed right-3 top-3 z-40 flex select-none items-center gap-1.5 rounded-2xl border border-cad-line bg-white/90 p-2 text-cad-ink shadow-[0_16px_45px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:bg-slate-950/85 dark:text-white sm:right-5 sm:top-4 sm:gap-2">
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white shadow-sm ring-1 transition dark:border-slate-700 dark:bg-slate-800 ${realtimeStatusClass}`}
            title={realtimeStatusLabel}
            aria-label={`Realtime status: ${realtimeStatusLabel}`}
          >
            {realtimeState === 'offline' ? <WifiOff size={19} /> : <Wifi size={19} />}
          </span>
          <button
            type="button"
            onClick={sendOfficerEmergency}
            disabled={busy}
            className="flex h-10 w-10 items-center justify-center rounded border border-red-700 bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
            aria-label="Send officer emergency alert"
            title="Officer emergency"
          >
            <AlertTriangle size={19} />
          </button>
          <button
            type="button"
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
            className="flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100 dark:hover:bg-slate-700"
            aria-label="Toggle light dark mode"
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            type="button"
            onClick={() => setActiveDockItem('inquiries')}
            className="flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100 dark:hover:bg-slate-700"
            aria-label="Open inquiries"
            title="Inquiries"
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            className="flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100 dark:hover:bg-slate-700"
            aria-label="Settings"
          >
            <Settings size={19} />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-12 z-40 w-[calc(100vw-6.5rem)] max-w-64 origin-top-right rounded border border-slate-200 bg-white py-1 text-slate-950 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:w-64">
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
              {user?.role === UserRole.ADMIN && (
                <Link
                  to="/dashboard"
                  onClick={() => setSettingsOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Shield size={16} />
                  Dispatch Side
                </Link>
              )}
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

      <aside className="pointer-events-none fixed right-3 top-[4.75rem] z-30 w-[min(26rem,calc(100vw-1.5rem))] rounded-lg border border-white/40 bg-white/75 p-2 text-cad-ink opacity-90 shadow-xl dark:border-slate-700/70 dark:bg-slate-950/75 dark:text-white sm:right-5 sm:top-[5.25rem]">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Live Feed</span>
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]" />
        </div>
        <div className="grid max-h-56 gap-1 overflow-hidden">
          {liveFeedItems.length === 0 && (
            <div className="rounded bg-white/70 px-3 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
              Waiting for live CAD activity.
            </div>
          )}
          {liveFeedItems.map((item) => {
            const toneClass =
              item.tone === 'red'
                ? 'bg-red-500'
                : item.tone === 'yellow'
                  ? 'bg-amber-400'
                  : item.tone === 'green'
                    ? 'bg-emerald-500'
                    : item.tone === 'blue'
                      ? 'bg-cad-blue'
                      : 'bg-slate-400';
            return (
              <div key={item.id} className="grid grid-cols-[auto_1fr] gap-2 rounded border border-white/50 bg-white/70 px-3 py-2 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${toneClass}`} />
                <p className="min-w-0 leading-5 text-slate-700 dark:text-slate-200">
                  <strong className="font-black text-slate-950 dark:text-white">{item.actor}</strong>{' '}
                  <strong className="font-black text-cad-blue dark:text-blue-100">{item.action}</strong>{' '}
                  <span className="text-slate-600 dark:text-slate-300">{item.detail}</span>
                </p>
              </div>
            );
          })}
        </div>
      </aside>

      <button
        type="button"
        onClick={recenterMap}
        className="absolute bottom-4 left-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-cad-blue shadow-xl hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-200"
        title="My location"
      >
        <MapPin size={19} />
      </button>

      <aside className="absolute left-3 top-3 z-40 flex gap-2 sm:left-5 sm:top-4">
        <div className="inline-flex h-10 items-center gap-2 rounded border border-cad-line bg-white/95 px-3 shadow-xl dark:border-slate-700 dark:bg-slate-900/95">
          <Navigation size={16} className="text-cad-blue dark:text-blue-100" />
          <p className="text-sm font-black text-slate-950 dark:text-white">{currentSpeed === null ? '--' : Math.round(currentSpeed)} MPH</p>
        </div>
        <div
          className="inline-flex h-10 items-center gap-2 rounded border border-cad-line bg-white/95 px-3 shadow-xl dark:border-slate-700 dark:bg-slate-900/95"
          title={
            locationState === 'live'
              ? `GPS active${locationAccuracy !== null ? ` - ${Math.round(locationAccuracy)}m accuracy` : ''}`
              : locationState === 'starting'
                ? `GPS connecting${locationAccuracy !== null ? ` - ${Math.round(locationAccuracy)}m accuracy` : ''}`
                : 'GPS not working'
          }
        >
          <MapPin size={16} className="text-cad-blue dark:text-blue-100" />
          <span
            className={`h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-950 ${
              locationState === 'live'
                ? 'bg-emerald-500'
                : locationState === 'starting'
                  ? 'bg-amber-400'
                  : 'bg-red-500'
            }`}
          />
        </div>
      </aside>

      {navigationSummary && (
        <aside className="absolute bottom-24 left-1/2 z-30 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900/95">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Navigating {navigationSummary.callNumber}</p>
            <p className="mt-1 text-lg font-black text-slate-950 dark:text-white">{navigationSummary.duration}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${trafficIndicatorClasses[navigationSummary.traffic]}`}>
            {trafficIndicatorLabels[navigationSummary.traffic]}
          </span>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Distance</p>
            <p className="mt-1 text-lg font-black text-cad-blue dark:text-blue-100">{navigationSummary.distance}</p>
          </div>
          <button
            type="button"
            onClick={cancelNavigation}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-600 text-white shadow-sm hover:bg-red-700"
            title="Cancel navigation"
          >
            <X size={17} />
          </button>
        </aside>
      )}

      <button
        type="button"
        onClick={() => setRightOpen((value) => !value)}
        className="absolute right-4 top-20 z-30 inline-flex h-9 w-12 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-700 shadow-xl transition dark:border-slate-700 dark:bg-slate-900/95 dark:text-white"
        title={rightOpen ? 'Collapse assignments' : 'Open assignments'}
      >
        <ChevronUp className={`transition-transform duration-300 ${rightOpen ? '' : 'rotate-180'}`} size={18} />
      </button>

      <aside
        className={`absolute right-4 top-32 z-20 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-2xl transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
          rightOpen ? 'translate-y-0 opacity-100' : '-translate-y-4 pointer-events-none opacity-0'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Active Assignments</h2>
          <span className="rounded-full bg-cad-blue px-2 py-1 text-xs font-bold text-white">{assignedIncidents.length}</span>
        </div>
        {selectedAssignmentWarning && (
          <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">
            {selectedAssignmentWarning}
          </p>
        )}
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

      <QuickLaunchDock
        slots={dockSlots}
        options={dockItems}
        activeItem={activeDockItem}
        customizingSlot={customizingSlot}
        sidebarCollapsed={appSidebarCollapsed}
        badges={{ messages: messageBadgeCount }}
        onOpen={openDockItem}
        onCustomize={setCustomizingSlot}
        onAssignSlot={assignDockSlot}
        onDragStart={setDraggedSlotIndex}
        onDrop={swapDockSlots}
      />

      {openDockItems.map((dockItem) => (
        <ModalShell
          key={dockItem}
          title={dockItems.find((item) => item.id === dockItem)?.label || 'Quick Launch'}
          open
          onClose={() => closeDockItem(dockItem)}
          onFocus={() => focusDockItem(dockItem)}
          zIndex={dockZOrder[dockItem] || 50}
          active={activeDockItem === dockItem}
          maxWidthClass="max-w-3xl"
          placement="center"
          contentClassName="max-h-[70vh] overflow-auto p-4"
        >
              <DockContent
                activeItem={dockItem}
                incidents={incidents}
                selectedIncident={selectedIncident}
                selectedStatus={selectedStatus}
                workflowStatuses={workflowStatuses(selectedIncident)}
                assignmentWarning={selectedAssignmentWarning}
                currentLocation={currentLocation}
                currentSpeed={currentSpeed}
                locationState={locationState}
                currentUserId={user?.id}
                noteBody={noteBody}
                setNoteBody={setNoteBody}
                busy={busy}
                message={message}
                officerEvent={officerEvent}
                configuredCallTypes={configuredCallTypes}
                onSelectIncident={setSelectedIncidentId}
                onNavigateToIncident={focusSelectedIncidentRoute}
                onUpdateStatus={updateStatus}
                onAddNote={addNote}
                onLogout={logout}
                setOfficerEvent={setOfficerEvent}
                onCreateOfficerEvent={createOfficerEvent}
                onSubmitInquiry={submitInquiry}
                inquiryOfficers={directory.filter((item) => item.role === UserRole.OFFICER || item.role === UserRole.ADMIN)}
                activeUnits={trackedOfficers}
                directory={messageThreads}
                messageThreadByUser={messageThreadByUser}
                onlineUserIds={onlineUserIds}
                selectedMessageUser={selectedMessageUser}
                selectedMessageUserId={selectedMessageUserId}
                messages={searchedMessages}
                messageBody={messageBody}
                messageSearch={messageSearch}
                messageTextSearch={messageTextSearch}
                selectedTyping={selectedTyping}
                messagePendingDelete={messagePendingDelete}
                threadPendingDeleteUserId={threadPendingDeleteUserId}
                pinnedMessageThreadIds={pinnedMessageThreadIds}
                pendingAttachments={pendingAttachments}
                emojiOpen={emojiOpen}
                emojiSearch={emojiSearch}
                emojiButton={emojiButton}
                filteredEmojis={filteredEmojis}
                currentUserIdForMessages={user?.id || ''}
                setSelectedMessageUserId={setSelectedMessageUserId}
                setMessageBody={updateMessageBody}
                setMessageSearch={setMessageSearch}
                setMessageTextSearch={setMessageTextSearch}
                setMessagePendingDelete={setMessagePendingDelete}
                setThreadPendingDeleteUserId={setThreadPendingDeleteUserId}
                onTogglePinnedThread={togglePinnedMessageThread}
                setPendingAttachments={setPendingAttachments}
                setEmojiOpen={setEmojiOpen}
                setEmojiSearch={setEmojiSearch}
                onReactToMessage={reactToMessage}
                onDeleteMessage={deleteChatMessage}
                onDeleteThread={deleteMessageThread}
                onSendMessage={sendMessage}
                onAttachment={handleAttachment}
              />
        </ModalShell>
      ))}

      <UrgentAlertOverlay alerts={urgentAlerts} onAcknowledge={acknowledgeUrgentAlert} />

      <ChangePasswordModal
        open={changePasswordOpen}
        form={passwordForm}
        message={passwordMessage}
        onClose={() => setChangePasswordOpen(false)}
        onChange={setPasswordForm}
        onSubmit={changePassword}
      />
      </div>
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
    <div className="mt-3 flex flex-wrap gap-1.5">
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${incidentStatusClasses[incident.status]}`}>{incident.status}</span>
      {status && <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${statusClasses[status]}`}>My unit: {status}</span>}
      {incident.units.length === 0 ? (
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          Unassigned
        </span>
      ) : (
        incident.units.map((unit) => (
          <span key={unit.userId} className="rounded-full bg-cad-blue/10 px-2 py-1 text-xs font-bold text-cad-blue dark:bg-blue-950 dark:text-blue-100">
            {unit.cadUnitNumber || unit.name}: {unit.status}
          </span>
        ))
      )}
    </div>
  </button>
);

const DockContent: React.FC<{
  activeItem: DockItem;
  incidents: Incident[];
  selectedIncident: Incident | null;
  selectedStatus: IncidentUnitStatus | null;
  workflowStatuses: IncidentUnitStatus[];
  assignmentWarning: string;
  currentLocation: { lat: number; lon: number } | null;
  currentSpeed: number | null;
  locationState: string;
  currentUserId?: string;
  noteBody: string;
  setNoteBody: (value: string) => void;
  busy: boolean;
  message: string;
  officerEvent: { type: string; priority: IncidentPriority; description: string };
  configuredCallTypes: Array<{ label: string; priority: IncidentPriority }>;
  onSelectIncident: (id: string) => void;
  onNavigateToIncident: () => void;
  onUpdateStatus: (status: IncidentUnitStatus) => void;
  onAddNote: () => void;
  onLogout: () => void;
  setOfficerEvent: React.Dispatch<React.SetStateAction<{ type: string; priority: IncidentPriority; description: string }>>;
  onCreateOfficerEvent: () => void;
  onSubmitInquiry: (submission: InquirySubmission) => void;
  inquiryOfficers: User[];
  activeUnits: User[];
  directory: User[];
  messageThreadByUser: Record<string, MessageThread>;
  onlineUserIds: string[];
  selectedMessageUser: User | null;
  selectedMessageUserId: string;
  messages: ChatMessage[];
  messageBody: string;
  messageSearch: string;
  messageTextSearch: string;
  selectedTyping: { name: string; expiresAt: number } | null;
  messagePendingDelete: ChatMessage | null;
  threadPendingDeleteUserId: string | null;
  pinnedMessageThreadIds: string[];
  pendingAttachments: SendMessageAttachment[];
  emojiOpen: boolean;
  emojiSearch: string;
  emojiButton: string;
  filteredEmojis: string[];
  currentUserIdForMessages: string;
  setSelectedMessageUserId: (id: string) => void;
  setMessageBody: (value: string) => void;
  setMessageSearch: (value: string) => void;
  setMessageTextSearch: (value: string) => void;
  setMessagePendingDelete: (message: ChatMessage | null) => void;
  setThreadPendingDeleteUserId: (id: string | null) => void;
  onTogglePinnedThread: (threadId: string) => void;
  setPendingAttachments: React.Dispatch<React.SetStateAction<SendMessageAttachment[]>>;
  setEmojiOpen: (value: boolean) => void;
  setEmojiSearch: (value: string) => void;
  onReactToMessage: (message: ChatMessage, reaction: string) => void;
  onDeleteMessage: (message: ChatMessage) => void;
  onDeleteThread: (userId: string) => void;
  onSendMessage: () => void;
  onAttachment: (file: File) => void;
}> = ({
  activeItem,
  incidents,
  selectedIncident,
  selectedStatus,
  workflowStatuses,
  assignmentWarning,
  currentLocation,
  currentSpeed,
  locationState,
  currentUserId,
  noteBody,
  setNoteBody,
  busy,
  message,
  officerEvent,
  configuredCallTypes,
  onSelectIncident,
  onNavigateToIncident,
  onUpdateStatus,
  onAddNote,
  onLogout,
  setOfficerEvent,
  onCreateOfficerEvent,
  onSubmitInquiry,
  inquiryOfficers,
  activeUnits,
  directory,
  messageThreadByUser,
  onlineUserIds,
  selectedMessageUser,
  selectedMessageUserId,
  messages,
  messageBody,
  messageSearch,
  messageTextSearch,
  selectedTyping,
  messagePendingDelete,
  threadPendingDeleteUserId,
  pinnedMessageThreadIds,
  pendingAttachments,
  emojiOpen,
  emojiSearch,
  emojiButton,
  filteredEmojis,
  currentUserIdForMessages,
  setSelectedMessageUserId,
  setMessageBody,
  setMessageSearch,
  setMessageTextSearch,
  setMessagePendingDelete,
  setThreadPendingDeleteUserId,
  onTogglePinnedThread,
  setPendingAttachments,
  setEmojiOpen,
  setEmojiSearch,
  onReactToMessage,
  onDeleteMessage,
  onDeleteThread,
  onSendMessage,
  onAttachment
}) => {
  const [activeCallTab, setActiveCallTab] = useState<CallTabId>('all');
  const [callSearch, setCallSearch] = useState('');
  const [timerNow, setTimerNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const isClosedCall = (incident: Incident) => incident.status === 'Closed' || incident.status === 'Canceled';
  const isMyCall = (incident: Incident) =>
    incident.units.some((unit) => unit.userId === currentUserId && unit.status !== 'Cleared') || incident.createdBy === currentUserId;
  const callMatchesSearch = (incident: Incident) => {
    const query = callSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      incident.callNumber,
      incident.type,
      incident.priority,
      incident.status,
      incident.address,
      incident.description,
      incident.callerName,
      incident.callerPhone,
      incident.disposition,
      ...incident.units.flatMap((unit) => [unit.name, unit.cadUnitNumber, unit.status])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  };
  const tabIncidents = (tab: CallTabId) =>
    incidents.filter((incident) => {
      if (!callMatchesSearch(incident)) return false;
      if (tab === 'my') return isMyCall(incident);
      if (tab === 'pending') return incident.status === 'Pending';
      if (tab === 'closed') return isClosedCall(incident);
      return true;
    });
  const callTabs: Array<{ id: CallTabId; label: string; icon: React.ReactNode; calls: Incident[] }> = [
    { id: 'all', label: 'All Calls', icon: <ClipboardList size={14} />, calls: tabIncidents('all') },
    { id: 'my', label: 'My Calls', icon: <Radio size={14} />, calls: tabIncidents('my') },
    { id: 'pending', label: 'Pending Calls', icon: <Siren size={14} />, calls: tabIncidents('pending') },
    { id: 'closed', label: 'Closed Calls', icon: <CheckCircle2 size={14} />, calls: tabIncidents('closed') }
  ];
  const activeUnitRows = activeUnits
    .map((unit) => {
      const status = officerMapStatus(unit, currentUserId, selectedStatus);
      const miles =
        currentLocation && unit.lat !== undefined && unit.lon !== undefined
          ? distanceMiles(currentLocation.lat, currentLocation.lon, unit.lat, unit.lon)
          : null;
      return { unit, status, miles };
    })
    .sort((first, second) => {
      if (first.unit.id === currentUserId) return -1;
      if (second.unit.id === currentUserId) return 1;
      if (first.miles !== null && second.miles !== null) return first.miles - second.miles;
      if (first.miles !== null) return -1;
      if (second.miles !== null) return 1;
      return officerMapLabel(first.unit).localeCompare(officerMapLabel(second.unit));
    });
  const visibleCallTabIncidents = callTabs.find((tab) => tab.id === activeCallTab)?.calls || [];
  const callEmptyCopy =
    activeCallTab === 'my'
      ? 'No calls are assigned to you or created by you.'
      : activeCallTab === 'pending'
        ? 'No pending calls.'
        : activeCallTab === 'closed'
          ? 'No recent closed calls.'
          : 'No calls are in the queue.';

  if (activeItem === 'calls') {
    return (
      <div className="grid gap-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            value={callSearch}
            onChange={(event) => setCallSearch(event.target.value)}
            placeholder="Search calls"
            className="h-9 w-full rounded border border-cad-line bg-white pl-9 pr-3 text-sm outline-none focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {callTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCallTab(tab.id)}
              className={`rounded border px-2 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] transition ${
                activeCallTab === tab.id
                  ? 'border-cad-accent bg-white text-cad-blue shadow-sm dark:bg-slate-900 dark:text-blue-100'
                  : 'border-cad-line bg-white text-slate-600 hover:border-cad-accent/60 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">{tab.icon}{tab.label}</span>
              <span className="mt-0.5 block text-xs opacity-80">{tab.calls.length}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2">
          {visibleCallTabIncidents.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{callEmptyCopy}</p>}
          {visibleCallTabIncidents.map((incident) => (
            <IncidentButton
              key={incident.id}
              incident={incident}
              selected={selectedIncident?.id === incident.id}
              status={getMyUnitStatus(incident, currentUserId)}
              onClick={() => onSelectIncident(incident.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (activeItem === 'call-detail' || activeItem === 'navigation') {
    if (!selectedIncident) return <p className="text-sm text-slate-600 dark:text-slate-300">No call selected.</p>;
    const myAssignment = selectedIncident.units.find((unit) => unit.userId === currentUserId);
    const currentStatusStartedAt = myAssignment?.statusUpdatedAt || myAssignment?.assignedAt;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${priorityClasses[selectedIncident.priority]}`}>{selectedIncident.priority}</span>
            <h3 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">{selectedIncident.type}</h3>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedIncident.callNumber} opened {formatTime(selectedIncident.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onNavigateToIncident} className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-3 text-sm font-bold text-white">
              <Navigation size={18} />
              Navigate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdateStatus('Cleared')}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 size={18} />
              Clear Call
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Call Timer" value={elapsedTimeLabel(selectedIncident.createdAt, timerNow)} icon={<Clock size={16} />} />
          <Metric label="Assigned" value={elapsedTimeLabel(myAssignment?.assignedAt, timerNow)} />
          <Metric label={selectedStatus ? `${selectedStatus} Time` : 'Status Time'} value={elapsedTimeLabel(currentStatusStartedAt, timerNow)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="ETA" value={etaText(currentLocation, selectedIncident, currentSpeed)} />
          <Metric label="Coordinates" value={selectedIncident.lat !== undefined && selectedIncident.lon !== undefined ? `${selectedIncident.lat.toFixed(5)}, ${selectedIncident.lon.toFixed(5)}` : 'No map pin'} />
          <Metric label="District" value={selectedIncident.district || 'Unassigned'} />
          <Metric label="Beat" value={selectedIncident.beat || 'Unassigned'} />
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
        <div>
          <h3 className="text-sm font-black text-slate-950 dark:text-white">Active Units</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Online officers with current status and distance from your GPS.
          </p>
        </div>
        <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
          <div className="hidden grid-cols-[1fr_0.8fr_0.7fr_0.8fr] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 sm:grid">
            <span>Unit</span>
            <span>Status</span>
            <span>Miles</span>
            <span>District</span>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {activeUnitRows.length === 0 && (
              <p className="px-3 py-4 text-sm font-semibold text-slate-500 dark:text-slate-400">No active units online.</p>
            )}
            {activeUnitRows.map(({ unit, status, miles }) => {
              const tone = officerMapTone(status, unit.id === currentUserId);
              const toneClass =
                tone === 'blue'
                  ? 'bg-cad-blue text-white'
                  : tone === 'green'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100'
                    : tone === 'yellow'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-400 dark:text-slate-950'
                      : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-100';
              return (
                <div key={unit.id} className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[1fr_0.8fr_0.7fr_0.8fr] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950 dark:text-white">
                      {officerMapLabel(unit)}
                      <span className="ml-2 font-semibold text-slate-500 dark:text-slate-400">{unit.name}</span>
                    </p>
                    <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{unit.cadUnitNumber || unit.unitNumber || unit.badge || 'No CAD unit'}</p>
                  </div>
                  <span className={`w-fit rounded px-2 py-1 text-xs font-black ${toneClass}`}>{status}</span>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{miles === null ? '--' : `${miles.toFixed(1)} mi`}</span>
                  <span className="truncate text-xs font-bold text-slate-600 dark:text-slate-300">{unit.district || 'Unassigned'}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Current status: {selectedStatus || 'No call selected'}</p>
        {assignmentWarning && (
          <p className="rounded-md bg-amber-50 p-3 text-sm font-bold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">
            {assignmentWarning}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {workflowStatuses.map((status) => (
            <StatusButton
              key={status}
              disabled={busy || !selectedIncident}
              onClick={() => onUpdateStatus(status)}
              icon={status === 'Acknowledged' ? <CheckCircle2 size={18} /> : status === 'On Scene' ? <AlertTriangle size={18} /> : status === 'Cleared' ? <CheckCircle2 size={18} /> : <Siren size={18} />}
              label={status}
              className={
                status === 'Cleared' || status === 'Delivered'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : status === 'On Scene' || status === 'Staged'
                    ? 'bg-red-600 hover:bg-red-700'
                    : status === 'Acknowledged'
                      ? 'bg-slate-700 hover:bg-slate-800'
                      : 'bg-blue-600 hover:bg-blue-700'
              }
            />
          ))}
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

  if (activeItem === 'inquiries') {
    return (
      <InquiryPanel
        officers={inquiryOfficers}
        defaultOfficerId={currentUserId}
        busy={busy}
        message={message}
        onSubmit={onSubmitInquiry}
      />
    );
  }

  if (activeItem === 'settings') {
    return (
      <div className="grid gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Officer-Initiated Event</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={officerEvent.type}
            onChange={(event) => {
              const callType = configuredCallTypes.find((item) => item.label === event.target.value);
              setOfficerEvent((value) => ({
                ...value,
                type: event.target.value,
                priority: callType?.priority || value.priority
              }));
            }}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            {configuredCallTypes.map((eventType) => (
              <option key={eventType.label} value={eventType.label}>{eventType.label}</option>
            ))}
          </select>
          <select
            value={officerEvent.priority}
            onChange={(event) => setOfficerEvent((value) => ({ ...value, priority: event.target.value as IncidentPriority }))}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            {(['Low', 'Normal', 'High', 'Emergency'] as IncidentPriority[]).map((priority) => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>
        </div>
        <textarea
          value={officerEvent.description}
          onChange={(event) => setOfficerEvent((value) => ({ ...value, description: event.target.value }))}
          rows={3}
          placeholder="Event details"
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        <button type="button" disabled={busy} onClick={onCreateOfficerEvent} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
          Start Event
        </button>
        {message && <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</p>}
      </div>
    );
  }

  if (activeItem === 'messages') {
    return (
      <OfficerMessages
        directory={directory}
        messageThreadByUser={messageThreadByUser}
        onlineUserIds={onlineUserIds}
        selectedMessageUser={selectedMessageUser}
        selectedMessageUserId={selectedMessageUserId}
        messages={messages}
        messageBody={messageBody}
        messageSearch={messageSearch}
        messageTextSearch={messageTextSearch}
        selectedTyping={selectedTyping}
        messagePendingDelete={messagePendingDelete}
        threadPendingDeleteUserId={threadPendingDeleteUserId}
        pinnedMessageThreadIds={pinnedMessageThreadIds}
        pendingAttachments={pendingAttachments}
        emojiOpen={emojiOpen}
        emojiSearch={emojiSearch}
        emojiButton={emojiButton}
        filteredEmojis={filteredEmojis}
        currentUserId={currentUserIdForMessages}
        setSelectedMessageUserId={setSelectedMessageUserId}
        setMessageBody={setMessageBody}
        setMessageSearch={setMessageSearch}
        setMessageTextSearch={setMessageTextSearch}
        setMessagePendingDelete={setMessagePendingDelete}
        setThreadPendingDeleteUserId={setThreadPendingDeleteUserId}
        onTogglePinnedThread={onTogglePinnedThread}
        setPendingAttachments={setPendingAttachments}
        setEmojiOpen={setEmojiOpen}
        setEmojiSearch={setEmojiSearch}
        onReactToMessage={onReactToMessage}
        onDeleteMessage={onDeleteMessage}
        onDeleteThread={onDeleteThread}
        onSendMessage={onSendMessage}
        onAttachment={onAttachment}
      />
    );
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

const OfficerMessages: React.FC<{
  directory: User[];
  messageThreadByUser: Record<string, MessageThread>;
  onlineUserIds: string[];
  selectedMessageUser: User | null;
  selectedMessageUserId: string;
  messages: ChatMessage[];
  messageBody: string;
  messageSearch: string;
  messageTextSearch: string;
  selectedTyping: { name: string; expiresAt: number } | null;
  messagePendingDelete: ChatMessage | null;
  threadPendingDeleteUserId: string | null;
  pinnedMessageThreadIds: string[];
  pendingAttachments: SendMessageAttachment[];
  emojiOpen: boolean;
  emojiSearch: string;
  emojiButton: string;
  filteredEmojis: string[];
  currentUserId: string;
  setSelectedMessageUserId: (id: string) => void;
  setMessageBody: (value: string) => void;
  setMessageSearch: (value: string) => void;
  setMessageTextSearch: (value: string) => void;
  setMessagePendingDelete: (message: ChatMessage | null) => void;
  setThreadPendingDeleteUserId: (id: string | null) => void;
  onTogglePinnedThread: (threadId: string) => void;
  setPendingAttachments: React.Dispatch<React.SetStateAction<SendMessageAttachment[]>>;
  setEmojiOpen: (value: boolean) => void;
  setEmojiSearch: (value: string) => void;
  onReactToMessage: (message: ChatMessage, reaction: string) => void;
  onDeleteMessage: (message: ChatMessage) => void;
  onDeleteThread: (userId: string) => void;
  onSendMessage: () => void;
  onAttachment: (file: File) => void;
}> = ({
  directory,
  messageThreadByUser,
  onlineUserIds,
  selectedMessageUser,
  selectedMessageUserId,
  messages,
  messageBody,
  messageSearch,
  messageTextSearch,
  selectedTyping,
  messagePendingDelete,
  threadPendingDeleteUserId,
  pinnedMessageThreadIds,
  pendingAttachments,
  emojiOpen,
  emojiSearch,
  emojiButton,
  filteredEmojis,
  currentUserId,
  setSelectedMessageUserId,
  setMessageBody,
  setMessageSearch,
  setMessageTextSearch,
  setMessagePendingDelete,
  setThreadPendingDeleteUserId,
  onTogglePinnedThread,
  setPendingAttachments,
  setEmojiOpen,
  setEmojiSearch,
  onReactToMessage,
  onDeleteMessage,
  onDeleteThread,
  onSendMessage,
  onAttachment
}) => (
  <div className="grid h-[min(70vh,680px)] min-h-[520px] overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 sm:grid-cols-[240px_1fr]">
    <div className="relative flex min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-700">
        <input
          value={messageSearch}
          onChange={(event) => setMessageSearch(event.target.value)}
          placeholder="Search threads"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-14">
        {directory.map((item) => {
          const thread = messageThreadByUser[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedMessageUserId(item.id)}
              className={`w-full border-b border-slate-200 px-3 py-3 text-left text-sm dark:border-slate-800 ${
                selectedMessageUserId === item.id ? 'bg-blue-50 dark:bg-blue-950/50' : 'hover:bg-white dark:hover:bg-slate-900'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cad-blue/10 text-xs font-black text-cad-blue">
                  {getInitials(item.name)}
                </span>
                <span className={`h-2.5 w-2.5 rounded-full ${onlineUserIds.includes(item.id) ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {thread?.unreadCount ? (
                  <span className="rounded-full bg-cad-blue px-2 py-0.5 text-[11px] font-black text-white">
                    {thread.unreadCount}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePinnedThread(item.id);
                  }}
                  className={`rounded-full p-1 ${
                    pinnedMessageThreadIds.includes(item.id)
                      ? 'text-cad-blue'
                      : 'text-slate-400 hover:text-cad-blue'
                  }`}
                  aria-label={pinnedMessageThreadIds.includes(item.id) ? 'Unpin conversation' : 'Pin conversation'}
                  title={pinnedMessageThreadIds.includes(item.id) ? 'Unpin conversation' : 'Pin conversation'}
                >
                  {pinnedMessageThreadIds.includes(item.id) ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setThreadPendingDeleteUserId(item.id);
                  }}
                  disabled={!thread?.lastMessage}
                  className="rounded-full bg-red-600 p-1 text-white hover:bg-red-700 disabled:opacity-40"
                  aria-label="Delete conversation"
                  title="Delete conversation"
                >
                  <Trash2 size={13} />
                </button>
              </span>
              <span className="mt-1 block truncate text-xs text-slate-500">
                {thread?.lastMessage?.body ||
                  (thread?.lastMessage?.attachments?.length
                    ? `${thread.lastMessage.attachments.length} attachment(s)`
                    : item.cadUnitNumber || item.badge || item.email)}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setSelectedMessageUserId('')}
        className="absolute bottom-3 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full bg-cad-blue text-white shadow-lg transition hover:bg-blue-700"
        aria-label="New message"
        title="New message"
      >
        <Plus size={18} />
      </button>
    </div>
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        {selectedMessageUser ? (
          <>
            <p className="text-sm font-bold">{selectedMessageUser.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{onlineUserIds.includes(selectedMessageUser.id) ? 'Active now' : 'Offline'}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                <Lock size={12} />
                Encrypted
              </span>
            </div>
          </>
        ) : (
          <select
            value={selectedMessageUserId}
            onChange={(event) => setSelectedMessageUserId(event.target.value)}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="">Compose to...</option>
            {directory.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        )}
        <input
          value={messageTextSearch}
          onChange={(event) => setMessageTextSearch(event.target.value)}
          placeholder="Search messages"
          className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-white p-4 dark:bg-slate-950">
        {selectedMessageUserId && messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
        {!selectedMessageUserId && <p className="text-sm text-slate-500">Select a thread or compose a new message.</p>}
        {messages.map((message) => {
          const mine = message.senderId === currentUserId;
          const index = messages.findIndex((item) => item.id === message.id);
          const previous = messages[index - 1];
          const showTimestamp =
            !previous ||
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 10 * 60 * 1000;
          return (
            <div key={message.id}>
              {showTimestamp && (
                <div className="my-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  <span className="text-[11px] font-bold uppercase text-slate-400">{formatMessageTime(message.createdAt)}</span>
                  <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                </div>
              )}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`group flex max-w-[85%] flex-col ${mine ? 'items-end text-right' : 'items-start text-left'}`}
                >
                  <div
                    className={`w-fit max-w-full rounded-[1.35rem] px-4 py-2.5 text-sm shadow-sm ${
                      mine
                        ? 'rounded-br-md bg-cad-blue text-white'
                        : 'rounded-bl-md border border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-white'
                    }`}
                  >
                    {message.body && <p className="whitespace-pre-wrap text-left leading-6">{message.body}</p>}
                    {message.attachments?.map((attachment) => (
                      <MessageAttachmentPreview key={attachment.id} attachment={attachment} mine={mine} />
                    ))}
                  </div>
                  {(getMessageReactionForOtherUser(message, currentUserId) || getMessageReactionForUser(message, currentUserId)) && (
                    <div className={`mt-1 flex gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                      {getMessageReactionForOtherUser(message, currentUserId) && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs shadow dark:bg-slate-900">
                          {getReactionIcon(getMessageReactionForOtherUser(message, currentUserId))}
                        </span>
                      )}
                      {getMessageReactionForUser(message, currentUserId) && (
                        <span className="rounded-full bg-cad-blue/10 px-2 py-0.5 text-xs text-cad-blue shadow">
                          {getReactionIcon(getMessageReactionForUser(message, currentUserId))}
                        </span>
                      )}
                    </div>
                  )}
                  <div className={`mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[11px] font-semibold ${mine ? 'justify-end text-blue-100' : 'justify-start text-slate-400'}`}>
                    <span>{formatMessageTime(message.createdAt)}</span>
                    {mine && message.deliveryStatus === 'sending' && <span>Sending</span>}
                    {mine && message.deliveryStatus === 'failed' && <span>Failed</span>}
                    {mine && message.deliveryStatus !== 'sending' && message.deliveryStatus !== 'failed' && (
                      <span className="inline-flex items-center gap-1">
                        {message.readAt ? <CheckCheck size={12} /> : <Check size={12} />}
                        {deliveryLabel(message)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setMessagePendingDelete(message)}
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white opacity-100 shadow-sm hover:bg-red-700 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label="Delete message"
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                    <span className="inline-flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      <SmilePlus size={12} />
                      {messageReactionOptions.map((reaction) => (
                        <button
                          key={reaction.key}
                          type="button"
                          onClick={() => onReactToMessage(message, reaction.key)}
                          className={`rounded-full px-1.5 py-0.5 hover:bg-cad-blue/10 ${
                            getMessageReactionForUser(message, currentUserId) === reaction.key ? 'bg-cad-blue/10 text-cad-blue' : ''
                          }`}
                          aria-label={reaction.label}
                          title={reaction.label}
                        >
                          {reaction.icon}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {selectedTyping && (
          <div className="flex justify-start">
            <div className="rounded-[1.35rem] rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {selectedTyping.name} is typing...
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment, index) => (
              <span key={`${attachment.fileName}-${index}`} className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-cad-blue">
                <Paperclip size={13} />
                {attachment.fileName}
                <button type="button" onClick={() => setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative grid grid-cols-[auto_auto_1fr_auto] gap-2">
          <button type="button" onClick={() => setEmojiOpen(!emojiOpen)} className="rounded-md border border-slate-200 px-3 py-2 text-lg dark:border-slate-700">
            {emojiButton}
          </button>
          <label className="flex cursor-pointer items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-200">
            <Paperclip size={18} />
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAttachment(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <input
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) onSendMessage();
            }}
            placeholder="Type a message"
            className="min-w-0 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <button type="button" onClick={onSendMessage} disabled={!selectedMessageUserId || (!messageBody.trim() && pendingAttachments.length === 0)} className="rounded-md bg-cad-blue px-3 py-2 text-white disabled:opacity-50">
            <Send size={18} />
          </button>
          {emojiOpen && (
            <div className="absolute bottom-12 left-0 z-20 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <input
                value={emojiSearch}
                onChange={(event) => setEmojiSearch(event.target.value)}
                placeholder="Search emoji"
                className="mb-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <div className="grid max-h-48 grid-cols-8 gap-1 overflow-y-auto text-xl">
                {filteredEmojis.slice(0, 240).map((emoji, index) => (
                  <button key={`${emoji}-${index}`} type="button" onClick={() => setMessageBody(`${messageBody}${emoji}`)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    {threadPendingDeleteUserId && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-900">
          <h3 className="text-lg font-black">Delete Conversation</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Delete the conversation with {directory.find((item) => item.id === threadPendingDeleteUserId)?.name || 'this user'}?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setThreadPendingDeleteUserId(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => onDeleteThread(threadPendingDeleteUserId)} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700">
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
    {messagePendingDelete && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-900">
          <h3 className="text-lg font-black">Delete Message</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Delete this message from your mailbox?</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setMessagePendingDelete(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700">
              Cancel
            </button>
            <button type="button" onClick={() => onDeleteMessage(messagePendingDelete)} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700">
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);

const Metric: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-950">
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {icon}
      {label}
    </p>
    <p className="mt-1 break-words text-lg font-black text-slate-950 dark:text-white">{value}</p>
  </div>
);

const FallbackOfficerMap: React.FC<{
  currentLocation: { lat: number; lon: number } | null;
  assignedIncidents: Incident[];
  currentUserLabel: string;
  currentSpeed: number | null;
}> = ({ currentLocation, assignedIncidents, currentUserLabel, currentSpeed }) => (
  <div className="relative h-full w-full overflow-hidden bg-slate-900">
    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:48px_48px]" />
    <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cad-blue ring-4 ring-white shadow-xl" title={currentUserLabel} />
    {currentSpeed !== null && (
      <div className="absolute left-[calc(50%+1rem)] top-[calc(50%-1.5rem)] rounded-full bg-emerald-500 px-2 py-1 text-xs font-bold text-white ring-2 ring-white">
        {Math.round(currentSpeed)} mph
      </div>
    )}
    <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/40 location-pulse" />
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
      {currentLocation ? 'GPS active' : 'Waiting for GPS'}
    </div>
  </div>
);
