import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  Navigation,
  Paperclip,
  Pin,
  PinOff,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  Siren,
  Sun,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runtimeConfig } from '../config/runtimeConfig';
import { authClient } from '../services/authClient';
import { AdminConfigurationItem, ChatMessage, Incident, IncidentPriority, IncidentUnitStatus, MessageThread, SendMessageAttachment, User, UserRole } from '../types/auth';
import { ChangePasswordModal } from './common/ChangePasswordModal';
import { MessageAttachmentPreview } from './common/MessageAttachmentPreview';
import { ModalShell } from './common/ModalShell';
import { QuickLaunchDock, QuickLaunchSlot } from './common/QuickLaunchDock';
import { InquiryPanel, InquirySubmission } from './common/InquiryPanel';
import { ShieldSidebar, ShieldSidebarItem } from './common/ShieldSidebar';
import { callTypesFromConfig } from '../utils/adminConfig';
import { APP_NAME } from '../constants/branding';

type DockItem = 'calls' | 'call-detail' | 'notes' | 'messages' | 'inquiries' | 'location' | 'settings' | 'navigation' | 'status';
type DockSlot = QuickLaunchSlot<DockItem>;
type RealtimeReadyPayload = { serverTime?: string; onlineUserIds?: string[] };
type PendingCallFeedRow = { incident: Incident; exiting: boolean };
type CallTabId = 'all' | 'my' | 'pending' | 'closed';

interface OfficerGoogleMaps {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  OverlayView: new () => GoogleOverlayViewInstance;
  LatLng: new (lat: number, lng: number) => GoogleLatLngInstance;
  Polyline: new (options: GooglePolylineOptions) => GooglePolylineInstance;
  LatLngBounds: new () => GoogleLatLngBoundsInstance;
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

interface GoogleLatLngBoundsInstance {
  extend: (location: { lat: number; lng: number }) => void;
}

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
  maximumAge: 0,
  timeout: 10000
};

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
  green: 'bg-emerald-400/60',
  yellow: 'bg-amber-300/65',
  red: 'bg-red-500/60',
  blue: 'bg-cad-blue/50'
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

const navigationUrl = (incident: Incident): string => {
  const destination = incident.lat && incident.lon ? `${incident.lat},${incident.lon}` : incident.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
};

const getMyUnitStatus = (incident: Incident, userId?: string): IncidentUnitStatus | null =>
  incident.units.find((unit) => unit.userId === userId)?.status || null;

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
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [lastRealtimeSync, setLastRealtimeSync] = useState<Date | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationTrail, setLocationTrail] = useState<Array<{ lat: number; lon: number; speedMph?: number | null }>>([]);
  const [mapReady, setMapReady] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
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
  const [messageBadgeCount, setMessageBadgeCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const latestLocationRef = useRef<{ lat: number; lon: number; speedMph?: number | null } | null>(null);
  const uploadingLocationRef = useRef(false);
  const lastLocationUploadAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GoogleMapInstance | null>(null);
  const mapOverlaysRef = useRef<GoogleOverlayViewInstance[]>([]);
  const trailPolylineRef = useRef<GooglePolylineInstance | null>(null);
  const hasFitCallBoundsRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const selectedMessageUserIdRef = useRef('');
  const activeQuickModalRef = useRef<DockItem | null>(null);
  const dockZCounterRef = useRef(60);
  const pendingCallFeedPreviousRef = useRef<Map<string, Incident>>(new Map());
  const pendingCallExitTimersRef = useRef<Record<string, number>>({});

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
  const assignmentMapKey = assignedIncidents.map((incident) => incident.id).join(',');
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || assignedIncidents[0] || incidents[0] || null;
  const configuredCallTypes = useMemo(() => callTypesFromConfig(adminConfig), [adminConfig]);
  const selectedStatus = selectedIncident ? getMyUnitStatus(selectedIncident, user?.id) : null;
  const selectedAssignmentWarning = assignmentWarning(selectedIncident, user?.id);
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
  const locationStatusLabel =
    locationState === 'live'
      ? 'Active'
      : locationState === 'starting'
        ? 'Starting GPS'
        : locationState === 'blocked'
          ? 'Location blocked'
          : 'GPS unavailable';
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

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

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

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadMessageThreads, user?.id]);

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
        const speedMph =
          position.coords.speed === null || position.coords.speed === undefined
            ? null
            : Math.max(0, position.coords.speed * 2.23694);
        latestLocationRef.current = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          speedMph
        };
        const nextLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCurrentLocation(nextLocation);
        setLocationTrail((current) => {
          const previous = current[current.length - 1];
          if (previous && distanceMiles(previous.lat, previous.lon, nextLocation.lat, nextLocation.lon) < 0.005) {
            return current;
          }
          return [...current, { ...nextLocation, speedMph }].slice(-80);
        });
        setCurrentSpeed(speedMph);
        setLocationState('live');
        uploadLatestLocation();
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
    trailPolylineRef.current?.setMap(null);
    trailPolylineRef.current = null;

    const bounds = new googleMaps.LatLngBounds();
    let hasCallBounds = false;

    if (currentLocation) {
      const selectedIsEnRoute = selectedStatus === 'En Route';
      mapOverlaysRef.current.push(
        ...[
          addOfficerOverlay({
            map,
            lat: currentLocation.lat,
            lon: currentLocation.lon,
            label: '',
            tone: selectedIsEnRoute ? 'yellow' : 'green'
          }),
          addOfficerOverlay({
            map,
            lat: currentLocation.lat,
            lon: currentLocation.lon,
            label: currentSpeed === null ? '' : `${Math.round(currentSpeed)} mph`,
            tone: selectedIsEnRoute ? 'yellow' : 'green'
          })
        ].filter(Boolean) as GoogleOverlayViewInstance[]
      );

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
    } else if (currentLocation) {
      map.setCenter({ lat: currentLocation.lat, lng: currentLocation.lon });
      map.setZoom(15);
    }
  }, [assignedIncidents, currentLocation, currentSpeed, locationTrail, selectedStatus, theme]);

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
      const incident = await authClient.createOfficerEvent({
        type: officerEvent.type,
        priority: officerEvent.priority,
        description: officerEvent.description,
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

  const submitInquiry = async (submission: InquirySubmission) => {
    setBusy(true);
    setMessage('');
    try {
      const incident = await authClient.createOfficerEvent({
        type: submission.title,
        priority: 'Normal',
        description: submission.description,
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
                  : 'max-h-24 translate-y-0 border-white/10 bg-white px-3 py-2 opacity-100 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-black text-cad-ink dark:text-white">{incident.callNumber}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${
                    incident.priority === 'Emergency' || incident.priority === 'High'
                      ? 'bg-red-600 text-white'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-400 dark:text-slate-950'
                  }`}
                >
                  {incident.priority}
                </span>
              </span>
              <span className="mt-1 block truncate text-xs font-bold text-slate-700 dark:text-slate-200">{incident.type}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
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
    <main className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'dark bg-gray-950 text-white' : 'bg-gray-50 text-slate-950'}`}>
      <ShieldSidebar
        title={APP_NAME}
        subtitle="Officer"
        user={user}
        collapsed={appSidebarCollapsed}
        onToggleCollapsed={() => setAppSidebarCollapsed((value) => !value)}
        items={sidebarItems}
        bottomContent={renderPendingCallFeed(appSidebarCollapsed)}
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

      <button
        type="button"
        onClick={recenterMap}
        className="absolute bottom-4 left-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-cad-blue shadow-xl hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-200"
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
        className={`absolute bottom-24 left-4 top-20 z-20 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-2xl transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
          leftOpen ? 'translate-x-0 opacity-100' : '-translate-x-[calc(100%+2rem)] opacity-0'
        }`}
      >
        <section className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Live Tracking</p>
              <p className="mt-1 text-sm font-semibold">{locationStatusLabel}</p>
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
                onUpdateStatus={updateStatus}
                onAddNote={addNote}
                onLogout={logout}
                setOfficerEvent={setOfficerEvent}
                onCreateOfficerEvent={createOfficerEvent}
                onSubmitInquiry={submitInquiry}
                inquiryOfficers={directory.filter((item) => item.role === UserRole.OFFICER || item.role === UserRole.ADMIN)}
                directory={messageThreads}
                messageThreadByUser={messageThreadByUser}
                onlineUserIds={onlineUserIds}
                selectedMessageUser={selectedMessageUser}
                selectedMessageUserId={selectedMessageUserId}
                messages={searchedMessages}
                messageBody={messageBody}
                messageSearch={messageSearch}
                messageTextSearch={messageTextSearch}
                pinnedMessageThreadIds={pinnedMessageThreadIds}
                pendingAttachments={pendingAttachments}
                emojiOpen={emojiOpen}
                emojiSearch={emojiSearch}
                emojiButton={emojiButton}
                filteredEmojis={filteredEmojis}
                currentUserIdForMessages={user?.id || ''}
                setSelectedMessageUserId={setSelectedMessageUserId}
                setMessageBody={setMessageBody}
                setMessageSearch={setMessageSearch}
                setMessageTextSearch={setMessageTextSearch}
                onTogglePinnedThread={togglePinnedMessageThread}
                setPendingAttachments={setPendingAttachments}
                setEmojiOpen={setEmojiOpen}
                setEmojiSearch={setEmojiSearch}
                onSendMessage={sendMessage}
                onAttachment={handleAttachment}
              />
        </ModalShell>
      ))}

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
  onUpdateStatus: (status: IncidentUnitStatus) => void;
  onAddNote: () => void;
  onLogout: () => void;
  setOfficerEvent: React.Dispatch<React.SetStateAction<{ type: string; priority: IncidentPriority; description: string }>>;
  onCreateOfficerEvent: () => void;
  onSubmitInquiry: (submission: InquirySubmission) => void;
  inquiryOfficers: User[];
  directory: User[];
  messageThreadByUser: Record<string, MessageThread>;
  onlineUserIds: string[];
  selectedMessageUser: User | null;
  selectedMessageUserId: string;
  messages: ChatMessage[];
  messageBody: string;
  messageSearch: string;
  messageTextSearch: string;
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
  onTogglePinnedThread: (threadId: string) => void;
  setPendingAttachments: React.Dispatch<React.SetStateAction<SendMessageAttachment[]>>;
  setEmojiOpen: (value: boolean) => void;
  setEmojiSearch: (value: string) => void;
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
  onUpdateStatus,
  onAddNote,
  onLogout,
  setOfficerEvent,
  onCreateOfficerEvent,
  onSubmitInquiry,
  inquiryOfficers,
  directory,
  messageThreadByUser,
  onlineUserIds,
  selectedMessageUser,
  selectedMessageUserId,
  messages,
  messageBody,
  messageSearch,
  messageTextSearch,
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
  onTogglePinnedThread,
  setPendingAttachments,
  setEmojiOpen,
  setEmojiSearch,
  onSendMessage,
  onAttachment
}) => {
  const [activeCallTab, setActiveCallTab] = useState<CallTabId>('all');
  const isClosedCall = (incident: Incident) => incident.status === 'Closed' || incident.status === 'Canceled';
  const isMyCall = (incident: Incident) =>
    incident.units.some((unit) => unit.userId === currentUserId && unit.status !== 'Cleared') || incident.createdBy === currentUserId;
  const tabIncidents = (tab: CallTabId) =>
    incidents.filter((incident) => {
      if (tab === 'my') return isMyCall(incident);
      if (tab === 'pending') return incident.status === 'Pending';
      if (tab === 'closed') return isClosedCall(incident);
      return true;
    });
  const callTabs: Array<{ id: CallTabId; label: string; calls: Incident[] }> = [
    { id: 'all', label: 'All Calls', calls: tabIncidents('all') },
    { id: 'my', label: 'My Calls', calls: tabIncidents('my') },
    { id: 'pending', label: 'Pending Calls', calls: tabIncidents('pending') },
    { id: 'closed', label: 'Closed Calls', calls: tabIncidents('closed') }
  ];
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
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {callTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCallTab(tab.id)}
              className={`rounded px-2 py-2 text-left text-[11px] font-black uppercase tracking-[0.08em] transition ${
                activeCallTab === tab.id
                  ? 'bg-cad-blue text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span className="block truncate">{tab.label}</span>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="ETA" value={etaText(currentLocation, selectedIncident, currentSpeed)} />
          <Metric label="Coordinates" value={selectedIncident.lat !== undefined && selectedIncident.lon !== undefined ? `${selectedIncident.lat.toFixed(5)}, ${selectedIncident.lon.toFixed(5)}` : 'No map pin'} />
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
        onTogglePinnedThread={onTogglePinnedThread}
        setPendingAttachments={setPendingAttachments}
        setEmojiOpen={setEmojiOpen}
        setEmojiSearch={setEmojiSearch}
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
  onTogglePinnedThread: (threadId: string) => void;
  setPendingAttachments: React.Dispatch<React.SetStateAction<SendMessageAttachment[]>>;
  setEmojiOpen: (value: boolean) => void;
  setEmojiSearch: (value: string) => void;
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
  onTogglePinnedThread,
  setPendingAttachments,
  setEmojiOpen,
  setEmojiSearch,
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
        <Send size={18} />
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
                  className={`max-w-[85%] rounded-[1.35rem] px-4 py-2.5 text-sm shadow-sm ${
                    mine
                      ? 'rounded-br-md bg-cad-blue text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-white'
                  }`}
                >
                  {message.body && <p className="whitespace-pre-wrap text-left leading-6">{message.body}</p>}
                  {message.attachments?.map((attachment) => (
                    <MessageAttachmentPreview key={attachment.id} attachment={attachment} mine={mine} />
                  ))}
                  <p className={`mt-1 flex items-center gap-1 text-[11px] ${mine ? 'text-blue-100' : 'text-slate-500'}`}>
                    <Lock size={10} />
                    {formatMessageTime(message.createdAt)}
                    {mine && message.deliveryStatus === 'sending'
                      ? 'Sending'
                      : mine && message.deliveryStatus === 'failed'
                        ? 'Failed'
                        : mine && message.readAt
                          ? 'Read'
                          : mine
                            ? 'Sent'
                            : 'Encrypted'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
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
  </div>
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
  currentSpeed: number | null;
}> = ({ currentLocation, assignedIncidents, currentUserLabel, currentSpeed }) => (
  <div className="relative h-full w-full overflow-hidden bg-slate-900">
    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:48px_48px]" />
    <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500 ring-4 ring-white shadow-xl" title={currentUserLabel} />
    {currentSpeed !== null && (
      <div className="absolute left-[calc(50%+1rem)] top-[calc(50%-1.5rem)] rounded-full bg-emerald-500 px-2 py-1 text-xs font-bold text-white ring-2 ring-white">
        {Math.round(currentSpeed)} mph
      </div>
    )}
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
