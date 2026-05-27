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
  destinationLat?: number;
  destinationLon?: number;
  destinationLabel?: string;
  lastLocationAt?: Date;
  lastSeenAt?: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UnitStatus =
  | 'Available'
  | 'Dispatched'
  | 'En Route'
  | 'On Scene'
  | 'Transporting'
  | 'Traffic Stop';

export interface AuthPayload {
  id: string;
  email: string;
  role: UserRole;
  permissions: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
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

export interface LocationUpdateRequest {
  lat: number;
  lon: number;
  speedMph?: number | null;
}

export interface DestinationUpdateRequest {
  destinationLat: number | null;
  destinationLon: number | null;
  destinationLabel?: string | null;
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
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface SendMessageRequest {
  recipientId: string;
  body: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    dataUrl: string;
  }>;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AuditLogEntry {
  id: string;
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  severity: AuditSeverity;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type IncidentPriority = 'Low' | 'Normal' | 'High' | 'Emergency';
export type IncidentStatus = 'Pending' | 'Dispatched' | 'En Route' | 'On Scene' | 'Closed' | 'Canceled';
export type IncidentUnitStatus = 'Assigned' | 'En Route' | 'On Scene' | 'Cleared';

export interface IncidentUnit {
  userId: string;
  name: string;
  cadUnitNumber?: string;
  status: IncidentUnitStatus;
  assignedAt: Date;
  clearedAt?: Date;
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
  lat?: number;
  lon?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  units: IncidentUnit[];
}

export interface CreateIncidentRequest {
  type: string;
  priority?: IncidentPriority;
  address: string;
  description?: string;
  callerName?: string;
  callerPhone?: string;
  lat?: number | null;
  lon?: number | null;
}

export interface UpdateIncidentStatusRequest {
  status: IncidentStatus;
}

export interface AssignIncidentUnitRequest {
  userId: string;
  status?: IncidentUnitStatus;
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

export interface RefreshTokenRequest {
  refreshToken: string;
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
