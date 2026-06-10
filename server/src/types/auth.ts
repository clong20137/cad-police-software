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
  twoFactorEnabled: boolean;
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
  twoFactorCode?: string;
}

export interface TwoFactorChallengeResponse {
  success: false;
  twoFactorRequired: true;
  setupRequired: boolean;
  challengeToken: string;
  setup?: {
    secret: string;
    otpauthUrl: string;
  };
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

export interface VerifyPasswordRequest {
  password: string;
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
  statusUpdatedAt?: Date;
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

export interface UpdateIncidentStatusRequest {
  status: IncidentStatus;
  disposition?: string;
}

export interface AssignIncidentUnitRequest {
  userId: string;
  status?: IncidentUnitStatus;
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

export type BmvInquiryKind = 'driver-license' | 'vehicle-registration';
export type BmvInquiryStatus = 'not_configured' | 'submitted' | 'error';

export interface BmvInquiryRequest {
  kind: BmvInquiryKind;
  reason: string;
  officerId?: string;
  driver?: {
    name: string;
    dob: string;
    sex: string;
    state: string;
    imageRequested: boolean;
  };
  vehicle?: {
    plate?: string;
    vin?: string;
    year?: string;
    state: string;
    avq?: string;
  };
}

export interface BmvInquiryResponse {
  id: string;
  status: BmvInquiryStatus;
  source: 'BMV';
  message: string;
  requestedAt: Date;
  record?: Record<string, unknown>;
}

export type IdacsInquiryKind = 'driver-license' | 'vehicle-registration';
export type IdacsInquiryStatus = 'not_configured' | 'submitted' | 'error';

export interface IdacsInquiryRequest {
  kind: IdacsInquiryKind;
  reason: string;
  officerId?: string;
  driver?: {
    name: string;
    dob: string;
    sex: string;
    state: string;
    imageRequested: boolean;
  };
  vehicle?: {
    plate?: string;
    vin?: string;
    year?: string;
    state: string;
    avq?: string;
  };
}

export interface IdacsInquiryResponse {
  id: string;
  status: IdacsInquiryStatus;
  source: 'IDACS';
  message: string;
  requestedAt: Date;
  record?: Record<string, unknown>;
}

export interface IntegrationStatus {
  code: 'BMV' | 'IDACS' | 'COURTS';
  label: string;
  enabled: boolean;
  configured: boolean;
  message: string;
}

export interface CourtLookupAuditRequest {
  mode: 'protective-orders' | 'mycase';
  reason: string;
  name?: string;
  dob?: string;
  caseNumber?: string;
  sourceUrl: string;
}

export type UrgentAlertSeverity = 'Advisory' | 'Important' | 'Urgent' | 'Critical';
export type UrgentAlertAudienceType = 'everyone' | 'district' | 'users';

export interface UrgentAlert {
  id: string;
  title: string;
  message: string;
  severity: UrgentAlertSeverity;
  audienceType: UrgentAlertAudienceType;
  audienceLabel?: string;
  targetDistrict?: string;
  targetUserIds: string[];
  requireAcknowledgement: boolean;
  expiresAt?: Date;
  createdBy?: string;
  createdByName?: string;
  createdAt: Date;
  acknowledgedAt?: Date;
  deliveredAt?: Date;
  recipientCount?: number;
  acknowledgedCount?: number;
}

export interface CreateUrgentAlertRequest {
  title: string;
  message: string;
  severity?: UrgentAlertSeverity;
  audienceType?: UrgentAlertAudienceType;
  targetDistrict?: string | null;
  targetUserIds?: string[];
  requireAcknowledgement?: boolean;
  expiresAt?: string | null;
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

export interface TwoFactorVerifyRequest {
  challengeToken: string;
  code: string;
}

export type Permission =
  | 'view_dispatch'
  | 'create_dispatch'
  | 'update_dispatch'
  | 'delete_dispatch'
  | 'query_bmv'
  | 'query_idacs'
  | 'query_courts'
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
    'query_bmv',
    'query_idacs',
    'query_courts',
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
    'query_bmv',
    'query_idacs',
    'query_courts',
    'view_officers',
    'view_reports'
  ],
  [UserRole.OFFICER]: ['view_dispatch', 'query_bmv', 'query_idacs', 'query_courts', 'view_officers'],
  [UserRole.VIEWER]: ['view_dispatch', 'view_officers']
};
