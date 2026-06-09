export enum UserRole {
  ADMIN = 'admin',
  DISPATCHER = 'dispatcher',
  OFFICER = 'officer',
  VIEWER = 'viewer'
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  badge?: string;
  unitNumber?: string;
  cadUnitNumber?: string;
  status?: UnitStatus;
  group?: string;
  district?: string;
  lat?: number;
  lon?: number;
  speedMph?: number;
  locationTrail?: LocationTrailPoint[];
  destinationLat?: number;
  destinationLon?: number;
  destinationLabel?: string;
  lastLocationAt?: Date;
  lastSeenAt?: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocationTrailPoint {
  lat: number;
  lon: number;
  speedMph?: number;
  recordedAt: Date;
}

export type UnitStatus =
  | 'Available'
  | 'Dispatched'
  | 'En Route'
  | 'On Scene'
  | 'Transporting'
  | 'Traffic Stop';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  success: boolean;
  user: User;
  tokens: TokenPair;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  badge?: string;
  unitNumber?: string;
  cadUnitNumber?: string;
  status?: UnitStatus;
  group?: string;
  district?: string;
}

export interface RegisterResponse {
  success: boolean;
  user: User;
  tokens: TokenPair;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  encrypted: boolean;
  attachments: MessageAttachment[];
  readAt?: Date;
  createdAt: Date;
  senderReaction?: string | null;
  recipientReaction?: string | null;
  deliveryStatus?: 'sending' | 'sent' | 'failed' | 'read';
}

export interface MessageThread {
  userId: string;
  lastMessage?: ChatMessage;
  unreadCount: number;
  updatedAt?: Date;
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface SendMessageAttachment {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export type IncidentPriority = 'Low' | 'Normal' | 'High' | 'Emergency';
export type IncidentStatus = 'Pending' | 'Dispatched' | 'En Route' | 'On Scene' | 'Closed' | 'Canceled';
export type IncidentUnitStatus =
  | 'Assigned'
  | 'Acknowledged'
  | 'En Route'
  | 'On Scene'
  | 'Transporting'
  | 'At Hospital'
  | 'Staged'
  | 'Loaded'
  | 'Delivered'
  | 'Cleared';

export interface IncidentUnit {
  userId: string;
  name: string;
  cadUnitNumber?: string;
  status: IncidentUnitStatus;
  assignedAt: Date;
  statusUpdatedAt?: Date;
  clearedAt?: Date;
}

export interface IncidentNote {
  id: string;
  incidentId: string;
  userId?: string;
  userName?: string;
  noteType: 'note' | 'status' | 'assignment' | 'disposition';
  body: string;
  createdAt: Date;
}

export interface Incident {
  id: string;
  callNumber: string;
  type: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  address: string;
  description?: string;
  callerName?: string;
  callerPhone?: string;
  district?: string;
  beat?: string;
  lat?: number;
  lon?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  disposition?: string;
  units: IncidentUnit[];
  notes: IncidentNote[];
}

export interface CreateIncidentRequest {
  type: string;
  priority?: IncidentPriority;
  address: string;
  description?: string;
  callerName?: string;
  callerPhone?: string;
  district?: string | null;
  beat?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface OfficerEventRequest {
  type: string;
  priority?: IncidentPriority;
  address?: string;
  description?: string;
  district?: string | null;
  beat?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface AddIncidentNoteRequest {
  body: string;
  noteType?: IncidentNote['noteType'];
}

export interface UpdateIncidentStatusRequest {
  status: IncidentStatus;
  disposition?: string;
}

export interface UpdateUserRequest {
  name?: string;
  role?: UserRole;
  badge?: string | null;
  unitNumber?: string | null;
  cadUnitNumber?: string | null;
  status?: UnitStatus | null;
  group?: string | null;
  district?: string | null;
  active?: boolean;
}

export interface ResetUserPasswordRequest {
  newPassword: string;
}

export type AdminConfigSection = 'agencies' | 'districts' | 'units' | 'calls' | 'statuses' | 'security';

export interface AdminConfigurationItem {
  id: string;
  section: AdminConfigSection;
  name: string;
  code: string;
  agency: string;
  category: string;
  active: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertConfigurationItemRequest {
  section?: AdminConfigSection;
  name?: string;
  code?: string;
  agency?: string;
  category?: string;
  active?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
}

export interface PublicAuthSettings {
  registrationEnabled: boolean;
}

export type Permission =
  | 'view_dispatch'
  | 'create_dispatch'
  | 'update_dispatch'
  | 'delete_dispatch'
  | 'view_officers'
  | 'update_officers'
  | 'manage_users'
  | 'view_reports'
  | 'manage_system';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [
    'view_dispatch',
    'create_dispatch',
    'update_dispatch',
    'delete_dispatch',
    'view_officers',
    'update_officers',
    'manage_users',
    'view_reports',
    'manage_system'
  ],
  [UserRole.DISPATCHER]: [
    'view_dispatch',
    'create_dispatch',
    'update_dispatch',
    'view_officers',
    'view_reports'
  ],
  [UserRole.OFFICER]: ['view_dispatch', 'view_officers'],
  [UserRole.VIEWER]: ['view_dispatch', 'view_officers']
};
