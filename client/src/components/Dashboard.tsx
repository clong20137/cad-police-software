import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  GripVertical,
  MessageCircle,
  Layers,
  LogOut,
  Lock,
  MapPin,
  Paperclip,
  Radio,
  Send,
  Settings,
  Shield,
  CheckCheck,
  Moon,
  Sun,
  X,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { runtimeConfig } from '../config/runtimeConfig';
import { authClient } from '../services/authClient';
import {
  ChatMessage,
  Incident,
  IncidentPriority,
  IncidentStatus,
  SendMessageAttachment,
  UnitStatus,
  User
} from '../types/auth';

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
        InfoWindow: new (options: Record<string, unknown>) => GoogleInfoWindowInstance;
        LatLng: new (lat: number, lng: number) => GoogleLatLngInstance;
        OverlayView: new () => GoogleOverlayViewInstance;
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
}

interface GoogleInfoWindowInstance {
  open: (options: { map: GoogleMapInstance; position: { lat: number; lng: number } }) => void;
}

interface GoogleLatLngInstance {}

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
type QuickLaunchId = 'messages' | 'calls' | 'new-call' | 'units' | 'unit-detail' | 'call-detail' | 'map' | 'settings';
type QuickLaunchSlot = QuickLaunchId | null;

const quickLaunchOptions: Array<{ id: QuickLaunchId; label: string; icon: React.ReactNode }> = [
  { id: 'messages', label: 'Messages', icon: <MessageCircle size={18} /> },
  { id: 'calls', label: 'Calls', icon: <ClipboardList size={18} /> },
  { id: 'new-call', label: 'New Call', icon: <Send size={18} /> },
  { id: 'units', label: 'Units', icon: <Users size={18} /> },
  { id: 'unit-detail', label: 'Unit', icon: <Radio size={18} /> },
  { id: 'call-detail', label: 'Call', icon: <Shield size={18} /> },
  { id: 'map', label: 'Map', icon: <MapPin size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> }
];

const defaultQuickLaunchSlots: QuickLaunchSlot[] = [
  'messages',
  'calls',
  'new-call',
  'units',
  'unit-detail',
  'call-detail',
  'map',
  'settings'
];

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

const markerTone = (unit: User, currentUserId?: string): 'gray' | 'green' | 'blue' | 'yellow' | 'red' => {
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

const formatDateTime = (value?: Date | string): string => {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
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
}) => {
  if (!window.google?.maps) {
    return;
  }

  const position = new window.google.maps.LatLng(lat, lon);

  class PulseOverlay extends window.google.maps.OverlayView {
    private container: HTMLElement | null = null;

    onAdd() {
      const container = document.createElement(onClick ? 'button' : 'div');
      if (container instanceof HTMLButtonElement) {
        container.type = 'button';
      }

      container.className = `absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold shadow-lg ring-2 ${markerToneClass[tone]}`;
      container.style.cursor = onClick ? 'pointer' : 'default';

      const pulse = document.createElement('span');
      pulse.className = `pointer-events-none absolute inset-0 -z-10 rounded-full ${markerPulseClass[tone]} location-pulse`;
      container.appendChild(pulse);

      const pin = document.createElement('span');
      pin.className = 'h-3 w-3 rounded-full bg-current ring-2 ring-white/70';
      container.appendChild(pin);

      const text = document.createElement('span');
      text.textContent = label;
      container.appendChild(text);

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

  new PulseOverlay().setMap(map);
};

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [directory, setDirectory] = useState<User[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [selectedMessageUserId, setSelectedMessageUserId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageBody, setMessageBody] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiButton, setEmojiButton] = useState(() => emojiCatalog[Math.floor(Math.random() * emojiCatalog.length)] || '😀');
  const [emojiSearch, setEmojiSearch] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<SendMessageAttachment[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
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
  const [quickLaunchSlots, setQuickLaunchSlots] = useState<QuickLaunchSlot[]>(() => {
    const stored = localStorage.getItem('cad_quick_launch_slots');
    if (!stored) return defaultQuickLaunchSlots;
    try {
      const parsed = JSON.parse(stored) as QuickLaunchSlot[];
      return Array.from({ length: 8 }, (_, index) => parsed[index] || null);
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
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || units[0] || null;
  const selectedIsCurrentUser = selectedUnit?.id === user?.id;
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) || incidents[0] || null;
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
        { Available: 0, Dispatched: 0, 'En Route': 0, 'On Scene': 0, Transporting: 0, 'Traffic Stop': 0 }
      ),
    [units]
  );

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

  const loadDirectory = useCallback(async () => {
    const users = await authClient.getDirectory();
    setDirectory(users);
    setSelectedMessageUserId((current) => current || users.find((item) => item.id !== user?.id)?.id || '');
  }, [user?.id]);

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
    socket.on('presence:update', (presence: { onlineUserIds: string[]; users: User[] }) => {
      setOnlineUserIds(presence.onlineUserIds || []);
      setDirectory(presence.users || []);
    });
    socket.on('incidents:update', (nextIncidents: Incident[]) => {
      setIncidents(nextIncidents || []);
      setIncidentError('');
      setSelectedIncidentId((current) => {
        if (current && nextIncidents.some((incident) => incident.id === current)) {
          return current;
        }
        return nextIncidents[0]?.id || '';
      });
    });
    socket.on('message:new', (message: ChatMessage) => {
      setMessages((current) => {
        const belongsToSelected =
          message.senderId === selectedMessageUserId ||
          message.recipientId === selectedMessageUserId ||
          message.senderId === user?.id ||
          message.recipientId === user?.id;
        if (!belongsToSelected || current.some((item) => item.id === message.id)) {
          return current;
        }
        return [...current, message];
      });
    });
    socket.on('message:read', (receipt: { readerId: string; senderId: string; messageIds: string[] }) => {
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
  }, [selectedMessageUserId, user?.id]);

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

    authClient.getMessages(selectedMessageUserId).then(setMessages).catch(() => setMessages([]));
  }, [selectedMessageUserId]);

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
        const infoWindow = new window.google!.maps.InfoWindow({
          content: `<strong>${displayCadUnitNumber(unit)}</strong><br>${unit.name}<br>${displayStatus(unit)}`
        });
        addGooglePulseMarker({
          map,
          lat: unit.lat,
          lon: unit.lon,
          label: displayCadUnitNumber(unit),
          tone: markerTone(unit, user?.id),
          onClick: () => {
            setSelectedUnitId(unit.id);
            infoWindow.open({ map, position: { lat: unit.lat, lng: unit.lon } });
          }
        });
        if (unit.destinationLat !== undefined && unit.destinationLon !== undefined) {
          addGooglePulseMarker({
            map,
            lat: unit.destinationLat,
            lon: unit.destinationLon,
            label: unit.destinationLabel || 'Destination',
            tone: 'yellow'
          });
        }
      });

      incidents
        .filter((incident) => incident.lat !== undefined && incident.lon !== undefined)
        .forEach((incident) => {
          addGooglePulseMarker({
            map,
            lat: incident.lat as number,
            lon: incident.lon as number,
            label: incident.callNumber,
            tone: incident.priority === 'Emergency' || incident.priority === 'High' ? 'red' : 'yellow',
            onClick: () => setSelectedIncidentId(incident.id)
          });
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places`;
    script.async = true;
    script.onload = initializeMap;
    document.head.appendChild(script);
  }, [center.lat, center.lon, currentLocation, incidents, units, user?.id]);

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

  const selectedMessageUser = directory.find((item) => item.id === selectedMessageUserId) || null;
  const visibleMessages = messages.filter(
    (message) =>
      (message.senderId === user?.id && message.recipientId === selectedMessageUserId) ||
      (message.senderId === selectedMessageUserId && message.recipientId === user?.id)
  );
  const filteredEmojis = emojiCatalog.filter((emoji) => !emojiSearch.trim() || emoji.includes(emojiSearch.trim()));

  const sendChatMessage = async () => {
    if (!selectedMessageUserId || (!messageBody.trim() && pendingAttachments.length === 0)) return;
    const sent = await authClient.sendMessage(selectedMessageUserId, messageBody, pendingAttachments);
    setMessages((current) => [...current.filter((item) => item.id !== sent.id), sent]);
    setMessageBody('');
    setPendingAttachments([]);
    setEmojiOpen(false);
  };

  const openEmojiPicker = () => {
    setEmojiButton(emojiCatalog[Math.floor(Math.random() * emojiCatalog.length)] || '😀');
    setEmojiOpen((value) => !value);
  };

  const changePassword = async () => {
    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage('New password must be at least 8 characters.');
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

  const createIncident = async () => {
    if (!incidentForm.type.trim() || !incidentForm.address.trim()) {
      setIncidentError('Call type and address are required.');
      return;
    }

    try {
      const lat = incidentForm.lat ? Number(incidentForm.lat) : null;
      const lon = incidentForm.lon ? Number(incidentForm.lon) : null;
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
        type: '911 Call',
        priority: 'Normal',
        address: '',
        description: '',
        callerName: '',
        callerPhone: '',
        lat: '',
        lon: ''
      });
    } catch {
      setIncidentError('Unable to create the call. Check the required fields and coordinates.');
    }
  };

  const updateIncidentStatus = async (status: IncidentStatus) => {
    if (!selectedIncident) return;
    const incident = await authClient.updateIncidentStatus(selectedIncident.id, status);
    setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
  };

  const assignIncidentUnit = async () => {
    if (!selectedIncident || !assignmentUnitId) return;
    const incident = await authClient.assignIncidentUnit(selectedIncident.id, assignmentUnitId, 'Assigned');
    setIncidents((current) => current.map((item) => (item.id === incident.id ? incident : item)));
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
    if (item === 'settings') {
      setSettingsOpen(false);
    }
    setActiveQuickModal(item);
  };

  const quickModalTitle = activeQuickModal
    ? quickLaunchOptions.find((item) => item.id === activeQuickModal)?.label || 'Quick Launch'
    : '';

  const renderNewCallForm = () => (
    <div className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
      <input
        value={incidentForm.type}
        onChange={(event) => setIncidentForm((value) => ({ ...value, type: event.target.value }))}
        placeholder="Call type"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
      />
      <select
        value={incidentForm.priority}
        onChange={(event) =>
          setIncidentForm((value) => ({ ...value, priority: event.target.value as IncidentPriority }))
        }
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
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
          className="w-full rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
        />
        {addressSuggestionsOpen && addressSuggestions.length > 0 && (
          <div className="absolute inset-x-0 top-11 z-20 rounded-md border border-cad-line bg-white shadow-xl">
            {addressSuggestions.map((suggestion) => (
              <button
                key={suggestion.place_id}
                type="button"
                onClick={() => {
                  setIncidentForm((value) => ({ ...value, address: suggestion.description }));
                  setAddressSuggestionsOpen(false);
                }}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-blue-50"
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
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
      />
      <input
        value={incidentForm.callerPhone}
        onChange={(event) => setIncidentForm((value) => ({ ...value, callerPhone: event.target.value }))}
        placeholder="Caller phone"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
      />
      <input
        value={incidentForm.lat}
        onChange={(event) => setIncidentForm((value) => ({ ...value, lat: event.target.value }))}
        placeholder="Lat"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
      />
      <input
        value={incidentForm.lon}
        onChange={(event) => setIncidentForm((value) => ({ ...value, lon: event.target.value }))}
        placeholder="Lon"
        className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
      />
      <textarea
        value={incidentForm.description}
        onChange={(event) => setIncidentForm((value) => ({ ...value, description: event.target.value }))}
        placeholder="Call notes"
        className="min-h-28 rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 sm:col-span-2"
      />
      {incidentError && <p className="text-sm font-medium text-red-600 sm:col-span-2">{incidentError}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={() => setActiveQuickModal(null)}
          className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700"
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

  const renderQuickModalContent = () => {
    if (activeQuickModal === 'messages') {
      return (
        <div className="grid min-h-[520px] overflow-hidden rounded-md border border-cad-line sm:grid-cols-[220px_1fr]">
          <div className="max-h-[70vh] overflow-y-auto border-r border-cad-line bg-slate-50">
            {directory
              .filter((item) => item.id !== user?.id)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedMessageUserId(item.id)}
                  className={`w-full border-b border-slate-200 px-3 py-3 text-left text-sm ${
                    selectedMessageUserId === item.id ? 'bg-blue-50' : 'hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        onlineUserIds.includes(item.id) ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {onlineUserIds.includes(item.id) ? 'Active now' : `Last seen ${formatDateTime(item.lastSeenAt)}`}
                  </span>
                </button>
              ))}
          </div>
          <div className="flex min-w-0 flex-col">
            {selectedMessageUser ? (
              <>
                <div className="border-b border-cad-line px-4 py-3">
                  <p className="text-sm font-bold">{selectedMessageUser.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{onlineUserIds.includes(selectedMessageUser.id) ? 'Active now' : `Last seen ${formatDateTime(selectedMessageUser.lastSeenAt)}`}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                      <Lock size={12} />
                      Encrypted
                    </span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-white p-4">
                  {visibleMessages.map((message) => {
                    const mine = message.senderId === user?.id;
                    return (
                      <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            mine ? 'bg-cad-blue text-white' : 'bg-slate-100 text-cad-ink'
                          }`}
                        >
                          {message.body && <p>{message.body}</p>}
                          {message.attachments?.map((attachment) => (
                            <a
                              key={attachment.id}
                              href={attachment.dataUrl}
                              download={attachment.fileName}
                              className={`mt-2 flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold ${
                                mine ? 'bg-white/15 text-white' : 'bg-white text-cad-blue'
                              }`}
                            >
                              <Paperclip size={13} />
                              <span className="truncate">{attachment.fileName}</span>
                            </a>
                          ))}
                          <p className={`mt-1 flex items-center gap-1 text-[11px] ${mine ? 'text-blue-100' : 'text-slate-500'}`}>
                            <Lock size={10} />
                            {formatDateTime(message.createdAt)}
                            {mine && message.readAt && (
                              <>
                                <CheckCheck size={12} />
                                Read
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-cad-line p-3">
                  {emojiOpen && (
                    <div className="mb-2 rounded-md border border-cad-line bg-slate-50 p-2">
                      <input
                        value={emojiSearch}
                        onChange={(event) => setEmojiSearch(event.target.value)}
                        placeholder="Search or paste any emoji"
                        className="mb-2 w-full rounded-md border border-cad-line px-2 py-1 text-sm outline-none focus:border-cad-blue"
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
              <div className="flex min-h-80 items-center justify-center p-4 text-sm text-slate-600">
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
              className="w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50"
            >
              <p className="text-sm font-bold">{incident.callNumber} · {incident.type}</p>
              <p className="mt-1 text-xs text-slate-600">{incident.address}</p>
            </button>
          ))}
          {incidents.length === 0 && <p className="text-sm text-slate-600">No active calls.</p>}
        </div>
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
              className="flex w-full items-center justify-between rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50"
            >
              <span className="text-sm font-bold">{displayCadUnitNumber(unit)}</span>
              <span className="text-xs text-slate-600">{displayStatus(unit)}</span>
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
          <Detail label="Location" value={`${selectedUnit.lat.toFixed(6)}, ${selectedUnit.lon.toFixed(6)}`} />
        </dl>
      ) : (
        <p className="text-sm text-slate-600">No tracked unit selected.</p>
      );
    }

    if (activeQuickModal === 'call-detail') {
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

    if (activeQuickModal === 'map') {
      return <p className="text-sm text-slate-600">The live map is centered on the dashboard.</p>;
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
    <div className={`flex h-screen flex-col ${theme === 'dark' ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-100 text-cad-ink'}`}>
      <header className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-cad-navy px-4 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold">CAD Dispatch</h1>
            <p className="text-xs text-slate-300">Live unit location dashboard</p>
          </div>
        </div>

        <div className="relative">
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
            onClick={() => setSettingsOpen((value) => !value)}
            className="rounded-md border border-white/15 bg-white/10 p-2 transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label="Settings"
          >
            <Settings size={19} />
          </button>
          {settingsOpen && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-cad-line bg-white py-2 text-cad-ink shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
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
        </div>

        <button
          type="button"
          onClick={() => setSidebarOpen((value) => !value)}
          className="absolute left-0 top-1/2 z-20 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-cad-line bg-white/95 text-cad-blue shadow-xl backdrop-blur transition hover:bg-blue-50"
          aria-label={sidebarOpen ? 'Collapse units' : 'Open units'}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>

        <div
          className={`absolute bottom-24 left-4 top-20 z-10 flex w-[min(22rem,calc(100vw-2rem))] flex-col rounded-lg border border-cad-line bg-white/95 shadow-2xl backdrop-blur transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
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
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${statusStyles[displayStatus(unit)]}`}>
                      {displayStatus(unit)}
                    </span>
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
                <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">No active calls are in the queue.</p>
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
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{incident.callNumber} · {incident.type}</p>
                      <p className="mt-1 truncate text-xs text-slate-600">{incident.address}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${incidentPriorityStyles[incident.priority]}`}>
                      {incident.priority}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${incidentStatusStyles[incident.status]}`}>
                      {incident.status}
                    </span>
                    <span className="text-xs text-slate-500">{incident.units.length} units</span>
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
                  <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{selectedIncident.description}</p>
                )}
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Assigned Units</h3>
                  <div className="mt-2 space-y-2">
                    {selectedIncident.units.length === 0 && <p className="text-sm text-slate-600">No units assigned.</p>}
                    {selectedIncident.units.map((assignedUnit) => (
                      <div key={assignedUnit.userId} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                        <span className="font-semibold">{assignedUnit.cadUnitNumber || assignedUnit.name}</span>
                        <span>{assignedUnit.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <select
                    value={assignmentUnitId}
                    onChange={(event) => setAssignmentUnitId(event.target.value)}
                    className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="">Select unit</option>
                    {units.map((unit) => (
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
                  {(['Dispatched', 'En Route', 'On Scene', 'Closed'] as IncidentStatus[]).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => updateIncidentStatus(status)}
                      className="rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Create or select a call to manage assignments.</p>
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

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3">
        <div className="pointer-events-auto grid grid-cols-4 gap-2 rounded-xl border border-white/30 bg-cad-navy/95 p-2 shadow-2xl backdrop-blur md:grid-cols-8">
          {quickLaunchSlots.map((slot, index) => {
            const item = quickLaunchOptions.find((option) => option.id === slot);
            return (
              <div
                key={`quick-slot-${index}`}
                draggable
                onDragStart={() => setDraggedSlotIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => swapQuickLaunchSlots(index)}
                className="relative flex h-16 w-16 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white"
              >
                <GripVertical className="absolute left-1 top-1 text-white/45" size={12} />
                <button
                  type="button"
                  onClick={() => (item ? openQuickLaunch(item.id) : setCustomizingSlot(index))}
                  className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold hover:bg-white/10"
                  aria-label={item ? `Open ${item.label}` : `Customize slot ${index + 1}`}
                >
                  {item?.icon || <Settings size={18} />}
                  <span className="max-w-full truncate px-1">{item?.label || 'Empty'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomizingSlot(index)}
                  className="absolute right-1 top-1 rounded bg-white/10 p-1 text-white/70 hover:text-white"
                  aria-label={`Customize slot ${index + 1}`}
                >
                  <Settings size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {customizingSlot !== null && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg origin-bottom animate-[dockModalIn_220ms_ease-out] rounded-lg border border-cad-line bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-cad-line p-4">
              <h2 className="text-lg font-bold">Customize Slot {customizingSlot + 1}</h2>
              <button type="button" onClick={() => setCustomizingSlot(null)} className="rounded-md p-2 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {quickLaunchOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => assignQuickLaunchSlot(customizingSlot, option.id)}
                  className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-blue-50"
                >
                  <span className="text-cad-blue">{option.icon}</span>
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => assignQuickLaunchSlot(customizingSlot, null)}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-slate-50"
              >
                <X size={18} className="text-slate-500" />
                Empty
              </button>
            </div>
          </div>
        </div>
      )}

      {changePasswordOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-4">
          <div className="mb-20 w-full max-w-md origin-bottom animate-[dockModalIn_220ms_ease-out] rounded-lg border border-cad-line bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-cad-line p-4 dark:border-slate-700">
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
                className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((value) => ({ ...value, newPassword: event.target.value }))}
                placeholder="New password"
                className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((value) => ({ ...value, confirmPassword: event.target.value }))}
                placeholder="Confirm new password"
                className="rounded-md border border-cad-line px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950"
              />
              {passwordMessage && <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{passwordMessage}</p>}
              <button type="button" onClick={changePassword} className="rounded-md bg-cad-blue px-3 py-2 text-sm font-semibold text-white">
                Update Password
              </button>
            </div>
          </div>
        </div>
      )}

      {activeQuickModal && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-4">
          <div className="mb-20 w-full max-w-2xl origin-bottom animate-[dockModalIn_240ms_cubic-bezier(0.2,0.8,0.2,1)] rounded-lg border border-cad-line bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-cad-line p-4">
              <h2 className="text-lg font-bold">{quickModalTitle}</h2>
              <button type="button" onClick={() => setActiveQuickModal(null)} className="rounded-md p-2 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-4">{renderQuickModalContent()}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({
  icon,
  label,
  value
}) => (
  <div className="flex min-h-12 min-w-36 items-center justify-between rounded-md border border-cad-line bg-white/95 px-3 py-2 shadow-control backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-cad-blue">{icon}</span>
      <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
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
  <div className={`overflow-hidden rounded-lg border border-cad-line bg-white/95 shadow-2xl backdrop-blur transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${className}`}>
    <div className="flex items-center justify-between gap-3 border-b border-cad-line px-3 py-2 dark:border-slate-700">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold">{title}</h2>
        {subtitle && <p className="truncate text-xs text-slate-600">{subtitle}</p>}
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
    <dt className="font-semibold text-slate-500">{label}</dt>
    <dd className="font-medium text-cad-ink">{value}</dd>
  </div>
);

const FallbackMap: React.FC<{
  units: TrackedUnit[];
  incidents: Incident[];
  selectedUnit: TrackedUnit | null;
  currentLocation: { lat: number; lon: number } | null;
  currentUserId?: string;
  onSelectUnit: (unit: TrackedUnit) => void;
  onSelectIncident: (incident: Incident) => void;
}> = ({ units, incidents, selectedUnit, currentLocation, currentUserId, onSelectUnit, onSelectIncident }) => {
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
          <span
            className={`pointer-events-none absolute inset-0 -z-10 rounded-full ${
              markerPulseClass[markerTone(unit, currentUserId)]
            } location-pulse`}
          />
          <span
            className={`h-3 w-3 rounded-full ring-2 ${markerToneClass[markerTone(unit, currentUserId)]}`}
            aria-hidden="true"
          />
          {displayCadUnitNumber(unit)}
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
