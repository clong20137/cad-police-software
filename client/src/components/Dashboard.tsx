import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  ChevronDown,
  ChevronUp,
  Bell,
  ClipboardList,
  MessageCircle,
  Layers,
  LogOut,
  Lock,
  MapPin,
  Paperclip,
  Pin,
  PinOff,
  Radio,
  Send,
  Settings,
  Search,
  Shield,
  SlidersHorizontal,
  CheckCheck,
  Check,
  Moon,
  Plus,
  SmilePlus,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runtimeConfig } from '../config/runtimeConfig';
import { authClient } from '../services/authClient';
import {
  ChatMessage,
  AdminConfigurationItem,
  Incident,
  IncidentPriority,
  IncidentStatus,
  IncidentUnitStatus,
  MessageThread,
  SendMessageAttachment,
  UrgentAlert,
  UnitStatus,
  User,
  UserRole
} from '../types/auth';
import { ChangePasswordModal } from './common/ChangePasswordModal';
import { MessageAttachmentPreview } from './common/MessageAttachmentPreview';
import { ModalShell } from './common/ModalShell';
import { QuickLaunchDock, QuickLaunchSlot as DockSlotValue } from './common/QuickLaunchDock';
import { InquiryPanel, InquirySubmission } from './common/InquiryPanel';
import { ProtectiveOrderPanel } from './common/ProtectiveOrderPanel';
import { ShieldSidebar, ShieldSidebarItem } from './common/ShieldSidebar';
import { UrgentAlertOverlay } from './common/UrgentAlertOverlay';
import { callTypesFromConfig } from '../utils/adminConfig';
import { geofenceAssignmentForPoint, geofencesFromConfig, MapGeofence } from '../utils/mapGeofences';
import { APP_NAME } from '../constants/branding';

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
        InfoWindow: new (options: Record<string, unknown>) => GoogleInfoWindowInstance;
        Polyline: new (options: GooglePolylineOptions) => GooglePolylineInstance;
        Polygon: new (options: GooglePolygonOptions) => GooglePolygonInstance;
        LatLng: new (lat: number, lng: number) => GoogleLatLngInstance;
        LatLngBounds: new () => GoogleLatLngBoundsInstance;
        TrafficLayer?: new () => GoogleTrafficLayerInstance;
        OverlayView: new () => GoogleOverlayViewInstance;
        Geocoder: new () => GoogleGeocoder;
        places?: {
          AutocompleteService: new () => GoogleAutocompleteService;
          PlacesServiceStatus: {
            OK: string;
          };
        };
      };
    };
  }
}

interface GoogleMapInstance {
  setCenter: (location: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: GoogleLatLngBoundsInstance) => void;
  setOptions: (options: Record<string, unknown>) => void;
}

interface GoogleInfoWindowInstance {
  open: (options: { map: GoogleMapInstance; position: { lat: number; lng: number } }) => void;
  addListener: (eventName: string, handler: () => void) => void;
}

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

interface GoogleLatLngInstance {}

interface GoogleLatLngBoundsInstance {
  extend: (location: { lat: number; lng: number }) => void;
}

interface GoogleTrafficLayerInstance {
  setMap: (map: GoogleMapInstance | null) => void;
}

interface GoogleGeocoderResult {
  geometry?: {
    location?: {
      lat: () => number;
      lng: () => number;
    };
  };
}

interface GoogleGeocoder {
  geocode: (
    request: { placeId: string },
    callback: (results: GoogleGeocoderResult[] | null, status: string) => void
  ) => void;
}

interface GoogleOverlayViewInstance {
  setMap: (map: GoogleMapInstance | null) => void;
  getPanes: () => { overlayMouseTarget: HTMLElement } | null;
  getProjection: () => {
    fromLatLngToDivPixel: (position: GoogleLatLngInstance) => { x: number; y: number } | null;
  };
}

interface GooglePlacePrediction {
  description: string;
  place_id: string;
}

interface GoogleAutocompleteService {
  getPlacePredictions: (
    request: Record<string, unknown>,
    callback: (predictions: GooglePlacePrediction[] | null, status: string) => void
  ) => void;
}

type TrackedUnit = User & { lat: number; lon: number };
type QuickLaunchId = 'messages' | 'calls' | 'new-call' | 'units' | 'unit-detail' | 'call-detail' | 'inquiries' | 'protective-orders' | 'settings';
type QuickLaunchSlot = DockSlotValue<QuickLaunchId>;
type ToastNotice = { id: string; title: string; message: string; tone: 'info' | 'success' | 'warning' };
type UnitLocationReliability = 'live' | 'stale' | 'offline';
type UnitBoardSortKey = 'status' | 'unit' | 'name' | 'cadUnit' | 'district';
type SortDirection = 'asc' | 'desc';
type UnitBoardUser = User & Partial<Pick<TrackedUnit, 'lat' | 'lon'>>;
type RealtimeReadyPayload = { serverTime?: string; onlineUserIds?: string[] };
type CallTabId = 'all' | 'my' | 'pending' | 'closed';
type DispatchMapLayers = {
  units: boolean;
  calls: boolean;
  geofences: boolean;
  trails: boolean;
  traffic: boolean;
};

const quickLaunchOptions: Array<{ id: QuickLaunchId; label: string; icon: React.ReactNode }> = [
  { id: 'messages', label: 'Messages', icon: <MessageCircle size={18} /> },
  { id: 'calls', label: 'Calls', icon: <ClipboardList size={18} /> },
  { id: 'new-call', label: 'New Call', icon: <Send size={18} /> },
  { id: 'units', label: 'Units', icon: <Users size={18} /> },
  { id: 'unit-detail', label: 'Unit', icon: <Radio size={18} /> },
  { id: 'call-detail', label: 'Call', icon: <Shield size={18} /> },
  { id: 'inquiries', label: 'Inquiries', icon: <Search size={18} /> },
  { id: 'protective-orders', label: 'Protect Ord', icon: <Search size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> }
];

const defaultQuickLaunchSlots: QuickLaunchSlot[] = [
  'messages',
  'calls',
  'new-call',
  'units',
  'unit-detail',
  'call-detail',
  'inquiries',
  'settings'
];

const normalizeQuickLaunchSlots = (slots: Array<DockSlotValue<string>>): QuickLaunchSlot[] =>
  Array.from({ length: 8 }, (_, index) => {
    const slot = slots[index];
    if (typeof slot === 'string') {
      return quickLaunchOptions.some((option) => option.id === slot) ? (slot as QuickLaunchId) : null;
    }
    if (slot && typeof slot === 'object' && slot.type === 'external') {
      return slot;
    }
    return null;
  });

const liveLocationHeartbeatMs = 5000;
const locationFreshMs = 15000;
const locationOfflineMs = 45000;
const liveLocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000
};

const emojiCatalog = (() => {
  const priorityEmoji = ['🚓', '🚔', '🚨', '🚑', '🚒', '📍', '✅', '⚠️', '❗', '🙏'];
  const ranges = [
    [0x1f300, 0x1f5ff],
    [0x1f600, 0x1f64f],
    [0x1f680, 0x1f6ff],
    [0x1f700, 0x1f77f],
    [0x1f780, 0x1f7ff],
    [0x1f900, 0x1f9ff],
    [0x1fa70, 0x1faff],
    [0x2600, 0x27bf]
  ];
  const generated = ranges.flatMap(([start, end]) =>
    Array.from({ length: end - start + 1 }, (_, index) => String.fromCodePoint(start + index)).filter((emoji) =>
      /\p{Emoji}/u.test(emoji)
    )
  );
  return Array.from(new Set([...priorityEmoji, ...generated]));
})();

const statusStyles: Record<UnitStatus, string> = {
  Available: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Dispatched: 'bg-amber-50 text-amber-700 ring-amber-200',
  'En Route': 'bg-blue-50 text-blue-700 ring-blue-200',
  'On Scene': 'bg-red-50 text-red-700 ring-red-200',
  Transporting: 'bg-violet-50 text-violet-700 ring-violet-200',
  'Traffic Stop': 'bg-red-50 text-red-700 ring-red-200'
};

const unitBoardStatusStyles = (status: UnitStatus): { row: string; pill: string; dot: string } => {
  if (status === 'Available') {
    return {
      row: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/30',
      pill: 'bg-emerald-600 text-white ring-emerald-700/20',
      dot: 'bg-emerald-500'
    };
  }
  if (status === 'En Route') {
    return {
      row: 'border-amber-200 bg-amber-50/75 dark:border-amber-900/70 dark:bg-amber-950/30',
      pill: 'bg-amber-400 text-slate-950 ring-amber-500/25',
      dot: 'bg-amber-400'
    };
  }
  return {
    row: 'border-red-200 bg-red-50/75 dark:border-red-900/70 dark:bg-red-950/30',
    pill: 'bg-red-600 text-white ring-red-700/20',
    dot: 'bg-red-600'
  };
};

const unitBoardStatusRank = (status: UnitStatus): number => {
  if (status === 'Available') return 0;
  if (status === 'En Route') return 1;
  return 2;
};

const incidentStatusStyles: Record<IncidentStatus, string> = {
  Pending: 'bg-slate-50 text-slate-700 ring-slate-200',
  Dispatched: 'bg-amber-50 text-amber-700 ring-amber-200',
  'En Route': 'bg-blue-50 text-blue-700 ring-blue-200',
  'On Scene': 'bg-red-50 text-red-700 ring-red-200',
  Closed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Canceled: 'bg-slate-100 text-slate-500 ring-slate-200'
};

const incidentPriorityStyles: Record<IncidentPriority, string> = {
  Low: 'bg-slate-100 text-slate-600',
  Normal: 'bg-blue-50 text-blue-700',
  High: 'bg-amber-50 text-amber-700',
  Emergency: 'bg-red-600 text-white'
};

const locationAgeMs = (unit: User, now: number): number | null => {
  if (!unit.lastLocationAt) return null;
  const timestamp = new Date(unit.lastLocationAt).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
};

const locationReliability = (unit: User, now: number): UnitLocationReliability => {
  const age = locationAgeMs(unit, now);
  if (age === null || age >= locationOfflineMs) return 'offline';
  if (age >= locationFreshMs) return 'stale';
  return 'live';
};

const formatRelativeAge = (age: number | null): string => {
  if (age === null) return 'unknown';
  const seconds = Math.max(0, Math.round(age / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
};

const locationReliabilityText = (unit: User, now: number): string => {
  const reliability = locationReliability(unit, now);
  const age = formatRelativeAge(locationAgeMs(unit, now));
  if (reliability === 'live') return `Live - updated ${age}`;
  if (reliability === 'stale') return `Stale - updated ${age}`;
  return `Offline - last update ${age}`;
};

const isClosedIncident = (incident: Incident | null | undefined): boolean =>
  incident?.status === 'Closed' || incident?.status === 'Canceled';

const markerTone = (unit: User, currentUserId?: string, now = Date.now()): 'gray' | 'green' | 'blue' | 'yellow' | 'red' => {
  if (locationReliability(unit, now) !== 'live') return 'gray';
  const status = unit.status;
  if (status === 'En Route') return 'yellow';
  if (status === 'On Scene' || status === 'Traffic Stop') return 'red';
  if (!status) return 'gray';
  return unit.id === currentUserId ? 'green' : 'blue';
};

const markerToneClass = {
  gray: 'bg-slate-500 text-white ring-white',
  green: 'bg-emerald-500 text-white ring-white',
  blue: 'bg-cad-blue text-white ring-white',
  yellow: 'bg-amber-400 text-slate-950 ring-white',
  red: 'bg-red-600 text-white ring-white'
};

const markerPulseClass = {
  gray: 'bg-slate-400/55',
  green: 'bg-emerald-400/60',
  blue: 'bg-cad-blue/50',
  yellow: 'bg-amber-300/65',
  red: 'bg-red-500/60'
};

const realtimeUrl = runtimeConfig.socketUrl;
const googleMapsApiKey = runtimeConfig.googleMapsApiKey;

const darkMapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111827' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d1d5db' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#4b5563' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#243244' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#111827' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1e3a5f' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#93c5fd' }] }
];

const isTrackedUnit = (user: User): user is TrackedUnit =>
  typeof user.lat === 'number' && typeof user.lon === 'number';

const displayStatus = (unit: User): UnitStatus => unit.status || 'Available';
const displayUnitNumber = (unit: User): string => unit.unitNumber || unit.badge || 'Unassigned';
const displayCadUnitNumber = (unit: User): string =>
  unit.cadUnitNumber || (unit.unitNumber ? `CAD-${unit.unitNumber}` : unit.name);
const dispatchUnitStatuses: IncidentUnitStatus[] = ['Assigned', 'Acknowledged', 'En Route', 'On Scene', 'Staged', 'Transporting', 'Cleared'];
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
const compactDestinationLabel = (label?: string): string => {
  if (!label) return 'Destination';
  const callNumber = label.match(/\d{8}-\d{4}/)?.[0];
  return callNumber || label;
};
const splitName = (name: string): { firstName: string; lastName: string } => {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || ''
  };
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

const etaText = (unit: TrackedUnit): string => {
  if (unit.destinationLat === undefined || unit.destinationLon === undefined) return 'No destination';
  const miles = distanceMiles(unit.lat, unit.lon, unit.destinationLat, unit.destinationLon);
  if (!unit.speedMph || unit.speedMph <= 1) return `${miles.toFixed(1)} mi, ETA pending speed`;
  const minutes = Math.max(1, Math.round((miles / unit.speedMph) * 60));
  return `${miles.toFixed(1)} mi, ${minutes} min ETA`;
};

const routeShareLabel = (unit: TrackedUnit): string => {
  if (unit.destinationLat === undefined || unit.destinationLon === undefined) return 'No shared route';
  return `${compactDestinationLabel(unit.destinationLabel)} - ${etaText(unit)}`;
};

const incidentDistanceLabel = (unit: TrackedUnit, incident: Incident): string => {
  if (incident.lat === undefined || incident.lon === undefined) {
    return 'Distance unavailable';
  }
  return `${distanceMiles(unit.lat, unit.lon, incident.lat, incident.lon).toFixed(1)} mi`;
};

const formatDateTime = (value?: Date | string): string => {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
};

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

const addGooglePulseMarker = ({
  map,
  lat,
  lon,
  label,
  tone,
  onClick
}: {
  map: GoogleMapInstance;
  lat: number;
  lon: number;
  label: string;
  tone: 'gray' | 'green' | 'blue' | 'yellow' | 'red';
  onClick?: () => void;
}): GoogleOverlayViewInstance | null => {
  if (!window.google?.maps) {
    return null;
  }

  const position = new window.google.maps.LatLng(lat, lon);

  class PulseOverlay extends window.google.maps.OverlayView {
    private container: HTMLElement | null = null;

    onAdd() {
      const container = document.createElement(onClick ? 'button' : 'div');
      if (container instanceof HTMLButtonElement) {
        container.type = 'button';
      }

      container.className = label
        ? `absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold shadow-lg ring-2 ${markerToneClass[tone]}`
        : `absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full p-0 shadow-lg ring-2 ${markerToneClass[tone]}`;
      container.style.cursor = onClick ? 'pointer' : 'default';

      const pulse = document.createElement('span');
      pulse.className = `pointer-events-none absolute inset-0 -z-10 rounded-full ${markerPulseClass[tone]} location-pulse`;
      container.appendChild(pulse);

      const pin = document.createElement('span');
      pin.className = label ? 'h-3 w-3 shrink-0 rounded-full bg-current ring-2 ring-white/70' : 'h-3 w-3 rounded-full bg-current';
      container.appendChild(pin);

      const text = document.createElement('span');
      if (label) {
        text.textContent = label;
        container.appendChild(text);
      }

      if (onClick) {
        container.addEventListener('click', onClick);
      }

      this.container = container;
      this.getPanes()?.overlayMouseTarget.appendChild(container);
    }

    draw() {
      const point = this.getProjection().fromLatLngToDivPixel(position);
      if (!point || !this.container) {
        return;
      }

      this.container.style.left = `${point.x}px`;
      this.container.style.top = `${point.y}px`;
    }

    onRemove() {
      this.container?.remove();
      this.container = null;
    }
  }

  const overlay = new PulseOverlay();
  overlay.setMap(map);
  return overlay;
};

export const Dashboard: React.FC = () => {
  const { user, logout, hasPermission } = useAuth();
  const [appSidebarCollapsed, setAppSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [locationClock, setLocationClock] = useState(() => Date.now());
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const [callsOverlayOpen, setCallsOverlayOpen] = useState(true);
  const [callDetailOpen, setCallDetailOpen] = useState(true);
  const [units, setUnits] = useState<TrackedUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [, setLocationError] = useState<string>('');
  const [unitLoadError, setUnitLoadError] = useState<string>('');
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [lastRealtimeSync, setLastRealtimeSync] = useState<Date | null>(null);
  const [directory, setDirectory] = useState<User[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [selectedMessageUserId, setSelectedMessageUserId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageThreadSummaries, setMessageThreadSummaries] = useState<MessageThread[]>([]);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageTextSearch, setMessageTextSearch] = useState('');
  const [pinnedMessageThreadIds, setPinnedMessageThreadIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cad_pinned_message_threads') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const [messageBadgeCount, setMessageBadgeCount] = useState(0);
  const [callBadgeCount, setCallBadgeCount] = useState(0);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [messageBody, setMessageBody] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiButton, setEmojiButton] = useState(() => emojiCatalog[Math.floor(Math.random() * emojiCatalog.length)] || '😀');
  const [emojiSearch, setEmojiSearch] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<SendMessageAttachment[]>([]);
  const [typingByThread, setTypingByThread] = useState<Record<string, { name: string; expiresAt: number }>>({});
  const [messagePendingDelete, setMessagePendingDelete] = useState<ChatMessage | null>(null);
  const [threadPendingDeleteUserId, setThreadPendingDeleteUserId] = useState<string | null>(null);
  const [urgentAlerts, setUrgentAlerts] = useState<UrgentAlert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [adminConfig, setAdminConfig] = useState<AdminConfigurationItem[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [activeCallTab, setActiveCallTab] = useState<CallTabId>('all');
  const [callSearch, setCallSearch] = useState('');
  const [mapFilterOpen, setMapFilterOpen] = useState(false);
  const [mapLayers, setMapLayers] = useState<DispatchMapLayers>({
    units: true,
    calls: true,
    geofences: true,
    trails: true,
    traffic: false
  });
  const [addressSuggestions, setAddressSuggestions] = useState<GooglePlacePrediction[]>([]);
  const [addressSuggestionsOpen, setAddressSuggestionsOpen] = useState(false);
  const [incidentForm, setIncidentForm] = useState({
    type: '911 Call',
    priority: 'Normal' as IncidentPriority,
    address: '',
    description: '',
    callerName: '',
    callerPhone: '',
    lat: '',
    lon: ''
  });
  const [incidentError, setIncidentError] = useState('');
  const [assignmentUnitId, setAssignmentUnitId] = useState('');
  const [incidentNoteBody, setIncidentNoteBody] = useState('');
  const [incidentDisposition, setIncidentDisposition] = useState('');
  const [quickLaunchSlots, setQuickLaunchSlots] = useState<QuickLaunchSlot[]>(() => {
    const stored = localStorage.getItem('cad_quick_launch_slots');
    if (!stored) return defaultQuickLaunchSlots;
    try {
      const parsed = JSON.parse(stored) as Array<DockSlotValue<string>>;
      return normalizeQuickLaunchSlots(parsed);
    } catch {
      return defaultQuickLaunchSlots;
    }
  });
  const [activeQuickModal, setActiveQuickModal] = useState<QuickLaunchId | null>(null);
  const [openQuickModals, setOpenQuickModals] = useState<QuickLaunchId[]>([]);
  const [customizingSlot, setCustomizingSlot] = useState<number | null>(null);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [unitBoardSearch, setUnitBoardSearch] = useState('');
  const [unitBoardStatusFilter, setUnitBoardStatusFilter] = useState<UnitStatus | 'all'>('all');
  const [unitBoardDistrictFilter, setUnitBoardDistrictFilter] = useState('all');
  const [unitBoardSort, setUnitBoardSort] = useState<{ key: UnitBoardSortKey; direction: SortDirection }>({
    key: 'status',
    direction: 'asc'
  });
  const [modalZOrder, setModalZOrder] = useState<Record<QuickLaunchId, number>>({} as Record<QuickLaunchId, number>);
  const modalZCounterRef = useRef(60);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapInstance | null>(null);
  const mapOverlaysRef = useRef<GoogleOverlayViewInstance[]>([]);
  const mapPolylinesRef = useRef<GooglePolylineInstance[]>([]);
  const mapPolygonsRef = useRef<GooglePolygonInstance[]>([]);
  const trafficLayerRef = useRef<GoogleTrafficLayerInstance | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const selectedMessageUserIdRef = useRef('');
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const activeQuickModalRef = useRef<QuickLaunchId | null>(null);
  const directoryRef = useRef<User[]>([]);
  const latestPositionRef = useRef<GeolocationPosition | null>(null);
  const locationPublishInFlightRef = useRef(false);
  const knownIncidentIdsRef = useRef<Set<string>>(new Set());
  const initialIncidentsLoadedRef = useRef(false);

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || units[0] || null;
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || incidents[0] || null;
  const center = currentLocation || selectedUnit || { lat: 39.7684, lon: -86.1581 };
  const configuredCallTypes = useMemo(() => callTypesFromConfig(adminConfig), [adminConfig]);
  const configuredGeofences = useMemo(() => geofencesFromConfig(adminConfig), [adminConfig]);

  const loadUnits = useCallback(async () => {
    try {
      const response = await authClient.getTrackedUnits();
      const trackedUnits = response.filter(isTrackedUnit);
      setUnits(trackedUnits);
      setUnitLoadError('');
      setSelectedUnitId((current) => {
        if (current) {
          return current;
        }
        return trackedUnits[0]?.id || '';
      });
    } catch {
      setUnitLoadError('Unable to load tracked units.');
    }
  }, []);

  const unitBoardUnits = useMemo<UnitBoardUser[]>(() => {
    const trackedById = new Map(units.map((unit) => [unit.id, unit]));
    return directory
      .filter((item) => {
        const hasUnitIdentity = Boolean(item.unitNumber || item.cadUnitNumber || item.badge || item.status);
        return (
          item.id !== user?.id &&
          item.active !== false &&
          onlineUserIds.includes(item.id) &&
          (item.role === UserRole.OFFICER || item.role === UserRole.ADMIN || hasUnitIdentity)
        );
      })
      .map((item) => ({ ...item, ...trackedById.get(item.id) }));
  }, [directory, onlineUserIds, units, user?.id]);
  const unitBoardStatuses = useMemo(
    () => Array.from(new Set(unitBoardUnits.map((unit) => displayStatus(unit)))).sort((first, second) => first.localeCompare(second)),
    [unitBoardUnits]
  );
  const unitBoardDistricts = useMemo(
    () =>
      Array.from(new Set(unitBoardUnits.map((unit) => unit.district || 'Unassigned'))).sort((first, second) =>
        first.localeCompare(second)
      ),
    [unitBoardUnits]
  );
  const unitBoardRows = useMemo(() => {
    const query = unitBoardSearch.trim().toLowerCase();
    const filtered = unitBoardUnits.filter((unit) => {
      const status = displayStatus(unit);
      const district = unit.district || 'Unassigned';
      const name = splitName(unit.name);
      const searchText = [
        status,
        displayUnitNumber(unit),
        displayCadUnitNumber(unit),
        unit.name,
        name.firstName,
        name.lastName,
        district,
        unit.group
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (
        (unitBoardStatusFilter === 'all' || status === unitBoardStatusFilter) &&
        (unitBoardDistrictFilter === 'all' || district === unitBoardDistrictFilter) &&
        (!query || searchText.includes(query))
      );
    });

    return [...filtered].sort((first, second) => {
      const firstStatus = displayStatus(first);
      const secondStatus = displayStatus(second);
      const value = (() => {
        if (unitBoardSort.key === 'status') {
          return unitBoardStatusRank(firstStatus) - unitBoardStatusRank(secondStatus) || firstStatus.localeCompare(secondStatus);
        }
        if (unitBoardSort.key === 'unit') return displayUnitNumber(first).localeCompare(displayUnitNumber(second));
        if (unitBoardSort.key === 'name') return first.name.localeCompare(second.name);
        if (unitBoardSort.key === 'cadUnit') return displayCadUnitNumber(first).localeCompare(displayCadUnitNumber(second));
        return (first.district || 'Unassigned').localeCompare(second.district || 'Unassigned');
      })();
      return unitBoardSort.direction === 'asc' ? value : -value;
    });
  }, [unitBoardDistrictFilter, unitBoardSearch, unitBoardSort.direction, unitBoardSort.key, unitBoardStatusFilter, unitBoardUnits]);
  const selectedUnitBoardUnit = useMemo(
    () => unitBoardRows.find((unit) => unit.id === selectedUnitId) || unitBoardRows[0] || null,
    [selectedUnitId, unitBoardRows]
  );
  const recommendedUnits = useMemo(() => {
    if (!selectedIncident) {
      return [];
    }
    const assignedIds = new Set(selectedIncident.units.map((unit) => unit.userId));
    return units
      .filter((unit) => !assignedIds.has(unit.id))
      .map((unit) => {
        const distance =
          selectedIncident.lat !== undefined && selectedIncident.lon !== undefined
            ? distanceMiles(unit.lat, unit.lon, selectedIncident.lat, selectedIncident.lon)
            : Number.POSITIVE_INFINITY;
        const status = displayStatus(unit);
        const statusScore = status === 'Available' ? 0 : status === 'Dispatched' ? 20 : status === 'En Route' ? 35 : 50;
        const districtScore =
          selectedIncident.address && unit.district && selectedIncident.address.toLowerCase().includes(unit.district.toLowerCase())
            ? -5
            : 0;
        return { unit, distance, score: statusScore + districtScore + (Number.isFinite(distance) ? distance : 25) };
      })
      .sort((first, second) => first.score - second.score)
      .slice(0, 5);
  }, [selectedIncident, units]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  const loadIncidents = useCallback(async () => {
    try {
      const response = await authClient.getIncidents();
      knownIncidentIdsRef.current = new Set(response.map((incident) => incident.id));
      initialIncidentsLoadedRef.current = true;
      setIncidents(response);
      setIncidentError('');
      setSelectedIncidentId((current) => {
        if (current && response.some((incident) => incident.id === current)) {
          return current;
        }
        return response[0]?.id || '';
      });
    } catch {
      setIncidentError('Unable to load active calls.');
    }
  }, []);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    authClient.getActiveConfiguration().then(setAdminConfig).catch(() => setAdminConfig([]));
  }, []);

  useEffect(() => {
    if (!incidentForm.type && configuredCallTypes[0]) {
      setIncidentForm((value) => ({
        ...value,
        type: configuredCallTypes[0].label,
        priority: configuredCallTypes[0].priority
      }));
    }
  }, [configuredCallTypes, incidentForm.type]);

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

  const loadDirectory = useCallback(async () => {
    const users = await authClient.getDirectory();
    setDirectory(users);
    setSelectedMessageUserId((current) => current || users.find((item) => item.id !== user?.id)?.id || '');
    loadMessageThreads();
    loadUrgentAlerts();
  }, [loadMessageThreads, loadUrgentAlerts, user?.id]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);


  useEffect(() => {
    localStorage.setItem('cad_quick_launch_slots', JSON.stringify(quickLaunchSlots));
  }, [quickLaunchSlots]);

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  useEffect(() => {
    const clockId = window.setInterval(() => setLocationClock(Date.now()), 5000);
    return () => window.clearInterval(clockId);
  }, []);

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
    activeQuickModalRef.current = activeQuickModal;
  }, [activeQuickModal]);

  useEffect(() => {
    if (!activeQuickModal) return;
    setOpenQuickModals((current) => (current.includes(activeQuickModal) ? current : [...current, activeQuickModal]));
    modalZCounterRef.current += 1;
    setModalZOrder((current) => ({ ...current, [activeQuickModal]: modalZCounterRef.current }));
  }, [activeQuickModal]);

  const focusQuickModal = useCallback((modalId: QuickLaunchId) => {
    modalZCounterRef.current += 1;
    setActiveQuickModal(modalId);
    setModalZOrder((current) => ({ ...current, [modalId]: modalZCounterRef.current }));
  }, []);

  const closeQuickModal = useCallback((modalId: QuickLaunchId) => {
    setOpenQuickModals((current) => current.filter((item) => item !== modalId));
    setActiveQuickModal((current) => {
      if (current !== modalId) return current;
      const remaining = openQuickModals.filter((item) => item !== modalId);
      return remaining[remaining.length - 1] || null;
    });
  }, [openQuickModals]);

  useEffect(() => {
    directoryRef.current = directory;
  }, [directory]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (emojiOpen) {
        setEmojiOpen(false);
        return;
      }
      if (addressSuggestionsOpen) {
        setAddressSuggestionsOpen(false);
        return;
      }
      if (changePasswordOpen) {
        setChangePasswordOpen(false);
        return;
      }
      if (customizingSlot !== null) {
        setCustomizingSlot(null);
        return;
      }
      if (activeQuickModal) {
        closeQuickModal(activeQuickModal);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activeQuickModal, addressSuggestionsOpen, changePasswordOpen, closeQuickModal, customizingSlot, emojiOpen, settingsOpen]);

  const playAlert = useCallback((kind: 'message' | 'call') => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === 'message' ? 'sine' : 'triangle';
      oscillator.frequency.value = kind === 'message' ? 740 : 520;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.24);
    } catch {
      // Browsers may block audio before user interaction.
    }
  }, []);

  const pushToast = useCallback((notice: Omit<ToastNotice, 'id'>) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [{ ...notice, id }, ...current].slice(0, 5));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5200);
  }, []);

  const publishLiveLocation = useCallback(async (position: GeolocationPosition) => {
    if (locationPublishInFlightRef.current) {
      latestPositionRef.current = position;
      return;
    }

    locationPublishInFlightRef.current = true;
    latestPositionRef.current = position;

    const nextLocation = {
      lat: position.coords.latitude,
      lon: position.coords.longitude
    };
    const speedMph =
      typeof position.coords.speed === 'number' && position.coords.speed >= 0
        ? position.coords.speed * 2.236936
        : null;

    setCurrentLocation(nextLocation);
    setLocationError('');

    try {
      const updatedUser = await authClient.updateLocation(nextLocation.lat, nextLocation.lon, speedMph);
      if (isTrackedUnit(updatedUser)) {
        setUnits((currentUnits) => {
          const others = currentUnits.filter((unit) => unit.id !== updatedUser.id);
          return [updatedUser, ...others];
        });
        setSelectedUnitId((current) => current || updatedUser.id);
      }
    } catch {
      setLocationError('Location detected, but the server did not save it.');
    } finally {
      locationPublishInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const query = incidentForm.address.trim();
    if (query.length < 3 || !window.google?.maps.places?.AutocompleteService) {
      setAddressSuggestions([]);
      return;
    }

    const service = new window.google.maps.places.AutocompleteService();
    const timer = window.setTimeout(() => {
      service.getPlacePredictions(
        {
          input: query,
          componentRestrictions: { country: 'us' },
          types: ['geocode']
        },
        (predictions, status) => {
          if (status === window.google?.maps.places?.PlacesServiceStatus.OK && predictions) {
            setAddressSuggestions(predictions.slice(0, 5));
            return;
          }
          setAddressSuggestions([]);
        }
      );
    }, 180);

    return () => window.clearTimeout(timer);
  }, [incidentForm.address]);

  useEffect(() => {
    const token = authClient.getAccessToken();
    const socket = io(realtimeUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      auth: token ? { token } : undefined,
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
      setUnitLoadError('');
      requestResync('connect');
    });
    socket.io.on('reconnect_attempt', () => {
      setRealtimeState('reconnecting');
    });
    socket.io.on('reconnect', () => {
      setRealtimeState('live');
      requestResync('reconnect');
      pushToast({ title: 'Realtime restored', message: 'CAD data resynced.', tone: 'success' });
    });
    socket.io.on('reconnect_error', () => {
      setRealtimeState('reconnecting');
    });
    socket.io.on('reconnect_failed', () => {
      setRealtimeState('offline');
    });
    socket.on('disconnect', () => {
      setRealtimeState('offline');
    });
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
      setRealtimeState('reconnecting');
      setUnitLoadError('Live unit stream unavailable. Retrying connection.');
    });
    socket.on('presence:update', (presence: { onlineUserIds: string[]; users: User[] }) => {
      setOnlineUserIds(presence.onlineUserIds || []);
      setDirectory(presence.users || []);
    });
    socket.on('incidents:update', (nextIncidents: Incident[]) => {
      const incoming = nextIncidents || [];
      if (initialIncidentsLoadedRef.current) {
        const newIncidents = incoming.filter((incident) => !knownIncidentIdsRef.current.has(incident.id));
        if (newIncidents.length > 0) {
          setCallBadgeCount((count) => count + newIncidents.length);
          playAlert('call');
          pushToast({
            title: 'New call',
            message: `${newIncidents[0].callNumber} ${newIncidents[0].type}`,
            tone: newIncidents[0].priority === 'Emergency' || newIncidents[0].priority === 'High' ? 'warning' : 'info'
          });
        }
      }
      knownIncidentIdsRef.current = new Set(incoming.map((incident) => incident.id));
      initialIncidentsLoadedRef.current = true;
      setIncidents(incoming);
      setIncidentError('');
      setSelectedIncidentId((current) => {
        if (current && incoming.some((incident) => incident.id === current)) {
          return current;
        }
        return incoming[0]?.id || '';
      });
    });
    socket.on('urgent-alerts:update', () => {
      loadUrgentAlerts();
      playAlert('call');
    });
    socket.on('message:new', (message: ChatMessage) => {
      const incomingForMe = message.recipientId === user?.id && message.senderId !== user?.id;
      const otherUserId = message.senderId === user?.id ? message.recipientId : message.senderId;
      const conversationOpen =
        activeQuickModalRef.current === 'messages' && selectedMessageUserIdRef.current === otherUserId;
      if (incomingForMe) {
        if (conversationOpen) {
          authClient.markMessagesRead(otherUserId).catch(() => undefined);
        } else {
          setMessageBadgeCount((count) => count + 1);
          playAlert('message');
        }
        const sender = directoryRef.current.find((item) => item.id === message.senderId);
        pushToast({
          title: 'New message',
          message: `${sender?.name || 'Unit'}: ${message.body || `${message.attachments.length} attachment(s)`}`,
          tone: 'info'
        });
      }
      setMessageThreadSummaries((current) => {
        const existing = current.find((thread) => thread.userId === otherUserId);
        const nextThread: MessageThread = {
          userId: otherUserId,
          lastMessage: conversationOpen && incomingForMe ? { ...message, readAt: new Date() } : message,
          unreadCount: incomingForMe && !conversationOpen ? (existing?.unreadCount || 0) + 1 : existing?.unreadCount || 0,
          updatedAt: message.createdAt
        };
        return [nextThread, ...current.filter((thread) => thread.userId !== otherUserId)];
      });
      setMessages((current) => {
        const belongsToSelected =
          message.senderId === selectedMessageUserIdRef.current ||
          message.recipientId === selectedMessageUserIdRef.current ||
          message.senderId === user?.id ||
          message.recipientId === user?.id;
        if (!belongsToSelected || current.some((item) => item.id === message.id)) {
          return current;
        }
        return [...current, message];
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
      setMessages((current) =>
        current.map((message) =>
          receipt.messageIds.includes(message.id) ? { ...message, readAt: new Date() } : message
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
  }, [loadMessageThreads, loadUrgentAlerts, playAlert, pushToast, user?.id]);

  useEffect(() => {
    const socket = socketRef.current;
    const token = authClient.getAccessToken();
    if (socket && token) {
      socket.auth = { token };
      socket.disconnect().connect();
    }
  }, [user?.id]);

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
    if (!navigator.geolocation) {
      setLocationError('Location unavailable');
      return;
    }

    const watcherId = navigator.geolocation.watchPosition(
      publishLiveLocation,
      () => setLocationError('Allow browser location access to track your position.'),
      liveLocationOptions
    );

    const heartbeatId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      navigator.geolocation.getCurrentPosition(
        publishLiveLocation,
        () => setLocationError('Allow browser location access to track your position.'),
        liveLocationOptions
      );
    }, liveLocationHeartbeatMs);

    return () => {
      navigator.geolocation.clearWatch(watcherId);
      window.clearInterval(heartbeatId);
    };
  }, [publishLiveLocation]);

  useEffect(() => {
    if (!googleMapsApiKey || !mapRef.current) {
      return;
    }

    const scriptId = 'google-maps-script';
    const initializeMap = () => {
      if (!window.google?.maps || !mapRef.current) {
        return;
      }

      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: center.lat, lng: center.lon },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: theme === 'dark' ? darkMapStyles : []
        });
      }

      const map = mapInstanceRef.current;
      map.setOptions({ styles: theme === 'dark' ? darkMapStyles : [] });
      mapOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      mapOverlaysRef.current = [];
      mapPolylinesRef.current.forEach((polyline) => polyline.setMap(null));
      mapPolylinesRef.current = [];
      mapPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
      mapPolygonsRef.current = [];
      trafficLayerRef.current?.setMap(null);
      trafficLayerRef.current = null;

      if (mapLayers.traffic && window.google?.maps.TrafficLayer) {
        trafficLayerRef.current = new window.google.maps.TrafficLayer();
        trafficLayerRef.current.setMap(map);
      }

      if (mapLayers.geofences) {
        configuredGeofences.forEach((geofence) => {
          const googleMaps = window.google?.maps;
          if (!googleMaps?.Polygon) return;
          geofence.rings.forEach((ring) => {
            const polygon = new googleMaps.Polygon({
              paths: ring.map((point) => ({ lat: point.lat, lng: point.lon })),
              strokeColor: geofence.color,
              strokeOpacity: geofence.kind === 'beat' ? 0.85 : 0.7,
              strokeWeight: geofence.kind === 'beat' ? 2 : 3,
              fillColor: geofence.color,
              fillOpacity: geofence.kind === 'beat' ? 0.09 : 0.06,
              map
            });
            mapPolygonsRef.current.push(polygon);
          });
        });
      }

      units.forEach((unit) => {
        const shouldShowTrail = mapLayers.trails && displayStatus(unit) === 'En Route' && (unit.locationTrail?.length || 0) > 1;
        if (shouldShowTrail && window.google?.maps.Polyline) {
          const trail = unit.locationTrail || [];
          const polyline = new window.google.maps.Polyline({
            path: trail.map((point) => ({ lat: point.lat, lng: point.lon })),
            geodesic: true,
            strokeColor: unit.id === user?.id ? '#10b981' : '#2563eb',
            strokeOpacity: 0.9,
            strokeWeight: 4,
            map
          });
          mapPolylinesRef.current.push(polyline);
        }
        const messageButtonId = `message-unit-${unit.id}`;
        const infoWindow = new window.google!.maps.InfoWindow({
          content: `
            <div style="min-width:180px;font-family:Arial,sans-serif;color:#0f172a">
              <div style="font-weight:700;margin-bottom:2px">${escapeHtml(displayCadUnitNumber(unit))}</div>
              <div>${escapeHtml(unit.name)}</div>
              <div style="margin-top:4px;font-size:12px;color:#475569">${escapeHtml(displayStatus(unit))}</div>
              <div style="font-size:12px;color:#475569">${escapeHtml(locationReliabilityText(unit, locationClock))}</div>
              ${
                unit.destinationLat !== undefined && unit.destinationLon !== undefined
                  ? `<div style="margin-top:6px;font-size:12px;color:#92400e;font-weight:700">${escapeHtml(routeShareLabel(unit))}</div>`
                  : ''
              }
              ${
                unit.id !== user?.id
                  ? `<button id="${messageButtonId}" type="button" style="margin-top:8px;border:0;border-radius:6px;background:#2563eb;color:white;padding:6px 10px;font-weight:700;cursor:pointer">Message</button>`
                  : ''
              }
            </div>
          `
        });
        infoWindow.addListener('domready', () => {
          const button = document.getElementById(messageButtonId);
          if (!button) return;
          button.onclick = () => {
            setSelectedMessageUserId(unit.id);
            setMessageBody('');
            setMessageSearch('');
            setActiveQuickModal('messages');
          };
        });
        if (mapLayers.trails && unit.destinationLat !== undefined && unit.destinationLon !== undefined && window.google?.maps.Polyline) {
          const routeLine = new window.google.maps.Polyline({
            path: [
              { lat: unit.lat, lng: unit.lon },
              { lat: unit.destinationLat, lng: unit.destinationLon }
            ],
            geodesic: true,
            strokeColor: '#f59e0b',
            strokeOpacity: 0.78,
            strokeWeight: 4,
            map
          });
          mapPolylinesRef.current.push(routeLine);
        }
        if (!mapLayers.units) return;
        const unitOverlay = addGooglePulseMarker({
          map,
          lat: unit.lat,
          lon: unit.lon,
          label:
            displayStatus(unit) === 'En Route'
              ? `${unit.id === user?.id ? '' : `${displayCadUnitNumber(unit)} `}${(unit.speedMph || 0).toFixed(0)} mph`.trim()
              : unit.id === user?.id ? '' : displayCadUnitNumber(unit),
          tone: markerTone(unit, user?.id, locationClock),
          onClick: () => {
            setSelectedUnitId(unit.id);
            infoWindow.open({ map, position: { lat: unit.lat, lng: unit.lon } });
          }
        });
        if (unitOverlay) mapOverlaysRef.current.push(unitOverlay);
        if (unit.destinationLat !== undefined && unit.destinationLon !== undefined) {
          const destinationOverlay = addGooglePulseMarker({
            map,
            lat: unit.destinationLat,
            lon: unit.destinationLon,
            label: compactDestinationLabel(unit.destinationLabel),
            tone: 'yellow'
          });
          if (destinationOverlay) mapOverlaysRef.current.push(destinationOverlay);
        }
      });

      if (currentLocation && !units.some((unit) => unit.id === user?.id)) {
        const currentLocationOverlay = addGooglePulseMarker({
          map,
          lat: currentLocation.lat,
          lon: currentLocation.lon,
          label: 'You',
          tone: 'blue'
        });
        if (currentLocationOverlay) mapOverlaysRef.current.push(currentLocationOverlay);
      }

      if (mapLayers.calls) incidents
        .filter((incident) => incident.lat !== undefined && incident.lon !== undefined)
        .forEach((incident) => {
          const incidentOverlay = addGooglePulseMarker({
            map,
            lat: incident.lat as number,
            lon: incident.lon as number,
            label: incident.callNumber,
            tone: incident.priority === 'Emergency' || incident.priority === 'High' ? 'red' : 'yellow',
            onClick: () => setSelectedIncidentId(incident.id)
          });
          if (incidentOverlay) mapOverlaysRef.current.push(incidentOverlay);
        });

    };

    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      initializeMap();
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places`;
    script.async = true;
    script.onload = initializeMap;
    document.head.appendChild(script);
  }, [center.lat, center.lon, configuredGeofences, currentLocation, incidents, locationClock, mapLayers, theme, units, user?.id]);

  const recenterToCurrentLocation = () => {
    const target = currentLocation || center;
    mapInstanceRef.current?.setCenter({ lat: target.lat, lng: target.lon });
    mapInstanceRef.current?.setZoom(14);
  };

  const toggleMapLayer = (layer: keyof DispatchMapLayers) => {
    setMapLayers((current) => ({ ...current, [layer]: !current[layer] }));
  };

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
    const query = messageSearch.trim().toLowerCase();
    if (!query) return true;
    return [item.name, item.cadUnitNumber, item.unitNumber]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  }).sort((first, second) => {
    const firstPinned = pinnedMessageThreadIds.includes(first.id);
    const secondPinned = pinnedMessageThreadIds.includes(second.id);
    if (firstPinned !== secondPinned) return firstPinned ? -1 : 1;
    const firstThread = messageThreadByUser[first.id];
    const secondThread = messageThreadByUser[second.id];
    return new Date(secondThread?.updatedAt || 0).getTime() - new Date(firstThread?.updatedAt || 0).getTime();
  });
  const visibleMessages = messages.filter(
    (message) =>
      (message.senderId === user?.id && message.recipientId === selectedMessageUserId) ||
      (message.senderId === selectedMessageUserId && message.recipientId === user?.id)
  );
  const searchedMessages = visibleMessages;
  const selectedTyping = selectedMessageUserId ? typingByThread[selectedMessageUserId] : null;
  const filteredEmojis = emojiCatalog.filter((emoji) => !emojiSearch.trim() || emoji.includes(emojiSearch.trim()));
  const sidebarItems: ShieldSidebarItem[] = [
    { id: 'cjis', label: 'CJIS', icon: Shield, iconClassName: 'text-blue-700', onClick: () => setActiveQuickModal('inquiries') },
    { id: 'unit-status', label: 'Unit Status', icon: Users, iconClassName: 'text-indigo-700', onClick: () => setActiveQuickModal('units') },
    { id: 'calls', label: 'Calls', icon: ClipboardList, badge: callBadgeCount, iconClassName: 'text-amber-700', onClick: () => setActiveQuickModal('calls') },
    { id: 'messages', label: 'Messages', icon: MessageCircle, badge: messageBadgeCount, iconClassName: 'text-emerald-700', onClick: () => openQuickLaunch('messages') },
    { id: 'protect', label: 'Protect Ord', icon: Search, iconClassName: 'text-red-700', onClick: () => setActiveQuickModal('protective-orders') }
  ];
  useEffect(() => {
    localStorage.setItem('cad_pinned_message_threads', JSON.stringify(pinnedMessageThreadIds));
  }, [pinnedMessageThreadIds]);

  const togglePinnedMessageThread = (threadId: string) => {
    setPinnedMessageThreadIds((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [threadId, ...current]
    );
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

  const reactToMessage = async (message: ChatMessage, reaction: string) => {
    const currentReaction = getMessageReactionForUser(message, user?.id);
    const nextReaction = currentReaction === reaction ? null : reaction;
    try {
      const updated = await authClient.reactToMessage(message.id, nextReaction);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      pushToast({ title: 'Reaction failed', message: 'Unable to update message reaction.', tone: 'warning' });
    }
  };

  const deleteChatMessage = async (message: ChatMessage) => {
    try {
      const messageIds = await authClient.deleteMessage(message.id);
      setMessages((current) => current.filter((item) => !messageIds.includes(item.id)));
      setMessagePendingDelete(null);
      loadMessageThreads();
    } catch {
      pushToast({ title: 'Delete failed', message: 'Unable to delete message.', tone: 'warning' });
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
      pushToast({ title: 'Delete failed', message: 'Unable to delete conversation.', tone: 'warning' });
    }
  };

  const sendChatMessage = async () => {
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
      setMessages((current) => current.map((item) => (item.id === tempId ? { ...sent, deliveryStatus: 'sent' } : item)));
      loadMessageThreads();
    } catch {
      setMessages((current) => current.map((item) => (item.id === tempId ? { ...item, deliveryStatus: 'failed' } : item)));
      pushToast({ title: 'Message failed', message: 'Unable to send message. Try again.', tone: 'warning' });
    }
  };

  const openEmojiPicker = () => {
    setEmojiButton(emojiCatalog[Math.floor(Math.random() * emojiCatalog.length)] || '😀');
    setEmojiOpen((value) => !value);
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
      setPasswordMessage('Password changed. Sign in again on other devices.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch {
      setPasswordMessage('Unable to change password. Check your current password.');
    }
  };

  const attachFiles = async (files: FileList | null) => {
    if (!files) return;
    const nextAttachments = await Promise.all(
      Array.from(files)
        .slice(0, 5)
        .map(
          (file) =>
            new Promise<SendMessageAttachment | null>((resolve) => {
              if (file.size > 5 * 1024 * 1024) {
                resolve(null);
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  fileName: file.name,
                  mimeType: file.type || 'application/octet-stream',
                  dataUrl: String(reader.result)
                });
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(file);
            })
        )
    );
    setPendingAttachments((current) =>
      [...current, ...(nextAttachments.filter(Boolean) as SendMessageAttachment[])].slice(0, 5)
    );
  };

  const selectAddressSuggestion = (suggestion: GooglePlacePrediction) => {
    setIncidentForm((value) => ({ ...value, address: suggestion.description }));
    setAddressSuggestionsOpen(false);

    if (!window.google?.maps.Geocoder) {
      return;
    }

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ placeId: suggestion.place_id }, (results, status) => {
      const location = status === 'OK' ? results?.[0]?.geometry?.location : undefined;
      if (!location) {
        return;
      }

      setIncidentForm((value) => ({
        ...value,
        address: suggestion.description,
        lat: location.lat().toFixed(7),
        lon: location.lng().toFixed(7)
      }));
    });
  };

  const createIncident = async () => {
    if (!incidentForm.type.trim() || !incidentForm.address.trim()) {
      setIncidentError('Call type and address are required.');
      return;
    }

    try {
      const latText = incidentForm.lat.trim();
      const lonText = incidentForm.lon.trim();
      const hasLat = latText.length > 0;
      const hasLon = lonText.length > 0;
      if (hasLat !== hasLon) {
        setIncidentError('Enter both latitude and longitude, or leave both blank.');
        return;
      }

      const lat = hasLat ? Number(latText) : null;
      const lon = hasLon ? Number(lonText) : null;
      if (
        (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
        (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180))
      ) {
        setIncidentError('Coordinates must be valid latitude and longitude values.');
        return;
      }
      const geofenceAssignment = geofenceAssignmentForPoint(
        lat !== null && lon !== null ? { lat, lon } : null,
        configuredGeofences
      );

      const incident = await authClient.createIncident({
        type: incidentForm.type,
        priority: incidentForm.priority,
        address: incidentForm.address,
        description: incidentForm.description,
        callerName: incidentForm.callerName,
        callerPhone: incidentForm.callerPhone,
        district: geofenceAssignment.district || null,
        beat: geofenceAssignment.beat || null,
        lat,
        lon
      });
      setIncidents((current) => [incident, ...current.filter((item) => item.id !== incident.id)]);
      setSelectedIncidentId(incident.id);
      closeQuickModal('new-call');
      setIncidentError('');
      setIncidentForm({
        type: configuredCallTypes[0]?.label || '911 Call',
        priority: configuredCallTypes[0]?.priority || 'Normal',
        address: '',
        description: '',
        callerName: '',
        callerPhone: '',
        lat: '',
        lon: ''
      });
    } catch (error) {
      const apiMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { error?: unknown } } }).response?.data?.error === 'string'
          ? (error as { response: { data: { error: string } } }).response.data.error
          : '';
      setIncidentError(apiMessage || 'Unable to create the call. Check the required fields and coordinates.');
    }
  };

  const submitInquiry = async (submission: InquirySubmission) => {
    try {
      const incident = await authClient.createIncident({
        type: submission.title,
        priority: 'Normal',
        address: `${submission.type} ${submission.kind.toUpperCase()} inquiry`,
        description: submission.description,
        callerName: user?.name,
        callerPhone: ''
      });
      setIncidents((current) => [incident, ...current.filter((item) => item.id !== incident.id)]);
      setSelectedIncidentId(incident.id);
      focusQuickModal('call-detail');
      setIncidentError('');
    } catch (error) {
      const apiMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { error?: unknown } } }).response?.data?.error === 'string'
          ? (error as { response: { data: { error: string } } }).response.data.error
          : '';
      setIncidentError(apiMessage || 'Unable to submit inquiry.');
    }
  };

  const acknowledgeUrgentAlert = async (alertId: string) => {
    try {
      await authClient.acknowledgeUrgentAlert(alertId);
      setUrgentAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch {
      pushToast({ title: 'Alert acknowledgement failed', message: 'Try again in a moment.', tone: 'warning' });
    }
  };

  const updateIncidentStatus = async (status: IncidentStatus) => {
    if (!selectedIncident) return;
    try {
      const disposition = status === 'Closed' || status === 'Canceled' ? incidentDisposition : undefined;
      const incident = await authClient.updateIncidentStatus(selectedIncident.id, status, disposition);
      setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
      setIncidentDisposition('');
      setIncidentError('');
    } catch (error) {
      const apiMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { error?: unknown } } }).response?.data?.error === 'string'
          ? (error as { response: { data: { error: string } } }).response.data.error
          : '';
      setIncidentError(apiMessage || 'Unable to update call.');
    }
  };

  const reopenIncident = async () => {
    if (!selectedIncident) return;
    try {
      const incident = await authClient.reopenIncident(selectedIncident.id);
      setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
      setIncidentDisposition('');
      setIncidentError('');
    } catch (error) {
      const apiMessage =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof (error as { response?: { data?: { error?: unknown } } }).response?.data?.error === 'string'
          ? (error as { response: { data: { error: string } } }).response.data.error
          : '';
      setIncidentError(apiMessage || 'Unable to reopen call.');
    }
  };

  const assignIncidentUnit = async () => {
    if (!selectedIncident || !assignmentUnitId) return;
    try {
      const incident = await authClient.assignIncidentUnit(selectedIncident.id, assignmentUnitId, 'Assigned');
      setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
      setAssignmentUnitId('');
      setIncidentError('');
    } catch {
      setIncidentError('Unable to assign unit.');
    }
  };

  const assignRecommendedUnit = async (unitId: string) => {
    if (!selectedIncident) return;
    try {
      const incident = await authClient.assignIncidentUnit(selectedIncident.id, unitId, 'Assigned');
      setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
      setIncidentError('');
    } catch {
      setIncidentError('Unable to assign recommended unit.');
    }
  };

  const updateAssignedUnitStatus = async (userId: string, status: IncidentUnitStatus) => {
    if (!selectedIncident) return;
    try {
      const incident = await authClient.assignIncidentUnit(selectedIncident.id, userId, status);
      setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
      setIncidentError('');
    } catch {
      setIncidentError('Unable to update unit status.');
    }
  };

  const addIncidentNote = async () => {
    if (!selectedIncident || !incidentNoteBody.trim()) return;
    await authClient.addIncidentNote(selectedIncident.id, incidentNoteBody);
    const response = await authClient.getIncidents();
    setIncidents(response);
    setIncidentNoteBody('');
  };

  const assignQuickLaunchSlot = (index: number, value: QuickLaunchSlot) => {
    setQuickLaunchSlots((current) => current.map((slot, slotIndex) => (slotIndex === index ? value : slot)));
    setCustomizingSlot(null);
  };

  const swapQuickLaunchSlots = (targetIndex: number) => {
    if (draggedSlotIndex === null || draggedSlotIndex === targetIndex) return;
    setQuickLaunchSlots((current) => {
      const next = [...current];
      const source = next[draggedSlotIndex];
      next[draggedSlotIndex] = next[targetIndex];
      next[targetIndex] = source;
      return next;
    });
    setDraggedSlotIndex(null);
  };

  const openQuickLaunch = (item: QuickLaunchId) => {
    if (item === 'messages') {
      setMessageBadgeCount(0);
    }
    if (item === 'calls' || item === 'new-call' || item === 'call-detail') {
      setCallBadgeCount(0);
    }
    if (item === 'settings') {
      setSettingsOpen(false);
    }
    focusQuickModal(item);
  };
  const setUnitBoardSortKey = (key: UnitBoardSortKey) => {
    setUnitBoardSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const quickModalTitle = (modalId: QuickLaunchId) =>
    quickLaunchOptions.find((item) => item.id === modalId)?.label || 'Quick Launch';
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

  const renderNewCallForm = () => (
    <div className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
      <select
        value={incidentForm.type}
        onChange={(event) => {
          const callType = configuredCallTypes.find((item) => item.label === event.target.value);
          setIncidentForm((value) => ({
            ...value,
            type: event.target.value,
            priority: callType?.priority || value.priority
          }));
        }}
        className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        {configuredCallTypes.map((callType) => (
          <option key={callType.label} value={callType.label}>
            {callType.label}
          </option>
        ))}
      </select>
      <select
        value={incidentForm.priority}
        onChange={(event) =>
          setIncidentForm((value) => ({ ...value, priority: event.target.value as IncidentPriority }))
        }
        className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        {(['Low', 'Normal', 'High', 'Emergency'] as IncidentPriority[]).map((priority) => (
          <option key={priority} value={priority}>
            {priority}
          </option>
        ))}
      </select>
      <div className="relative sm:col-span-2">
        <input
          value={incidentForm.address}
          onChange={(event) => {
            setIncidentForm((value) => ({ ...value, address: event.target.value }));
            setAddressSuggestionsOpen(true);
          }}
          onFocus={() => setAddressSuggestionsOpen(true)}
          placeholder="Address"
          className="w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        {addressSuggestionsOpen && addressSuggestions.length > 0 && (
          <div className="absolute inset-x-0 top-11 z-20 rounded-md border border-cad-line bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            {addressSuggestions.map((suggestion) => (
              <button
                key={suggestion.place_id}
                type="button"
                onClick={() => selectAddressSuggestion(suggestion)}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-blue-50 dark:border-slate-800 dark:hover:bg-slate-800"
              >
                {suggestion.description}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        value={incidentForm.callerName}
        onChange={(event) => setIncidentForm((value) => ({ ...value, callerName: event.target.value }))}
        placeholder="Caller name"
        className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      <input
        value={incidentForm.callerPhone}
        onChange={(event) => setIncidentForm((value) => ({ ...value, callerPhone: event.target.value }))}
        placeholder="Caller phone"
        className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      <input
        value={incidentForm.lat}
        onChange={(event) => setIncidentForm((value) => ({ ...value, lat: event.target.value }))}
        placeholder="Lat"
        className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      <input
        value={incidentForm.lon}
        onChange={(event) => setIncidentForm((value) => ({ ...value, lon: event.target.value }))}
        placeholder="Lon"
        className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      <textarea
        value={incidentForm.description}
        onChange={(event) => setIncidentForm((value) => ({ ...value, description: event.target.value }))}
        placeholder="Call notes"
        className="min-h-28 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white sm:col-span-2"
      />
      {incidentError && <p className="text-sm font-medium text-red-600 sm:col-span-2">{incidentError}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={() => closeQuickModal('new-call')}
          className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={createIncident}
          className="inline-flex items-center gap-2 rounded-md bg-cad-navy px-3 py-2 text-sm font-semibold text-white"
        >
          <Send size={16} />
          Create
        </button>
      </div>
    </div>
  );

  const renderCallManagement = (showCallList: boolean) => {
    const isMyCall = (incident: Incident) =>
      incident.createdBy === user?.id || incident.units.some((unit) => unit.userId === user?.id && unit.status !== 'Cleared');
    const callMatchesSearch = (incident: Incident) => {
      const query = callSearch.trim().toLowerCase();
      if (!query) return true;
      return [
        incident.callNumber,
        incident.type,
        incident.priority,
        incident.status,
        incident.address,
        incident.district,
        incident.beat,
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
        if (tab === 'closed') return isClosedIncident(incident);
        return true;
      });
    const callTabs: Array<{ id: CallTabId; label: string; icon: React.ReactNode; calls: Incident[] }> = [
      { id: 'all', label: 'All Calls', icon: <ClipboardList size={14} />, calls: tabIncidents('all') },
      { id: 'my', label: 'My Calls', icon: <Users size={14} />, calls: tabIncidents('my') },
      { id: 'pending', label: 'Pending Calls', icon: <Bell size={14} />, calls: tabIncidents('pending') },
      { id: 'closed', label: 'Closed Calls', icon: <CheckCheck size={14} />, calls: tabIncidents('closed') }
    ];
    const visibleIncidents = callTabs.find((tab) => tab.id === activeCallTab)?.calls || [];
    const emptyCopy =
      activeCallTab === 'my'
        ? 'No calls are assigned to you or created by you.'
        : activeCallTab === 'pending'
          ? 'No pending calls.'
          : activeCallTab === 'closed'
            ? 'No recent closed calls.'
            : 'No calls are in the queue.';
    const activeCount = incidents.filter((incident) => !isClosedIncident(incident)).length;
    const pendingCount = incidents.filter((incident) => incident.status === 'Pending').length;
    const assignedCount = incidents.filter((incident) => incident.units.length > 0 && !isClosedIncident(incident)).length;
    const selectedUnitSummary = selectedIncident?.units.length ? `${selectedIncident.units.length} assigned` : 'No units assigned';
    const selectedCallClosed = isClosedIncident(selectedIncident);

    return (
    <div className={`grid h-[min(74vh,760px)] min-h-[560px] overflow-hidden rounded-lg border border-cad-line bg-white text-cad-ink dark:border-slate-700 dark:bg-slate-900 dark:text-white ${showCallList ? 'lg:grid-cols-[360px_1fr]' : ''}`}>
      {showCallList && (
        <div className="flex min-h-0 flex-col border-r border-cad-line bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
          <div className="shrink-0 border-b border-cad-line p-3 dark:border-slate-700">
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-cad-line bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Active</p>
                <p className="mt-1 text-lg font-black text-cad-blue dark:text-blue-100">{activeCount}</p>
              </div>
              <div className="rounded-md border border-cad-line bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Pending</p>
                <p className="mt-1 text-lg font-black text-amber-700 dark:text-amber-200">{pendingCount}</p>
              </div>
              <div className="rounded-md border border-cad-line bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Assigned</p>
                <p className="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-200">{assignedCount}</p>
              </div>
            </div>
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                value={callSearch}
                onChange={(event) => setCallSearch(event.target.value)}
                placeholder="Search calls"
                className="h-10 w-full rounded-md border border-cad-line bg-white pl-9 pr-3 text-sm outline-none focus:border-cad-accent focus:ring-4 focus:ring-cad-accent/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {callTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCallTab(tab.id)}
                  className={`rounded-md border px-2 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] transition ${
                    activeCallTab === tab.id
                      ? 'border-cad-accent bg-white text-cad-blue shadow-sm dark:border-cad-accent dark:bg-slate-900 dark:text-blue-100'
                      : 'border-cad-line bg-white text-slate-600 hover:border-cad-accent/60 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">{tab.icon}{tab.label}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{tab.calls.length} calls</span>
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {visibleIncidents.length === 0 && <p className="rounded-md bg-white p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">{emptyCopy}</p>}
            {visibleIncidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => setSelectedIncidentId(incident.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedIncident?.id === incident.id
                    ? 'border-cad-blue bg-blue-50 dark:bg-blue-950/50'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950 dark:text-white">{incident.callNumber}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-cad-blue dark:text-blue-100">{incident.type}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${incidentPriorityStyles[incident.priority]}`}>
                    {incident.priority}
                  </span>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <MapPin size={13} className="mt-0.5 shrink-0" />
                  <span className="line-clamp-2">{incident.address}</span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${incidentStatusStyles[incident.status]}`}>
                    {incident.status}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {incident.units.length} unit{incident.units.length === 1 ? '' : 's'}
                  </span>
                  {incident.units.length === 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      Unassigned
                    </span>
                  ) : (
                    incident.units.map((assignedUnit) => (
                      <span key={assignedUnit.userId} className="rounded-full bg-cad-blue/10 px-2 py-0.5 text-[11px] font-bold text-cad-blue dark:bg-blue-950 dark:text-blue-100">
                        {assignedUnit.cadUnitNumber || assignedUnit.name}: {assignedUnit.status}
                      </span>
                    ))
                  )}
                </div>
                <p className="mt-2 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {[incident.district, incident.beat].filter(Boolean).join(' / ') || 'No district assigned'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 overflow-y-auto bg-white p-4 dark:bg-slate-900">
        {selectedIncident ? (
          <div className="space-y-4">
            {incidentError && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
                {incidentError}
              </p>
            )}
            <div className="rounded-lg border border-cad-line bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Selected Call</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{selectedIncident.callNumber}</h2>
                  <p className="mt-1 text-sm font-semibold text-cad-blue dark:text-blue-100">{selectedIncident.type}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${incidentPriorityStyles[selectedIncident.priority]}`}>
                    {selectedIncident.priority}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ring-1 ${incidentStatusStyles[selectedIncident.status]}`}>
                    {selectedIncident.status}
                  </span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <CallInfoTile label="Address" value={selectedIncident.address} />
                <CallInfoTile label="District / Beat" value={[selectedIncident.district, selectedIncident.beat].filter(Boolean).join(' / ') || 'Unassigned'} />
                <CallInfoTile label="Caller" value={selectedIncident.callerName || 'Unknown'} />
                <CallInfoTile label="Phone" value={selectedIncident.callerPhone || 'Unknown'} />
              </div>
              {selectedIncident.description && (
                <div className="mt-4 rounded-md border border-cad-line bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {selectedIncident.description}
                </div>
              )}
              {selectedIncident.disposition && (
                <div className="mt-3 rounded-md border border-cad-line bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Disposition</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{selectedIncident.disposition}</p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-cad-line bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Assigned Units</h3>
                  <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{selectedUnitSummary}</p>
                </div>
                <Radio size={18} className="text-cad-blue dark:text-blue-100" />
              </div>
              <div className="mt-2 space-y-2">
                {selectedIncident.units.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No units assigned.</p>}
                {selectedIncident.units.map((assignedUnit) => (
                  <div key={assignedUnit.userId} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{assignedUnit.cadUnitNumber || assignedUnit.name}</span>
                      <span>{assignedUnit.status}</span>
                    </div>
                    {!selectedCallClosed && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {dispatchUnitStatuses.map((status) => (
                          <button
                            key={`${assignedUnit.userId}-${status}`}
                            type="button"
                            onClick={() => updateAssignedUnitStatus(assignedUnit.userId, status)}
                            className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                              assignedUnit.status === status
                                ? 'border-cad-blue bg-blue-50 text-cad-blue dark:bg-blue-950 dark:text-blue-200'
                                : status === 'Cleared'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {!selectedCallClosed && recommendedUnits.length > 0 && (
              <div className="rounded-lg border border-cad-line bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Recommended Units</h3>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {recommendedUnits.map(({ unit }) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => assignRecommendedUnit(unit.id)}
                      className="rounded-md border border-cad-line bg-slate-50 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-bold">{displayCadUnitNumber(unit)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${statusStyles[displayStatus(unit)]}`}>
                          {displayStatus(unit)}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {incidentDistanceLabel(unit, selectedIncident)} - {unit.district || 'No district'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!selectedCallClosed && (
              <div className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-cad-line bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
                <select value={assignmentUnitId} onChange={(event) => setAssignmentUnitId(event.target.value)} className="min-w-0 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  <option value="">Select unit</option>
                  {[...recommendedUnits.map((item) => item.unit), ...units.filter((unit) => !recommendedUnits.some((item) => item.unit.id === unit.id))].map((unit) => (
                    <option key={unit.id} value={unit.id}>{displayCadUnitNumber(unit)} - {unit.name}</option>
                  ))}
                </select>
                <button type="button" onClick={assignIncidentUnit} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">Assign</button>
              </div>
            )}
            <div className="rounded-lg border border-cad-line bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <h3 className="mb-3 text-sm font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Update Call</h3>
              {selectedCallClosed ? (
                <button
                  type="button"
                  onClick={reopenIncident}
                  className="rounded-md border border-cad-blue bg-blue-50 px-3 py-2 text-sm font-black text-cad-blue hover:bg-blue-100 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-100"
                >
                  Reopen Call
                </button>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    {(['Dispatched', 'En Route', 'On Scene', 'Closed', 'Canceled'] as IncidentStatus[]).map((status) => (
                      <button key={status} type="button" onClick={() => updateIncidentStatus(status)} className={`rounded-md border px-3 py-2 text-sm font-bold transition ${
                        selectedIncident.status === status
                          ? 'border-cad-blue bg-blue-50 text-cad-blue dark:border-blue-500 dark:bg-blue-950 dark:text-blue-100'
                          : 'border-cad-line text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
                      }`}>
                        {status}
                      </button>
                    ))}
                  </div>
                  <input value={incidentDisposition} onChange={(event) => setIncidentDisposition(event.target.value)} placeholder="Disposition required to close or cancel" className="mt-3 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                </>
              )}
            </div>
            <div className="rounded-lg border border-cad-line bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Call Timeline</h3>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {(selectedIncident.notes || []).length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No notes yet.</p>}
                {(selectedIncident.notes || []).map((note) => (
                  <div key={note.id} className="rounded-md border border-cad-line bg-slate-50 p-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                      <span>{note.noteType} {note.userName ? `by ${note.userName}` : ''}</span>
                      <span>{formatDateTime(note.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-slate-700 dark:text-slate-200">{note.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <input value={incidentNoteBody} onChange={(event) => setIncidentNoteBody(event.target.value)} placeholder="Add call note" className="min-w-0 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                <button type="button" onClick={addIncidentNote} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">Add</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-96 items-center justify-center p-4 text-sm text-slate-600 dark:text-slate-300">Select a call to manage.</div>
        )}
      </div>
    </div>
    );
  };

  const renderQuickModalContent = (modalId: QuickLaunchId) => {
    if (modalId === 'messages') {
      return (
        <div className="grid h-[min(70vh,680px)] min-h-[520px] overflow-hidden rounded-md border border-cad-line sm:grid-cols-[220px_1fr]">
          <div className="relative flex h-full min-h-0 flex-col border-r border-cad-line bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
            <div className="shrink-0 border-b border-cad-line p-3 dark:border-slate-700">
              <input
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="Search threads"
                className="w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-16">
              {messageThreads.map((item) => (
                (() => {
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
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            onlineUserIds.includes(item.id) ? 'bg-emerald-500' : 'bg-slate-300'
                          }`}
                        />
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
                            togglePinnedMessageThread(item.id);
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
                            : onlineUserIds.includes(item.id)
                              ? 'Active now'
                              : `Last seen ${formatDateTime(item.lastSeenAt)}`)}
                      </span>
                    </button>
                  );
                })()
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedMessageUserId('');
                setMessageBody('');
                setMessageSearch('');
              }}
              className="absolute bottom-3 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full bg-cad-blue text-white shadow-lg transition hover:bg-blue-700"
              aria-label="New message"
              title="New message"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            {selectedMessageUser ? (
              <>
                <div className="border-b border-cad-line bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-bold">{selectedMessageUser.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{onlineUserIds.includes(selectedMessageUser.id) ? 'Active now' : `Last seen ${formatDateTime(selectedMessageUser.lastSeenAt)}`}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                      <Lock size={12} />
                      Encrypted
                    </span>
                  </div>
                  <input
                    value={messageTextSearch}
                    onChange={(event) => setMessageTextSearch(event.target.value)}
                    placeholder="Search messages"
                    className="mt-2 w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-white p-4 dark:bg-slate-950">
                  {searchedMessages.map((message) => {
                    const mine = message.senderId === user?.id;
                    const index = searchedMessages.findIndex((item) => item.id === message.id);
                    const previous = searchedMessages[index - 1];
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
                                : 'rounded-bl-md border border-slate-200 bg-white text-cad-ink dark:border-slate-800 dark:bg-slate-900 dark:text-white'
                              }`}
                            >
                              {message.body && <p className="whitespace-pre-wrap text-left leading-6">{message.body}</p>}
                              {message.attachments?.map((attachment) => (
                                <MessageAttachmentPreview key={attachment.id} attachment={attachment} mine={mine} />
                              ))}
                            </div>
                            {(getMessageReactionForOtherUser(message, user?.id) || getMessageReactionForUser(message, user?.id)) && (
                              <div className={`mt-1 flex gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                                {getMessageReactionForOtherUser(message, user?.id) && (
                                  <span className="rounded-full bg-white px-2 py-0.5 text-xs shadow dark:bg-slate-900">
                                    {getReactionIcon(getMessageReactionForOtherUser(message, user?.id))}
                                  </span>
                                )}
                                {getMessageReactionForUser(message, user?.id) && (
                                  <span className="rounded-full bg-cad-blue/10 px-2 py-0.5 text-xs text-cad-blue shadow">
                                    {getReactionIcon(getMessageReactionForUser(message, user?.id))}
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
                                    onClick={() => reactToMessage(message, reaction.key)}
                                    className={`rounded-full px-1.5 py-0.5 hover:bg-cad-blue/10 ${
                                      getMessageReactionForUser(message, user?.id) === reaction.key ? 'bg-cad-blue/10 text-cad-blue' : ''
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
                <div className="relative shrink-0 border-t border-cad-line p-3 dark:border-slate-700">
                  {emojiOpen && (
                    <div className="absolute bottom-16 left-3 z-30 w-80 rounded-lg border border-cad-line bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                      <input
                        value={emojiSearch}
                        onChange={(event) => setEmojiSearch(event.target.value)}
                        placeholder="Search or paste any emoji"
                        className="mb-2 w-full rounded-md border border-cad-line px-2 py-1 text-sm outline-none focus:border-cad-blue dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                      <div className="grid max-h-36 grid-cols-8 gap-1 overflow-y-auto">
                        {filteredEmojis.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setMessageBody((value) => `${value}${emoji}`)}
                            className="rounded px-2 py-1 text-lg hover:bg-white"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {pendingAttachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {pendingAttachments.map((attachment, index) => (
                        <button
                          key={`${attachment.fileName}-${index}`}
                          type="button"
                          onClick={() => setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-cad-blue"
                        >
                          <Paperclip size={12} />
                          {attachment.fileName}
                          <X size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => attachFiles(event.target.files)}
                    />
                    <button
                      type="button"
                      onClick={openEmojiPicker}
                      className="rounded-md border border-cad-line px-3 py-2 text-sm"
                    >
                      {emojiButton}
                    </button>
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      className="rounded-md border border-cad-line px-3 py-2 text-sm"
                      aria-label="Attach files"
                    >
                      <Paperclip size={16} />
                    </button>
                    <input
                      value={messageBody}
                      onChange={(event) => updateMessageBody(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          sendChatMessage();
                        }
                      }}
                      placeholder="Type a message"
                      className="min-w-0 flex-1 rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={sendChatMessage}
                      className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-slate-600 dark:text-slate-300">
                Select a user to start messaging.
              </div>
            )}
          </div>
          {threadPendingDeleteUserId && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
              <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-slate-900">
                <h3 className="text-lg font-black">Delete Conversation</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Delete the conversation with {directory.find((item) => item.id === threadPendingDeleteUserId)?.name || 'this user'}?
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setThreadPendingDeleteUserId(null)} className="rounded-md border border-cad-line px-3 py-2 text-sm font-bold">
                    Cancel
                  </button>
                  <button type="button" onClick={() => deleteMessageThread(threadPendingDeleteUserId)} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700">
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
                  <button type="button" onClick={() => setMessagePendingDelete(null)} className="rounded-md border border-cad-line px-3 py-2 text-sm font-bold">
                    Cancel
                  </button>
                  <button type="button" onClick={() => deleteChatMessage(messagePendingDelete)} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700">
                    <Trash2 size={15} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (modalId === 'new-call') {
      return renderNewCallForm();
    }

    if (modalId === 'calls') {
      return renderCallManagement(true);
    }

    if ((modalId as string) === 'calls') {
      return (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {incidents.map((incident) => (
            <button
              key={incident.id}
              type="button"
              onClick={() => {
                setSelectedIncidentId(incident.id);
                focusQuickModal('call-detail');
              }}
              className="w-full rounded-md border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800"
            >
              <p className="text-sm font-bold">{incident.callNumber} · {incident.type}</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{incident.address}</p>
            </button>
          ))}
          {incidents.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No active calls.</p>}
        </div>
      );
    }

    if (modalId === 'inquiries') {
      return (
        <InquiryPanel
          officers={directory.filter((item) => item.role === UserRole.OFFICER || item.role === UserRole.ADMIN)}
          defaultOfficerId={user?.id}
          message={incidentError}
          onSubmit={submitInquiry}
        />
      );
    }

    if (modalId === 'protective-orders') {
      return <ProtectiveOrderPanel />;
    }

    if (modalId === 'units') {
      const onDutyCount = unitBoardUnits.length;
      const availableCount = unitBoardUnits.filter((unit) => displayStatus(unit) === 'Available').length;
      const enRouteCount = unitBoardUnits.filter((unit) => displayStatus(unit) === 'En Route').length;
      const busyCount = unitBoardUnits.filter((unit) => {
        const status = displayStatus(unit);
        return status !== 'Available' && status !== 'En Route';
      }).length;
      const liveTrackingCount = unitBoardUnits.filter((unit) => locationReliability(unit, locationClock) === 'live').length;
      return (
        <div className="grid h-full min-h-[520px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg border border-cad-line bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-cad-line bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-black text-slate-950 dark:text-white">On Duty Officers</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {onDutyCount} on duty / {availableCount} available / {enRouteCount} en route / {busyCount} busy / {liveTrackingCount} live GPS
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-black uppercase">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800">Available {availableCount}</span>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">En Route {enRouteCount}</span>
                <span className="rounded-full bg-red-50 px-2 py-1 text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800">Busy {busyCount}</span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_9.5rem_9.5rem_auto]">
              <input
                value={unitBoardSearch}
                onChange={(event) => setUnitBoardSearch(event.target.value)}
                placeholder="Search units, officers, CAD units, districts"
                className="h-10 rounded border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-cad-blue focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
              />
              <select
                value={unitBoardStatusFilter}
                onChange={(event) => setUnitBoardStatusFilter(event.target.value as UnitStatus | 'all')}
                className="h-10 rounded border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-cad-blue focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
              >
                <option value="all">All Statuses</option>
                {unitBoardStatuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <select
                value={unitBoardDistrictFilter}
                onChange={(event) => setUnitBoardDistrictFilter(event.target.value)}
                className="h-10 rounded border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-cad-blue focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
              >
                <option value="all">All Districts</option>
                {unitBoardDistricts.map((district) => (
                  <option key={district} value={district}>{district}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setUnitBoardSearch('');
                  setUnitBoardStatusFilter('all');
                  setUnitBoardDistrictFilter('all');
                }}
                className="h-10 rounded border border-gray-300 px-3 text-sm font-bold text-slate-700 hover:bg-white dark:border-gray-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          {unitLoadError && <p className="mb-3 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{unitLoadError}</p>}
          {unitBoardUnits.length === 0 ? (
            <div className="flex min-h-0 items-center justify-center p-6">
              <div className="max-w-sm rounded-lg border border-dashed border-gray-300 bg-slate-50 p-6 text-center dark:border-gray-700 dark:bg-slate-950">
                <Radio className="mx-auto text-slate-400" size={28} />
                <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">No officers are currently on duty.</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Officers appear here when they are online and signed in.</p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 overflow-auto">
                <div className="min-w-[640px] text-sm">
                  <div className="grid grid-cols-[108px_78px_1fr_104px_110px_118px] gap-2 border-b border-gray-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:border-gray-800 dark:bg-slate-900 dark:text-slate-400">
                    <SortHeader label="Status" active={unitBoardSort.key === 'status'} direction={unitBoardSort.direction} onClick={() => setUnitBoardSortKey('status')} />
                    <SortHeader label="Unit" active={unitBoardSort.key === 'unit'} direction={unitBoardSort.direction} onClick={() => setUnitBoardSortKey('unit')} />
                    <SortHeader label="First & Last Name" active={unitBoardSort.key === 'name'} direction={unitBoardSort.direction} onClick={() => setUnitBoardSortKey('name')} />
                    <SortHeader label="CAD Unit" active={unitBoardSort.key === 'cadUnit'} direction={unitBoardSort.direction} onClick={() => setUnitBoardSortKey('cadUnit')} />
                    <SortHeader label="District" active={unitBoardSort.key === 'district'} direction={unitBoardSort.direction} onClick={() => setUnitBoardSortKey('district')} />
                    <span>Location</span>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {unitBoardRows.length === 0 && (
                      <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">No units match the current filters.</p>
                    )}
                    {unitBoardRows.map((unit) => {
                      const status = displayStatus(unit);
                      const colors = unitBoardStatusStyles(status);
                      const name = splitName(unit.name);
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => setSelectedUnitId(unit.id)}
                          className={`grid w-full grid-cols-[108px_78px_1fr_104px_110px_118px] gap-2 border-l-4 bg-white px-4 py-3 text-left transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 ${
                            selectedUnitBoardUnit?.id === unit.id ? 'ring-2 ring-inset ring-cad-blue/35' : ''
                          } ${colors.row}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors.dot}`} />
                            <span className={`truncate rounded-full px-2 py-1 text-[11px] font-black uppercase ring-1 ${colors.pill}`}>
                              {status}
                            </span>
                          </span>
                          <span className="truncate font-bold text-slate-900 dark:text-white">{displayUnitNumber(unit)}</span>
                          <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                            {[name.firstName, name.lastName].filter(Boolean).join(' ') || unit.name || 'N/A'}
                          </span>
                          <span className="truncate font-bold text-cad-blue dark:text-blue-100">{displayCadUnitNumber(unit)}</span>
                          <span className="truncate text-slate-600 dark:text-slate-300">{unit.district || 'Unassigned'}</span>
                          <span className="truncate text-slate-500 dark:text-slate-400">{locationReliabilityText(unit, locationClock)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
            </div>
          )}
          {unitBoardUnits.length > 0 && (
            <div className="border-t border-gray-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-slate-950">
              <UnitProfileCard unit={selectedUnitBoardUnit} locationClock={locationClock} />
            </div>
          )}
        </div>
      );
    }

    if (modalId === 'unit-detail') {
      return selectedUnit ? (
        <dl className="grid gap-3 text-sm">
          <Detail label="Unit" value={displayCadUnitNumber(selectedUnit)} />
          <Detail label="Name" value={selectedUnit.name} />
          <Detail label="Status" value={displayStatus(selectedUnit)} />
          <Detail label="Tracking" value={locationReliabilityText(selectedUnit, locationClock)} />
          <Detail label="Location" value={`${selectedUnit.lat.toFixed(6)}, ${selectedUnit.lon.toFixed(6)}`} />
          <Detail label="Shared Route" value={routeShareLabel(selectedUnit)} />
        </dl>
      ) : (
        <p className="text-sm text-slate-600">No tracked unit selected.</p>
      );
    }

    if (modalId === 'call-detail') {
      return renderCallManagement(false);
    }

    if ((modalId as string) === 'call-detail') {
      return selectedIncident ? (
        <dl className="grid gap-3 text-sm">
          <Detail label="Call" value={selectedIncident.callNumber} />
          <Detail label="Type" value={selectedIncident.type} />
          <Detail label="Status" value={selectedIncident.status} />
          <Detail label="Address" value={selectedIncident.address} />
        </dl>
      ) : (
        <p className="text-sm text-slate-600">No call selected.</p>
      );
    }

    return (
      <div className="space-y-3 text-sm text-slate-700">
        <p>{user?.name}</p>
        <p>{user?.email}</p>
        <button type="button" onClick={logout} className="rounded-md bg-cad-navy px-3 py-2 font-semibold text-white">
          Sign out
        </button>
      </div>
    );
  };

  return (
    <div className={`dashboard-enter flex h-screen overflow-hidden ${theme === 'dark' ? 'dark bg-gray-950 text-gray-100' : 'bg-gray-50 text-cad-ink'}`}>
      <ShieldSidebar
        title={APP_NAME}
        subtitle="Dispatch"
        user={user}
        collapsed={appSidebarCollapsed}
        onToggleCollapsed={() => setAppSidebarCollapsed((value) => !value)}
        items={sidebarItems}
        onProfile={() => setSettingsOpen(true)}
      />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-auto fixed right-3 top-3 z-40 flex select-none items-center gap-1.5 rounded-2xl border border-cad-line bg-white/90 p-2 text-cad-ink shadow-[0_16px_45px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:bg-slate-950/85 dark:text-white sm:right-5 sm:top-4 sm:gap-2">
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white shadow-sm ring-1 transition dark:border-slate-700 dark:bg-slate-800 ${realtimeStatusClass}`}
            title={realtimeStatusLabel}
            aria-label={`Realtime status: ${realtimeStatusLabel}`}
          >
            {realtimeState === 'offline' ? <WifiOff size={19} /> : <Wifi size={19} />}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMapFilterOpen((value) => !value);
                setSettingsOpen(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100 dark:hover:bg-slate-700"
              aria-label="Map filters"
              aria-expanded={mapFilterOpen}
              title="Map filters"
            >
              <SlidersHorizontal size={19} />
            </button>
            {mapFilterOpen && (
              <div className="absolute right-0 top-12 z-40 w-56 rounded border border-cad-line bg-white p-2 text-cad-ink shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <div className="border-b border-slate-100 px-2 pb-2 dark:border-slate-800">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Map Layers</p>
                </div>
                <div className="mt-2 grid gap-1">
                  {[
                    { id: 'units' as const, label: 'Units', icon: <Radio size={16} /> },
                    { id: 'calls' as const, label: 'Calls', icon: <ClipboardList size={16} /> },
                    { id: 'geofences' as const, label: 'Districts', icon: <Layers size={16} /> }
                  ].map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => toggleMapLayer(layer.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      aria-pressed={mapLayers[layer.id]}
                    >
                      <span className="text-cad-blue dark:text-blue-100">{layer.icon}</span>
                      <span className="min-w-0 flex-1">{layer.label}</span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded border ${
                          mapLayers[layer.id]
                            ? 'border-cad-blue bg-cad-blue text-white'
                            : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-950'
                        }`}
                      >
                        {mapLayers[layer.id] && <Check size={13} />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
            onClick={() => setActiveQuickModal('inquiries')}
            className="flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100 dark:hover:bg-slate-700"
            aria-label="Open inquiries"
            title="Inquiries"
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen((value) => !value);
              setMapFilterOpen(false);
            }}
            className="flex h-10 w-10 items-center justify-center rounded border border-cad-line bg-white text-cad-blue shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-100 dark:hover:bg-slate-700"
            aria-label="Settings"
          >
            <Settings size={19} />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-12 z-40 w-[calc(100vw-6.5rem)] max-w-64 origin-top-right rounded border border-cad-line bg-white py-1 text-cad-ink shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="truncate text-sm font-semibold">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
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
              {hasPermission('manage_system') && (
                <Link
                  to="/admin/configuration"
                  onClick={() => setSettingsOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <SlidersHorizontal size={16} />
                  Admin
                </Link>
              )}
              {user?.role === UserRole.ADMIN && (
                <Link
                  to="/officer"
                  onClick={() => setSettingsOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Shield size={16} />
                  Officer Side
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

      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-900">
        {googleMapsApiKey ? (
          <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        ) : (
          <FallbackMap
            units={units}
            incidents={incidents}
            geofences={configuredGeofences}
            mapLayers={mapLayers}
            selectedUnit={selectedUnit}
            currentLocation={currentLocation}
            currentUserId={user?.id}
            locationClock={locationClock}
            onSelectUnit={(unit) => setSelectedUnitId(unit.id)}
            onSelectIncident={(incident) => setSelectedIncidentId(incident.id)}
          />
        )}

        <button
          type="button"
          onClick={recenterToCurrentLocation}
          className="absolute bottom-4 left-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-cad-line bg-white/95 text-cad-blue shadow-xl transition hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-200 dark:hover:bg-slate-800"
          aria-label="Return to my location"
          title="My location"
        >
          <MapPin size={18} />
        </button>

        <div className="hidden">
          <OverlayPanel
            title="Active Calls"
            subtitle={`${incidents.length} open incidents`}
            open={callsOverlayOpen}
            onToggle={() => setCallsOverlayOpen((value) => !value)}
            className="w-[min(28rem,calc(100vw-2rem))]"
          >
            {incidentError && <p className="px-1 py-2 text-sm font-medium text-red-600">{incidentError}</p>}
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {incidents.length === 0 && (
                <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">No active calls are in the queue.</p>
              )}
              {incidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => {
                    setSelectedIncidentId(incident.id);
                    setCallDetailOpen(true);
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedIncident?.id === incident.id
                      ? 'border-cad-blue bg-blue-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{incident.callNumber} · {incident.type}</p>
                      <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">{incident.address}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${incidentPriorityStyles[incident.priority]}`}>
                      {incident.priority}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${incidentStatusStyles[incident.status]}`}>
                      {incident.status}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{incident.units.length} units</span>
                  </div>
                </button>
              ))}
            </div>
          </OverlayPanel>

          <OverlayPanel
            title="Call Detail"
            subtitle={selectedIncident ? selectedIncident.callNumber : 'No active call selected'}
            open={callDetailOpen}
            onToggle={() => setCallDetailOpen((value) => !value)}
            className="w-[min(28rem,calc(100vw-2rem))]"
          >
            {selectedIncident ? (
              <div className="max-h-[42vh] space-y-4 overflow-y-auto pr-1">
                <dl className="grid gap-3 text-sm">
                  <Detail label="Type" value={selectedIncident.type} />
                  <Detail label="Priority" value={selectedIncident.priority} />
                  <Detail label="Status" value={selectedIncident.status} />
                  <Detail label="Address" value={selectedIncident.address} />
                  <Detail label="District" value={selectedIncident.district || 'Unassigned'} />
                  <Detail label="Beat" value={selectedIncident.beat || 'Unassigned'} />
                  <Detail label="Caller" value={selectedIncident.callerName || 'Unknown'} />
                  <Detail label="Phone" value={selectedIncident.callerPhone || 'Unknown'} />
                </dl>
                {selectedIncident.description && (
                  <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-950 dark:text-slate-200">{selectedIncident.description}</p>
                )}
                {selectedIncident.disposition && (
                  <Detail label="Disposition" value={selectedIncident.disposition} />
                )}
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Assigned Units</h3>
                  <div className="mt-2 space-y-2">
                    {selectedIncident.units.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No units assigned.</p>}
                    {selectedIncident.units.map((assignedUnit) => (
                      <div key={assignedUnit.userId} className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{assignedUnit.cadUnitNumber || assignedUnit.name}</span>
                          <span>{assignedUnit.status}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {dispatchUnitStatuses.map((status) => (
                            <button
                              key={`${assignedUnit.userId}-${status}`}
                              type="button"
                              onClick={() => updateAssignedUnitStatus(assignedUnit.userId, status)}
                              className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                                assignedUnit.status === status
                                  ? 'border-cad-blue bg-blue-50 text-cad-blue dark:bg-blue-950 dark:text-blue-200'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {recommendedUnits.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Recommended Units</h3>
                    <div className="mt-2 grid gap-2">
                      {recommendedUnits.slice(0, 3).map(({ unit }) => (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => assignRecommendedUnit(unit.id)}
                          className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-bold">{displayCadUnitNumber(unit)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${statusStyles[displayStatus(unit)]}`}>
                              {displayStatus(unit)}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                            {incidentDistanceLabel(unit, selectedIncident)} · {unit.district || 'No district'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <select
                    value={assignmentUnitId}
                    onChange={(event) => setAssignmentUnitId(event.target.value)}
                    className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Select unit</option>
                    {[...recommendedUnits.map((item) => item.unit), ...units.filter((unit) => !recommendedUnits.some((item) => item.unit.id === unit.id))].map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {displayCadUnitNumber(unit)} · {unit.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={assignIncidentUnit} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">
                    Assign
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['Dispatched', 'En Route', 'On Scene', 'Closed', 'Canceled'] as IncidentStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => updateIncidentStatus(status)}
                      className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {status}
                    </button>
                  ))}
                </div>
                <input
                  value={incidentDisposition}
                  onChange={(event) => setIncidentDisposition(event.target.value)}
                  placeholder="Close/cancel disposition"
                  className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <div className="rounded-md border border-cad-line p-3 dark:border-slate-700">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Call Timeline</h3>
                  <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                    {(selectedIncident.notes || []).length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No notes yet.</p>}
                    {(selectedIncident.notes || []).map((note) => (
                      <div key={note.id} className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-950">
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                          <span>{note.noteType} {note.userName ? `by ${note.userName}` : ''}</span>
                          <span>{formatDateTime(note.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-slate-700 dark:text-slate-200">{note.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <input
                      value={incidentNoteBody}
                      onChange={(event) => setIncidentNoteBody(event.target.value)}
                      placeholder="Add call note"
                      className="min-w-0 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <button type="button" onClick={addIncidentNote} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">Create or select a call to manage assignments.</p>
            )}
          </OverlayPanel>
        </div>
      </div>

      <QuickLaunchDock
        slots={quickLaunchSlots}
        options={quickLaunchOptions}
        activeItem={activeQuickModal}
        customizingSlot={customizingSlot}
        sidebarCollapsed={appSidebarCollapsed}
        badges={{
          messages: messageBadgeCount,
          calls: callBadgeCount,
          'call-detail': callBadgeCount
        }}
        onOpen={openQuickLaunch}
        onCustomize={setCustomizingSlot}
        onAssignSlot={assignQuickLaunchSlot}
        onDragStart={setDraggedSlotIndex}
        onDrop={swapQuickLaunchSlots}
      />

      <div className="pointer-events-none fixed right-4 top-20 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg border p-3 shadow-2xl animate-[dockModalIn_120ms_ease-out] ${
              toast.tone === 'warning'
                ? 'border-red-200 bg-red-50/95 text-red-950 dark:border-red-800 dark:bg-red-950/95 dark:text-white'
                : toast.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50/95 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/95 dark:text-white'
                  : 'border-cad-line bg-white/95 text-cad-ink dark:border-slate-700 dark:bg-slate-900/95 dark:text-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <Bell size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold">{toast.title}</p>
                <p className="mt-1 truncate text-sm">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                className="ml-auto rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <UrgentAlertOverlay alerts={urgentAlerts} onAcknowledge={acknowledgeUrgentAlert} />

      <ChangePasswordModal
        open={changePasswordOpen}
        form={passwordForm}
        message={passwordMessage}
        onClose={() => setChangePasswordOpen(false)}
        onChange={setPasswordForm}
        onSubmit={changePassword}
      />

      {openQuickModals.map((modalId) => (
        <ModalShell
          key={modalId}
          title={quickModalTitle(modalId)}
          open
          onClose={() => closeQuickModal(modalId)}
          onFocus={() => focusQuickModal(modalId)}
          zIndex={modalZOrder[modalId] || 50}
          active={activeQuickModal === modalId}
          placement="center"
          maxWidthClass={modalId === 'units' ? 'max-w-3xl' : modalId === 'messages' || modalId === 'calls' || modalId === 'call-detail' ? 'max-w-5xl' : 'max-w-2xl'}
          contentClassName={modalId === 'units' ? 'p-3 overflow-hidden h-[min(68vh,620px)]' : 'p-4 overflow-hidden'}
        >
          {renderQuickModalContent(modalId)}
        </ModalShell>
      ))}
      </div>
    </div>
  );
};

const SortHeader: React.FC<{
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}> = ({ label, active, direction, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex min-w-0 items-center gap-1 text-left transition hover:text-cad-blue ${active ? 'text-cad-blue' : ''}`}
  >
    <span className="truncate">{label}</span>
    {active ? (direction === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : null}
  </button>
);

const UnitProfileCard: React.FC<{ unit: UnitBoardUser | null; locationClock: number }> = ({ unit, locationClock }) => {
  if (!unit) {
    return (
      <aside className="flex min-h-0 items-center justify-center rounded-md border border-cad-line bg-white p-4 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-950">
        Select a unit to view profile and location.
      </aside>
    );
  }

  const status = displayStatus(unit);
  const colors = unitBoardStatusStyles(status);
  const name = splitName(unit.name);

  return (
    <aside className="min-h-0 overflow-y-auto rounded-md border border-cad-line bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cad-blue text-base font-black text-white shadow">
          {displayCadUnitNumber(unit).slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-black text-slate-950 dark:text-white">{displayCadUnitNumber(unit)}</p>
          <p className="truncate text-sm font-semibold text-slate-600 dark:text-slate-300">
            {[name.firstName, name.lastName].filter(Boolean).join(' ') || unit.name}
          </p>
          <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-black uppercase ring-1 ${colors.pill}`}>
            {status}
          </span>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        <Detail label="Unit" value={displayUnitNumber(unit)} />
        <Detail label="First Name" value={name.firstName || 'N/A'} />
        <Detail label="Last Name" value={name.lastName || 'N/A'} />
        <Detail label="CAD Unit" value={displayCadUnitNumber(unit)} />
        <Detail label="District" value={unit.district || 'Unassigned'} />
        <Detail label="Group" value={unit.group || 'Unassigned'} />
        <Detail label="Tracking" value={locationReliabilityText(unit, locationClock)} />
        <Detail label="Latitude" value={typeof unit.lat === 'number' ? unit.lat.toFixed(6) : 'Unavailable'} />
        <Detail label="Longitude" value={typeof unit.lon === 'number' ? unit.lon.toFixed(6) : 'Unavailable'} />
        <Detail label="Speed" value={`${(unit.speedMph || 0).toFixed(1)} mph`} />
        <Detail label="Shared Route" value={typeof unit.lat === 'number' && typeof unit.lon === 'number' ? routeShareLabel(unit as TrackedUnit) : 'Unavailable'} />
        <Detail label="ETA" value={typeof unit.lat === 'number' && typeof unit.lon === 'number' ? etaText(unit as TrackedUnit) : 'Unavailable'} />
      </dl>
    </aside>
  );
};

const OverlayPanel: React.FC<{
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, open, onToggle, className = '', children }) => (
  <div className={`overflow-hidden rounded-lg border border-cad-line bg-white/95 shadow-2xl transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${className}`}>
    <div className="flex items-center justify-between gap-3 border-b border-cad-line px-3 py-2 dark:border-slate-700">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold">{title}</h2>
        {subtitle && <p className="truncate text-xs text-slate-600 dark:text-slate-300">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
      >
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
    </div>
    <div
      className={`grid transition-all duration-300 ease-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="p-3">{children}</div>
      </div>
    </div>
  </div>
);

const CallInfoTile: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="rounded-md border border-cad-line bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</p>
  </div>
);

const Detail: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
    <dt className="font-semibold text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="font-medium text-cad-ink dark:text-white">{value}</dd>
  </div>
);

const FallbackMap: React.FC<{
  units: TrackedUnit[];
  incidents: Incident[];
  geofences: MapGeofence[];
  mapLayers: DispatchMapLayers;
  selectedUnit: TrackedUnit | null;
  currentLocation: { lat: number; lon: number } | null;
  currentUserId?: string;
  locationClock: number;
  onSelectUnit: (unit: TrackedUnit) => void;
  onSelectIncident: (incident: Incident) => void;
}> = ({ units, incidents, geofences, mapLayers, selectedUnit, currentLocation, currentUserId, locationClock, onSelectUnit, onSelectIncident }) => {
  const visibleUnits = mapLayers.units ? units : [];
  const visibleGeofences = mapLayers.geofences ? geofences : [];
  const pinnedIncidents = (mapLayers.calls ? incidents : []).filter(
    (incident): incident is Incident & { lat: number; lon: number } =>
      incident.lat !== undefined && incident.lon !== undefined
  );
  const destinations = visibleUnits
    .filter((unit) => unit.destinationLat !== undefined && unit.destinationLon !== undefined)
    .map((unit) => ({
      id: `${unit.id}-destination`,
      lat: unit.destinationLat as number,
      lon: unit.destinationLon as number
    }));
  const points = currentLocation
    ? [
        ...visibleUnits,
        ...destinations,
        ...pinnedIncidents,
        ...visibleGeofences.flatMap((geofence) => geofence.points.map((point) => ({ id: `${geofence.id}-${point.lat}-${point.lon}`, ...point }))),
        { id: 'current-location', lat: currentLocation.lat, lon: currentLocation.lon }
      ]
    : [...visibleUnits, ...destinations, ...pinnedIncidents, ...visibleGeofences.flatMap((geofence) => geofence.points.map((point) => ({ id: `${geofence.id}-${point.lat}-${point.lon}`, ...point })))];
  const minLat = Math.min(...points.map((point) => point.lat), 39.7);
  const maxLat = Math.max(...points.map((point) => point.lat), 39.85);
  const minLon = Math.min(...points.map((point) => point.lon), -86.25);
  const maxLon = Math.max(...points.map((point) => point.lon), -86.05);

  const position = (lat: number, lon: number) => ({
    left: `${((lon - minLon) / Math.max(maxLon - minLon, 0.01)) * 82 + 9}%`,
    top: `${(1 - (lat - minLat) / Math.max(maxLat - minLat, 0.01)) * 78 + 11}%`
  });
  const svgPoint = (lat: number, lon: number) => {
    const pos = position(lat, lon);
    return `${parseFloat(pos.left)},${parseFloat(pos.top)}`;
  };

  return (
    <div className="relative h-full min-h-[520px] w-full overflow-hidden bg-[linear-gradient(90deg,rgba(148,163,184,.18)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,.18)_1px,transparent_1px)] bg-[size:48px_48px]">
      <div className="absolute inset-0 bg-slate-900/80" />
      <div className="absolute inset-x-8 top-1/2 h-1 -translate-y-1/2 bg-slate-500/50" />
      <div className="absolute left-1/2 top-8 h-[calc(100%-4rem)] w-1 -translate-x-1/2 bg-slate-500/50" />

      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {visibleGeofences.flatMap((geofence) =>
          geofence.rings.map((ring, index) => (
            <polygon
              key={`${geofence.id}-${index}`}
              points={ring.map((point) => svgPoint(point.lat, point.lon)).join(' ')}
              fill={geofence.color}
              fillOpacity={geofence.kind === 'beat' ? 0.1 : 0.07}
              stroke={geofence.color}
              strokeWidth={geofence.kind === 'beat' ? 0.45 : 0.65}
              strokeDasharray={geofence.kind === 'beat' ? '1.8 1.1' : undefined}
            />
          ))
        )}
        {mapLayers.trails && visibleUnits
          .filter((unit) => unit.destinationLat !== undefined && unit.destinationLon !== undefined)
          .map((unit) => (
            <line
              key={`${unit.id}-shared-route`}
              x1={parseFloat(position(unit.lat, unit.lon).left)}
              y1={parseFloat(position(unit.lat, unit.lon).top)}
              x2={parseFloat(position(unit.destinationLat as number, unit.destinationLon as number).left)}
              y2={parseFloat(position(unit.destinationLat as number, unit.destinationLon as number).top)}
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="2.5 1.5"
              opacity="0.9"
            />
          ))}
        {mapLayers.trails && visibleUnits
          .filter((unit) => displayStatus(unit) === 'En Route' && (unit.locationTrail?.length || 0) > 1)
          .map((unit) => {
            const trail = unit.locationTrail || [];
            const pointsValue = trail
              .map((point) => {
                const pos = position(point.lat, point.lon);
                return `${parseFloat(pos.left)},${parseFloat(pos.top)}`;
              })
              .join(' ');
            return (
              <polyline
                key={`${unit.id}-trail`}
                points={pointsValue}
                fill="none"
                stroke={unit.id === currentUserId ? '#10b981' : '#60a5fa'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            );
          })}
      </svg>

      {visibleUnits.map((unit) => (
        <button
          key={unit.id}
          type="button"
          onClick={() => onSelectUnit(unit)}
          className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold shadow-lg ring-2 ${
            unit.id === currentUserId ? 'h-5 w-5 p-0' : 'gap-1 px-2 py-1'
          } ${
            selectedUnit?.id === unit.id
              ? 'bg-cad-blue text-white ring-white'
              : 'bg-white text-cad-ink ring-slate-300'
          }`}
          style={position(unit.lat, unit.lon)}
        >
          <span
            className={`pointer-events-none absolute inset-0 -z-10 rounded-full ${
              markerPulseClass[markerTone(unit, currentUserId, locationClock)]
            } location-pulse`}
          />
          <span
            className={`h-3 w-3 rounded-full ring-2 ${markerToneClass[markerTone(unit, currentUserId, locationClock)]}`}
            aria-hidden="true"
          />
          {unit.id === currentUserId ? '' : displayCadUnitNumber(unit)}
          {displayStatus(unit) === 'En Route' && (
            <span className="ml-1 rounded bg-slate-950/80 px-1 py-0.5 text-[10px] text-white">
              {(unit.speedMph || 0).toFixed(0)} mph
            </span>
          )}
        </button>
      ))}

      {currentLocation && !visibleUnits.some((unit) => unit.id === currentUserId) && (
        <div
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-cad-blue px-2 py-1 text-xs font-bold text-white shadow-lg ring-2 ring-white"
          style={position(currentLocation.lat, currentLocation.lon)}
        >
          <span className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cad-blue/50 location-pulse" />
          <span className="h-3 w-3 rounded-full bg-white/90" />
          You
        </div>
      )}

      {mapLayers.trails && visibleUnits
        .filter((unit) => unit.destinationLat !== undefined && unit.destinationLon !== undefined)
        .map((unit) => (
          <div
            key={`${unit.id}-destination`}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-xs font-bold text-slate-950 shadow-lg ring-2 ring-white"
            style={position(unit.destinationLat as number, unit.destinationLon as number)}
          >
            <span className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-amber-300/65 location-pulse" />
            <span className="h-3 w-3 rounded-full bg-slate-950" />
            {unit.destinationLabel || 'Destination'}
          </div>
        ))}

      {pinnedIncidents.map((incident) => (
        <button
          key={incident.id}
          type="button"
          onClick={() => onSelectIncident(incident)}
          className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold shadow-lg ring-2 ring-white ${
            incident.priority === 'Emergency' || incident.priority === 'High'
              ? 'bg-red-600 text-white'
              : 'bg-amber-400 text-slate-950'
          }`}
          style={position(incident.lat, incident.lon)}
        >
          <span
            className={`pointer-events-none absolute inset-0 -z-10 rounded-full ${
              incident.priority === 'Emergency' || incident.priority === 'High'
                ? 'bg-red-500/60'
                : 'bg-amber-300/65'
            } location-pulse`}
          />
          <ClipboardList size={14} />
          {incident.callNumber}
        </button>
      ))}

      <div className="absolute bottom-4 right-4 rounded bg-white/90 px-3 py-2 text-xs font-medium text-slate-600">
        Add REACT_APP_GOOGLE_API_KEY or REACT_APP_GOOGLE_MAPS_API_KEY for Google Maps
      </div>
    </div>
  );
};
