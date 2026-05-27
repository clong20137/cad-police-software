import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { ResultSetHeader } from 'mysql2';
import { securityConfig } from '../config/security';
import { pool, UserRow } from '../db/mysql';
import {
  AuthPayload,
  Permission,
  ROLE_PERMISSIONS,
  ResetUserPasswordRequest,
  TokenPair,
  UnitStatus,
  UpdateUserRequest,
  User,
  UserRole
} from '../types/auth';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_DAYS = 7;
const BCRYPT_ROUNDS = 12;
const TRACKED_UNIT_RETENTION_MINUTES = 30;

const tokenHash = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role as UserRole,
  badge: row.badge || undefined,
  unitNumber: row.unit_number || undefined,
  cadUnitNumber: row.cad_unit_number || undefined,
  status: (row.status as UnitStatus | null) || 'Available',
  group: row.unit_group || undefined,
  district: row.district || undefined,
  lat: row.lat === null ? undefined : Number(row.lat),
  lon: row.lon === null ? undefined : Number(row.lon),
  speedMph: row.speed_mph === null ? undefined : Number(row.speed_mph),
  destinationLat: row.destination_lat === null ? undefined : Number(row.destination_lat),
  destinationLon: row.destination_lon === null ? undefined : Number(row.destination_lon),
  destinationLabel: row.destination_label || undefined,
  lastLocationAt: row.last_location_at || undefined,
  lastSeenAt: row.last_seen_at || undefined,
  active: Boolean(row.active),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const allowedRegistrationRoles = new Set<UserRole>([
  UserRole.DISPATCHER,
  UserRole.OFFICER,
  UserRole.VIEWER
]);

export class AuthService {
  static async generateTokens(user: User): Promise<TokenPair> {
    const payload: AuthPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role] as Permission[]
    };

    const accessToken = jwt.sign(payload, securityConfig.jwtSecret, {
      expiresIn: ACCESS_TOKEN_EXPIRY
    });

    const refreshToken = jwt.sign(
      { id: user.id, email: user.email },
      securityConfig.refreshTokenSecret,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    await pool.execute(
      `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))
      `,
      [user.id, tokenHash(refreshToken), REFRESH_TOKEN_DAYS]
    );

    return { accessToken, refreshToken };
  }

  static async verifyRefreshToken(token: string): Promise<{ id: string; email: string } | null> {
    try {
      const payload = jwt.verify(token, securityConfig.refreshTokenSecret) as {
        id: string;
        email: string;
      };

      const [rows] = await pool.execute<UserRow[]>(
        `
          SELECT users.*
          FROM refresh_tokens
          INNER JOIN users ON users.id = refresh_tokens.user_id
          WHERE refresh_tokens.token_hash = ?
            AND refresh_tokens.revoked_at IS NULL
            AND refresh_tokens.expires_at > UTC_TIMESTAMP()
            AND users.active = TRUE
          LIMIT 1
        `,
        [tokenHash(token)]
      );

      if (!rows[0] || rows[0].id !== payload.id) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  static async revokeRefreshToken(userId: string, token: string): Promise<void> {
    await pool.execute(
      `
        UPDATE refresh_tokens
        SET revoked_at = UTC_TIMESTAMP()
        WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL
      `,
      [userId, tokenHash(token)]
    );
  }

  static async authenticateUser(email: string, password: string): Promise<User | null> {
    const user = await this.getUserWithPasswordByEmail(email);
    if (!user || !user.active) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    return passwordMatches ? toUser(user) : null;
  }

  static async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const [rows] = await pool.execute<UserRow[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows[0];
    if (!user || !user.active) {
      return false;
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatches) {
      return false;
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    await pool.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [
      userId
    ]);
    return true;
  }

  static async createUser(
    email: string,
    name: string,
    role: UserRole,
    password: string,
    badge?: string,
    unitNumber?: string,
    cadUnitNumber?: string,
    status?: UnitStatus,
    group?: string,
    district?: string
  ): Promise<User> {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = name.trim();
    const normalizedBadge = badge?.trim() || null;
    const normalizedUnitNumber = unitNumber?.trim() || normalizedBadge;
    const normalizedCadUnitNumber =
      cadUnitNumber?.trim() || (normalizedUnitNumber ? `CAD-${normalizedUnitNumber}` : null);
    const normalizedGroup = group?.trim() || null;
    const normalizedDistrict = district?.trim() || null;
    const safeRole = allowedRegistrationRoles.has(role) ? role : UserRole.VIEWER;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    await pool.execute<ResultSetHeader>(
      `
        INSERT INTO users (
          id,
          email,
          name,
          role,
          badge,
          unit_number,
          cad_unit_number,
          status,
          unit_group,
          district,
          password_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        normalizedEmail,
        normalizedName,
        safeRole,
        normalizedBadge,
        normalizedUnitNumber,
        normalizedCadUnitNumber,
        status || null,
        normalizedGroup,
        normalizedDistrict,
        passwordHash
      ]
    );

    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('User was not created.');
    }

    return user;
  }

  static async getUser(id: string): Promise<User | null> {
    const [rows] = await pool.execute<UserRow[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  static async getUserByEmail(email: string): Promise<User | null> {
    const user = await this.getUserWithPasswordByEmail(email);
    return user ? toUser(user) : null;
  }

  static async getUsers(): Promise<User[]> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT 200'
    );
    return rows.map(toUser);
  }

  static async updateUser(userId: string, input: UpdateUserRequest): Promise<User | null> {
    const existingUser = await this.getUser(userId);
    if (!existingUser) {
      return null;
    }

    const nextRole = input.role && Object.values(UserRole).includes(input.role) ? input.role : existingUser.role;
    await pool.execute(
      `
        UPDATE users
        SET name = ?,
            role = ?,
            badge = ?,
            unit_number = ?,
            cad_unit_number = ?,
            status = ?,
            unit_group = ?,
            district = ?,
            active = ?
        WHERE id = ?
      `,
      [
        input.name?.trim() || existingUser.name,
        nextRole,
        input.badge === undefined ? existingUser.badge || null : input.badge?.trim() || null,
        input.unitNumber === undefined ? existingUser.unitNumber || null : input.unitNumber?.trim() || null,
        input.cadUnitNumber === undefined ? existingUser.cadUnitNumber || null : input.cadUnitNumber?.trim() || null,
        input.status === undefined ? existingUser.status || null : input.status,
        input.group === undefined ? existingUser.group || null : input.group?.trim() || null,
        input.district === undefined ? existingUser.district || null : input.district?.trim() || null,
        input.active === undefined ? existingUser.active : input.active,
        userId
      ]
    );

    if (input.active === false) {
      await pool.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [
        userId
      ]);
    }

    return this.getUser(userId);
  }

  static async resetUserPassword(userId: string, input: ResetUserPasswordRequest): Promise<boolean> {
    if (!input.newPassword || input.newPassword.length < 8) {
      return false;
    }

    const user = await this.getUser(userId);
    if (!user) {
      return false;
    }

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    await pool.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [
      userId
    ]);
    return true;
  }

  static async touchLastSeen(userId: string): Promise<void> {
    await pool.execute('UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [userId]);
  }

  static async getTrackedUnits(): Promise<User[]> {
    const [rows] = await pool.execute<UserRow[]>(
      `
        SELECT *
        FROM users
        WHERE active = TRUE
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND last_location_at IS NOT NULL
          AND last_location_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
        ORDER BY last_location_at DESC, updated_at DESC
      `,
      [TRACKED_UNIT_RETENTION_MINUTES]
    );
    return rows.map(toUser);
  }

  static async clearExpiredTrackedUnits(): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `
        UPDATE users
        SET lat = NULL,
            lon = NULL,
            speed_mph = NULL,
            destination_lat = NULL,
            destination_lon = NULL,
            destination_label = NULL
        WHERE lat IS NOT NULL
          AND lon IS NOT NULL
          AND (
            last_location_at IS NULL
            OR last_location_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
          )
      `,
      [TRACKED_UNIT_RETENTION_MINUTES]
    );
    return result.affectedRows;
  }

  static async updateLocation(
    userId: string,
    lat: number,
    lon: number,
    speedMph?: number | null
  ): Promise<User | null> {
    await pool.execute(
      `
        UPDATE users
        SET lat = ?, lon = ?, speed_mph = ?, last_location_at = UTC_TIMESTAMP()
        WHERE id = ? AND active = TRUE
      `,
      [lat, lon, speedMph ?? null, userId]
    );
    return this.getUser(userId);
  }

  static async updateDestination(
    userId: string,
    destinationLat: number | null,
    destinationLon: number | null,
    destinationLabel?: string | null
  ): Promise<User | null> {
    await pool.execute(
      `
        UPDATE users
        SET destination_lat = ?, destination_lon = ?, destination_label = ?
        WHERE id = ? AND active = TRUE
      `,
      [
        destinationLat,
        destinationLon,
        destinationLabel?.trim() || null,
        userId
      ]
    );
    return this.getUser(userId);
  }

  private static async getUserWithPasswordByEmail(email: string): Promise<UserRow | null> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [normalizeEmail(email)]
    );
    return rows[0] || null;
  }
}
