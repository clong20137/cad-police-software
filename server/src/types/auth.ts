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
