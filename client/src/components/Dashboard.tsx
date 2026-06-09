import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  Moon,
  Sun,
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
  UnitStatus,
  User,
  UserRole
} from '../types/auth';
import { ChangePasswordModal } from './common/ChangePasswordModal';
import { MessageAttachmentPreview } from './common/MessageAttachmentPreview';
import { ModalShell } from './common/ModalShell';
import { QuickLaunchDock, QuickLaunchSlot as DockSlotValue } from './common/QuickLaunchDock';
import { InquiryPanel, InquirySubmission } from './common/InquiryPanel';
import { ShieldSidebar, ShieldSidebarItem } from './common/ShieldSidebar';
import { callTypesFromConfig, defaultUnitStatuses, unitStatusesFromConfig } from '../utils/adminConfig';

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
        InfoWindow: new (options: Record<string, unknown>) => GoogleInfoWindowInstance;
        Polyline: new (options: GooglePolylineOptions) => GooglePolylineInstance;
        LatLng: new (lat: number, lng: number) => GoogleLatLngInstance;
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

interface GoogleLatLngInstance {}

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
type QuickLaunchId = 'messages' | 'calls' | 'new-call' | 'units' | 'unit-detail' | 'call-detail' | 'inquiries' | 'settings';
type QuickLaunchSlot = DockSlotValue<QuickLaunchId>;
type ToastNotice = { id: string; title: string; message: string; tone: 'info' | 'success' | 'warning' };
type UnitLocationReliability = 'live' | 'stale' | 'offline';

const quickLaunchOptions: Array<{ id: QuickLaunchId; label: string; icon: React.ReactNode }> = [
  { id: 'messages', label: 'Messages', icon: <MessageCircle size={18} /> },
  { id: 'calls', label: 'Calls', icon: <ClipboardList size={18} /> },
  { id: 'new-call', label: 'New Call', icon: <Send size={18} /> },
  { id: 'units', label: 'Units', icon: <Users size={18} /> },
  { id: 'unit-detail', label: 'Unit', icon: <Radio size={18} /> },
  { id: 'call-detail', label: 'Call', icon: <Shield size={18} /> },
  { id: 'inquiries', label: 'Inquiries', icon: <Search size={18} /> },
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [unitDetailOpen, setUnitDetailOpen] = useState(true);
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
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [adminConfig, setAdminConfig] = useState<AdminConfigurationItem[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
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
  const [customizingSlot, setCustomizingSlot] = useState<number | null>(null);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [destinationLat, setDestinationLat] = useState('');
  const [destinationLon, setDestinationLon] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapInstance | null>(null);
  const mapOverlaysRef = useRef<GoogleOverlayViewInstance[]>([]);
  const mapPolylinesRef = useRef<GooglePolylineInstance[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const selectedMessageUserIdRef = useRef('');
  const activeQuickModalRef = useRef<QuickLaunchId | null>(null);
  const directoryRef = useRef<User[]>([]);
  const latestPositionRef = useRef<GeolocationPosition | null>(null);
  const locationPublishInFlightRef = useRef(false);
  const knownIncidentIdsRef = useRef<Set<string>>(new Set());
  const initialIncidentsLoadedRef = useRef(false);

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || units[0] || null;
  const selectedIsCurrentUser = selectedUnit?.id === user?.id;
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || incidents[0] || null;
  const center = currentLocation || selectedUnit || { lat: 39.7684, lon: -86.1581 };
  const configuredUnitStatuses = useMemo(() => unitStatusesFromConfig(adminConfig), [adminConfig]);
  const configuredCallTypes = useMemo(() => callTypesFromConfig(adminConfig), [adminConfig]);

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
      units.reduce<Record<UnitStatus, number>>((counts, unit) => {
        const status = displayStatus(unit);
        return { ...counts, [status]: (counts[status] || 0) + 1 };
      }, Object.fromEntries(Array.from(new Set([...defaultUnitStatuses, ...configuredUnitStatuses])).map((status) => [status, 0])) as Record<UnitStatus, number>),
    [configuredUnitStatuses, units]
  );
  const locationReliabilityCounts = useMemo(
    () =>
      units.reduce<Record<UnitLocationReliability, number>>(
        (counts, unit) => ({
          ...counts,
          [locationReliability(unit, locationClock)]: counts[locationReliability(unit, locationClock)] + 1
        }),
        { live: 0, stale: 0, offline: 0 }
      ),
    [locationClock, units]
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
    if (!selectedUnit) {
      setDestinationLat('');
      setDestinationLon('');
      setDestinationLabel('');
      return;
    }

    setDestinationLat(selectedUnit.destinationLat?.toString() || '');
    setDestinationLon(selectedUnit.destinationLon?.toString() || '');
    setDestinationLabel(selectedUnit.destinationLabel || '');
  }, [selectedUnit]);

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

  const loadDirectory = useCallback(async () => {
    const users = await authClient.getDirectory();
    setDirectory(users);
    setSelectedMessageUserId((current) => current || users.find((item) => item.id !== user?.id)?.id || '');
    loadMessageThreads();
  }, [loadMessageThreads, user?.id]);

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
    activeQuickModalRef.current = activeQuickModal;
  }, [activeQuickModal]);

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
        setActiveQuickModal(null);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activeQuickModal, addressSuggestionsOpen, changePasswordOpen, customizingSlot, emojiOpen, settingsOpen]);

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
    const socket = io(realtimeUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
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
    socket.on('realtime:ready', () => {
      setRealtimeState('live');
      setLastRealtimeSync(new Date());
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

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadMessageThreads, playAlert, pushToast, user?.id]);

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
          fullscreenControl: true,
          styles: theme === 'dark' ? darkMapStyles : []
        });
      }

      const map = mapInstanceRef.current;
      map.setOptions({ styles: theme === 'dark' ? darkMapStyles : [] });
      mapOverlaysRef.current.forEach((overlay) => overlay.setMap(null));
      mapOverlaysRef.current = [];
      mapPolylinesRef.current.forEach((polyline) => polyline.setMap(null));
      mapPolylinesRef.current = [];

      units.forEach((unit) => {
        const shouldShowTrail = displayStatus(unit) === 'En Route' && (unit.locationTrail?.length || 0) > 1;
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

      incidents
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
  }, [center.lat, center.lon, currentLocation, incidents, locationClock, theme, units, user?.id]);

  const saveDestination = async () => {
    if (!selectedIsCurrentUser) return;
    const lat = Number(destinationLat);
    const lon = Number(destinationLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const updatedUser = await authClient.updateDestination(lat, lon, destinationLabel);
    if (isTrackedUnit(updatedUser)) {
      setUnits((currentUnits) => [updatedUser, ...currentUnits.filter((unit) => unit.id !== updatedUser.id)]);
    }
  };

  const clearDestination = async () => {
    if (!selectedIsCurrentUser) return;
    const updatedUser = await authClient.updateDestination(null, null, null);
    if (isTrackedUnit(updatedUser)) {
      setUnits((currentUnits) => [updatedUser, ...currentUnits.filter((unit) => unit.id !== updatedUser.id)]);
    }
  };

  const recenterToCurrentLocation = () => {
    const target = currentLocation || center;
    mapInstanceRef.current?.setCenter({ lat: target.lat, lng: target.lon });
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
  const filteredEmojis = emojiCatalog.filter((emoji) => !emojiSearch.trim() || emoji.includes(emojiSearch.trim()));
  const sidebarItems: ShieldSidebarItem[] = [
    { id: 'cjis', label: 'CJIS', icon: Shield, iconClassName: 'text-blue-700', onClick: () => setActiveQuickModal('inquiries') },
    { id: 'unit-status', label: 'UNIT STATUS', icon: Users, iconClassName: 'text-indigo-700', onClick: () => setActiveQuickModal('units') },
    { id: 'calls', label: 'CALLS', icon: ClipboardList, badge: callBadgeCount, iconClassName: 'text-amber-700', onClick: () => setActiveQuickModal('calls') },
    { id: 'messages', label: 'MESSAGES', icon: MessageCircle, badge: messageBadgeCount, iconClassName: 'text-emerald-700', onClick: () => openQuickLaunch('messages') },
    { id: 'protect', label: 'PROTECT ORD', icon: Search, iconClassName: 'text-red-700', onClick: () => setActiveQuickModal('inquiries') }
  ];
  const sidebarFooterItems: ShieldSidebarItem[] = [
    ...(user?.role === UserRole.ADMIN
      ? [{ id: 'officer-side', label: 'OFFICER SIDE', icon: Radio, iconClassName: 'text-blue-700', onClick: () => { window.location.href = '/officer'; } }]
      : []),
    ...(hasPermission('manage_system')
      ? [{ id: 'admin', label: 'ADMIN', icon: SlidersHorizontal, iconClassName: 'text-zinc-700', onClick: () => { window.location.href = '/admin/configuration'; } }]
      : []),
    { id: 'settings', label: 'SETTINGS', icon: Settings, iconClassName: 'text-zinc-700', onClick: () => setSettingsOpen((value) => !value) },
    { id: 'sign-out', label: '10-42', icon: LogOut, iconClassName: 'text-red-700', onClick: logout }
  ];

  useEffect(() => {
    localStorage.setItem('cad_pinned_message_threads', JSON.stringify(pinnedMessageThreadIds));
  }, [pinnedMessageThreadIds]);

  const togglePinnedMessageThread = (threadId: string) => {
    setPinnedMessageThreadIds((current) =>
      current.includes(threadId) ? current.filter((id) => id !== threadId) : [threadId, ...current]
    );
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

      const incident = await authClient.createIncident({
        type: incidentForm.type,
        priority: incidentForm.priority,
        address: incidentForm.address,
        description: incidentForm.description,
        callerName: incidentForm.callerName,
        callerPhone: incidentForm.callerPhone,
        lat,
        lon
      });
      setIncidents((current) => [incident, ...current.filter((item) => item.id !== incident.id)]);
      setSelectedIncidentId(incident.id);
      setActiveQuickModal(null);
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
      setActiveQuickModal('call-detail');
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

  const updateIncidentStatus = async (status: IncidentStatus) => {
    if (!selectedIncident) return;
    const disposition = status === 'Closed' || status === 'Canceled' ? incidentDisposition : undefined;
    const incident = await authClient.updateIncidentStatus(selectedIncident.id, status, disposition);
    setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
    setIncidentDisposition('');
  };

  const assignIncidentUnit = async () => {
    if (!selectedIncident || !assignmentUnitId) return;
    const incident = await authClient.assignIncidentUnit(selectedIncident.id, assignmentUnitId, 'Assigned');
    setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
    setAssignmentUnitId('');
  };

  const assignRecommendedUnit = async (unitId: string) => {
    if (!selectedIncident) return;
    const incident = await authClient.assignIncidentUnit(selectedIncident.id, unitId, 'Assigned');
    setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
  };

  const updateAssignedUnitStatus = async (userId: string, status: IncidentUnitStatus) => {
    if (!selectedIncident) return;
    const incident = await authClient.assignIncidentUnit(selectedIncident.id, userId, status);
    setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
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
    setActiveQuickModal(item);
  };

  const quickModalTitle = activeQuickModal
    ? quickLaunchOptions.find((item) => item.id === activeQuickModal)?.label || 'Quick Launch'
    : '';
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
      ? 'bg-emerald-500/20 text-emerald-100 ring-emerald-300/30'
      : realtimeState === 'offline'
        ? 'bg-red-500/20 text-red-100 ring-red-300/30'
        : 'bg-amber-500/20 text-amber-100 ring-amber-300/30';

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
          onClick={() => setActiveQuickModal(null)}
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

  const renderCallManagement = (showCallList: boolean) => (
    <div className={`grid h-[min(72vh,720px)] min-h-[540px] overflow-hidden rounded-md border border-cad-line dark:border-slate-700 ${showCallList ? 'md:grid-cols-[280px_1fr]' : ''}`}>
      {showCallList && (
        <div className="flex min-h-0 flex-col border-r border-cad-line bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
          <div className="shrink-0 border-b border-cad-line p-3 text-sm font-bold dark:border-slate-700">Active Calls</div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {incidents.length === 0 && <p className="rounded-md bg-white p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">No active calls.</p>}
            {incidents.map((incident) => (
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
                <p className="truncate text-sm font-bold">{incident.callNumber} · {incident.type}</p>
                <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">{incident.address}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${incidentPriorityStyles[incident.priority]}`}>
                    {incident.priority}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{incident.units.length} units</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 overflow-y-auto bg-white p-4 dark:bg-slate-900">
        {selectedIncident ? (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm">
              <Detail label="Call" value={selectedIncident.callNumber} />
              <Detail label="Type" value={selectedIncident.type} />
              <Detail label="Priority" value={selectedIncident.priority} />
              <Detail label="Status" value={selectedIncident.status} />
              <Detail label="Address" value={selectedIncident.address} />
              <Detail label="Caller" value={selectedIncident.callerName || 'Unknown'} />
              <Detail label="Phone" value={selectedIncident.callerPhone || 'Unknown'} />
            </dl>
            {selectedIncident.description && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-950 dark:text-slate-200">{selectedIncident.description}</p>}
            {selectedIncident.disposition && <Detail label="Disposition" value={selectedIncident.disposition} />}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Assigned Units</h3>
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
                <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Recommended Units</h3>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {recommendedUnits.map(({ unit }) => (
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
              <select value={assignmentUnitId} onChange={(event) => setAssignmentUnitId(event.target.value)} className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="">Select unit</option>
                {[...recommendedUnits.map((item) => item.unit), ...units.filter((unit) => !recommendedUnits.some((item) => item.unit.id === unit.id))].map((unit) => (
                  <option key={unit.id} value={unit.id}>{displayCadUnitNumber(unit)} · {unit.name}</option>
                ))}
              </select>
              <button type="button" onClick={assignIncidentUnit} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">Assign</button>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {(['Dispatched', 'En Route', 'On Scene', 'Closed', 'Canceled'] as IncidentStatus[]).map((status) => (
                <button key={status} type="button" onClick={() => updateIncidentStatus(status)} className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  {status}
                </button>
              ))}
            </div>
            <input value={incidentDisposition} onChange={(event) => setIncidentDisposition(event.target.value)} placeholder="Close/cancel disposition" className="w-full rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <div className="rounded-md border border-cad-line p-3 dark:border-slate-700">
              <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Call Timeline</h3>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
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
                <input value={incidentNoteBody} onChange={(event) => setIncidentNoteBody(event.target.value)} placeholder="Add call note" className="min-w-0 rounded-md border border-cad-line bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <button type="button" onClick={addIncidentNote} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">Add</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-96 items-center justify-center p-4 text-sm text-slate-600 dark:text-slate-300">Select a call to manage.</div>
        )}
      </div>
    </div>
  );

  const renderQuickModalContent = () => {
    if (activeQuickModal === 'messages') {
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
              <Send size={18} />
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
                            className={`max-w-[85%] rounded-[1.35rem] px-4 py-2.5 text-sm shadow-sm ${
                              mine
                                ? 'rounded-br-md bg-cad-blue text-white'
                                : 'rounded-bl-md border border-slate-200 bg-white text-cad-ink dark:border-slate-800 dark:bg-slate-900 dark:text-white'
                            }`}
                          >
                            {message.body && <p className="whitespace-pre-wrap text-left leading-6">{message.body}</p>}
                            {message.attachments?.map((attachment) => (
                              <MessageAttachmentPreview key={attachment.id} attachment={attachment} mine={mine} />
                            ))}
                            <p className={`mt-1 flex items-center gap-1 text-[11px] ${mine ? 'text-blue-100' : 'text-slate-500'}`}>
                              <Lock size={10} />
                              {formatMessageTime(message.createdAt)}
                              {mine && message.deliveryStatus === 'sending' && <span>Sending</span>}
                              {mine && message.deliveryStatus === 'failed' && <span>Failed</span>}
                              {mine && !message.readAt && message.deliveryStatus !== 'sending' && message.deliveryStatus !== 'failed' && <span>Sent</span>}
                              {mine && message.readAt && <><CheckCheck size={12} />Read</>}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                      onChange={(event) => setMessageBody(event.target.value)}
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
        </div>
      );
    }

    if (activeQuickModal === 'new-call') {
      return renderNewCallForm();
    }

    if (activeQuickModal === 'calls') {
      return renderCallManagement(true);
    }

    if ((activeQuickModal as string) === 'calls') {
      return (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {incidents.map((incident) => (
            <button
              key={incident.id}
              type="button"
              onClick={() => {
                setSelectedIncidentId(incident.id);
                setActiveQuickModal('call-detail');
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

    if (activeQuickModal === 'inquiries') {
      return (
        <InquiryPanel
          officers={directory.filter((item) => item.role === UserRole.OFFICER || item.role === UserRole.ADMIN)}
          defaultOfficerId={user?.id}
          message={incidentError}
          onSubmit={submitInquiry}
        />
      );
    }

    if (activeQuickModal === 'units') {
      return (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {units.map((unit) => (
            <button
              key={unit.id}
              type="button"
              onClick={() => {
                setSelectedUnitId(unit.id);
                setActiveQuickModal('unit-detail');
              }}
              className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800"
            >
              <span className="text-sm font-bold">{displayCadUnitNumber(unit)}</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">{displayStatus(unit)}</span>
            </button>
          ))}
        </div>
      );
    }

    if (activeQuickModal === 'unit-detail') {
      return selectedUnit ? (
        <dl className="grid gap-3 text-sm">
          <Detail label="Unit" value={displayCadUnitNumber(selectedUnit)} />
          <Detail label="Name" value={selectedUnit.name} />
          <Detail label="Status" value={displayStatus(selectedUnit)} />
          <Detail label="Tracking" value={locationReliabilityText(selectedUnit, locationClock)} />
          <Detail label="Location" value={`${selectedUnit.lat.toFixed(6)}, ${selectedUnit.lon.toFixed(6)}`} />
        </dl>
      ) : (
        <p className="text-sm text-slate-600">No tracked unit selected.</p>
      );
    }

    if (activeQuickModal === 'call-detail') {
      return renderCallManagement(false);
    }

    if ((activeQuickModal as string) === 'call-detail') {
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
    <div className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'dark bg-gray-950 text-gray-100' : 'bg-gray-50 text-cad-ink'}`}>
      <ShieldSidebar
        title="CAD"
        subtitle="Dispatch"
        user={user}
        collapsed={appSidebarCollapsed}
        onToggleCollapsed={() => setAppSidebarCollapsed((value) => !value)}
        items={sidebarItems}
        footerItems={sidebarFooterItems}
        onProfile={() => setSettingsOpen(true)}
      />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-cad-navy px-4 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold">CAD Dispatch</h1>
            <p className="text-xs text-slate-300">Live unit location dashboard</p>
          </div>
        </div>

        <div className="relative flex items-center gap-2">
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded-md ring-1 transition ${realtimeStatusClass}`}
            title={realtimeStatusLabel}
            aria-label={`Realtime status: ${realtimeStatusLabel}`}
          >
            {realtimeState === 'offline' ? <WifiOff size={19} /> : <Wifi size={19} />}
          </span>
          <button
            type="button"
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
            className="mr-2 rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label="Toggle light dark mode"
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            type="button"
            onClick={() => setActiveQuickModal('inquiries')}
            className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label="Open inquiries"
            title="Inquiries"
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label="Settings"
          >
            <Settings size={19} />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-cad-line bg-white py-2 text-cad-ink shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
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
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-900">
        {googleMapsApiKey ? (
          <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        ) : (
          <FallbackMap
            units={units}
            incidents={incidents}
            selectedUnit={selectedUnit}
            currentLocation={currentLocation}
            currentUserId={user?.id}
            locationClock={locationClock}
            onSelectUnit={(unit) => setSelectedUnitId(unit.id)}
            onSelectIncident={(incident) => setSelectedIncidentId(incident.id)}
          />
        )}

        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex flex-wrap justify-center gap-2">
          <MetricCard icon={<Radio size={14} />} label="Available" value={statusCounts.Available} />
          <MetricCard icon={<Shield size={14} />} label="Dispatched" value={statusCounts.Dispatched} />
          <MetricCard icon={<Layers size={14} />} label="En Route" value={statusCounts['En Route']} />
          <MetricCard
            icon={<MapPin size={14} />}
            label="Red Status"
            value={statusCounts['On Scene'] + statusCounts['Traffic Stop']}
          />
          <MetricCard icon={<MapPin size={14} />} label="Stale GPS" value={locationReliabilityCounts.stale + locationReliabilityCounts.offline} />
        </div>

        <button
          type="button"
          onClick={recenterToCurrentLocation}
          className="absolute bottom-4 left-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-cad-line bg-white/95 text-cad-blue shadow-xl transition hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-200 dark:hover:bg-slate-800"
          aria-label="Return to my location"
          title="My location"
        >
          <MapPin size={18} />
        </button>

        <button
          type="button"
          onClick={() => setSidebarOpen((value) => !value)}
          className="absolute top-1/2 z-20 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-cad-line bg-white/95 text-cad-blue shadow-xl transition-all duration-300 ease-out hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-200 dark:hover:bg-slate-800"
          style={{ left: sidebarOpen ? 'calc(min(22rem, calc(100vw - 2rem)) + 1rem)' : '0' }}
          aria-label={sidebarOpen ? 'Collapse units' : 'Open units'}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>

        <div
          className={`absolute bottom-24 left-4 top-20 z-10 flex w-[min(22rem,calc(100vw-2rem))] flex-col rounded-lg border border-cad-line bg-white/95 shadow-2xl transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
            sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-[calc(100%+2rem)] opacity-0'
          }`}
        >
            <div className="flex items-center justify-between border-b border-cad-line p-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Units</h2>
                <p className="text-xs text-slate-600">{units.length} tracked units</p>
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
                  onClick={() => {
                    setSelectedUnitId(unit.id);
                    setUnitDetailOpen(true);
                  }}
                  className={`w-full border-b border-slate-100 p-3 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${
                    selectedUnit?.id === unit.id ? 'bg-blue-50 dark:bg-blue-950/50' : 'bg-white/70 dark:bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{displayCadUnitNumber(unit)}</p>
                      <p className="truncate text-xs text-slate-600">{unit.name}</p>
                      <p
                        className={`mt-1 truncate text-xs font-semibold ${
                          locationReliability(unit, locationClock) === 'live'
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : locationReliability(unit, locationClock) === 'stale'
                              ? 'text-amber-600 dark:text-amber-300'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {locationReliabilityText(unit, locationClock)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${statusStyles[displayStatus(unit)]}`}>
                        {displayStatus(unit)}
                      </span>
                      {locationReliability(unit, locationClock) !== 'live' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                          {locationReliability(unit, locationClock)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
        </div>

        <div className="absolute right-4 top-20 z-10 flex flex-col items-end gap-3">
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

          <OverlayPanel
            title="Unit Detail"
            subtitle={selectedUnit ? displayCadUnitNumber(selectedUnit) : 'No tracked unit selected'}
            open={unitDetailOpen}
            onToggle={() => setUnitDetailOpen((value) => !value)}
            className="w-[min(28rem,calc(100vw-2rem))]"
          >
            {selectedUnit ? (
              <div className="max-h-[42vh] space-y-4 overflow-y-auto pr-1">
                <dl className="grid gap-3 text-sm">
                  <Detail label="Unit Number" value={displayUnitNumber(selectedUnit)} />
                  <Detail label="First Name" value={splitName(selectedUnit.name).firstName || 'N/A'} />
                  <Detail label="Last Name" value={splitName(selectedUnit.name).lastName || 'N/A'} />
                  <Detail label="CAD Unit Number" value={displayCadUnitNumber(selectedUnit)} />
                  <Detail label="Status" value={displayStatus(selectedUnit)} />
                  <Detail label="Tracking" value={locationReliabilityText(selectedUnit, locationClock)} />
                  <Detail label="Group" value={selectedUnit.group || 'Unassigned'} />
                  <Detail label="District" value={selectedUnit.district || 'Unassigned'} />
                  <Detail label="Lat" value={selectedUnit.lat.toFixed(6)} />
                  <Detail label="Lon" value={selectedUnit.lon.toFixed(6)} />
                  <Detail label="Speed" value={`${(selectedUnit.speedMph || 0).toFixed(1)} mph`} />
                  <Detail label="ETA" value={etaText(selectedUnit)} />
                </dl>
                {selectedIsCurrentUser && displayStatus(selectedUnit) === 'En Route' && (
                  <div className="border-t border-cad-line pt-4">
                    <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Destination</h3>
                    <div className="mt-3 grid gap-3">
                      <input value={destinationLabel} onChange={(event) => setDestinationLabel(event.target.value)} placeholder="Destination label" className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100" />
                      <div className="grid grid-cols-2 gap-3">
                        <input value={destinationLat} onChange={(event) => setDestinationLat(event.target.value)} placeholder="Destination lat" className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100" />
                        <input value={destinationLon} onChange={(event) => setDestinationLon(event.target.value)} placeholder="Destination lon" className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100" />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={saveDestination} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">Pin Destination</button>
                        <button type="button" onClick={clearDestination} className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700">Clear</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-600">When a real user signs in and allows location access, they will appear here.</p>
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

      <ChangePasswordModal
        open={changePasswordOpen}
        form={passwordForm}
        message={passwordMessage}
        onClose={() => setChangePasswordOpen(false)}
        onChange={setPasswordForm}
        onSubmit={changePassword}
      />

      <ModalShell
        title={quickModalTitle}
        open={Boolean(activeQuickModal)}
        onClose={() => setActiveQuickModal(null)}
        placement={activeQuickModal === 'messages' || activeQuickModal === 'calls' || activeQuickModal === 'call-detail' ? 'center' : 'bottom'}
        maxWidthClass={activeQuickModal === 'messages' || activeQuickModal === 'calls' || activeQuickModal === 'call-detail' ? 'max-w-5xl' : 'mb-20 max-w-2xl'}
        contentClassName="p-4 overflow-hidden"
      >
        {activeQuickModal ? renderQuickModalContent() : null}
      </ModalShell>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({
  icon,
  label,
  value
}) => (
  <div className="flex min-h-12 min-w-36 items-center justify-between rounded-md border border-cad-line bg-white/95 px-3 py-2 shadow-control dark:border-slate-700 dark:bg-slate-900/95">
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-cad-blue">{icon}</span>
      <p className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</p>
    </div>
    <p className="text-lg font-bold">{value}</p>
  </div>
);

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

const Detail: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
    <dt className="font-semibold text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="font-medium text-cad-ink dark:text-white">{value}</dd>
  </div>
);

const FallbackMap: React.FC<{
  units: TrackedUnit[];
  incidents: Incident[];
  selectedUnit: TrackedUnit | null;
  currentLocation: { lat: number; lon: number } | null;
  currentUserId?: string;
  locationClock: number;
  onSelectUnit: (unit: TrackedUnit) => void;
  onSelectIncident: (incident: Incident) => void;
}> = ({ units, incidents, selectedUnit, currentLocation, currentUserId, locationClock, onSelectUnit, onSelectIncident }) => {
  const pinnedIncidents = incidents.filter(
    (incident): incident is Incident & { lat: number; lon: number } =>
      incident.lat !== undefined && incident.lon !== undefined
  );
  const destinations = units
    .filter((unit) => unit.destinationLat !== undefined && unit.destinationLon !== undefined)
    .map((unit) => ({
      id: `${unit.id}-destination`,
      lat: unit.destinationLat as number,
      lon: unit.destinationLon as number
    }));
  const points = currentLocation
    ? [
        ...units,
        ...destinations,
        ...pinnedIncidents,
        { id: 'current-location', lat: currentLocation.lat, lon: currentLocation.lon }
      ]
    : [...units, ...destinations, ...pinnedIncidents];
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

      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {units
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

      {units.map((unit) => (
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

      {units
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
