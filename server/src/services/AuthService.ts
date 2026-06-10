import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { ResultSetHeader } from 'mysql2';
import { securityConfig } from '../config/security';
import { pool, LocationHistoryRow, PasswordHistoryRow, UserRow } from '../db/mysql';
import {
  AuthPayload,
  Permission,
  ROLE_PERMISSIONS,
  ResetUserPasswordRequest,
  TokenPair,
  UnitStatus,
  UpdateUserRequest,
  User,
  UserRole,
  LocationTrailPoint
} from '../types/auth';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_DAYS = 7;
const BCRYPT_ROUNDS = 12;
const TRACKED_UNIT_RETENTION_MINUTES = 30;
const LOCATION_TRAIL_MINUTES = 60;
const LOCATION_TRAIL_LIMIT = 80;
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'qwerty123',
  'admin123',
  'changeme',
  'letmein',
  'welcome1'
]);

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
  twoFactorEnabled: Boolean(row.two_factor_enabled),
  active: Boolean(row.active),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const toTrailPoint = (row: LocationHistoryRow): LocationTrailPoint => ({
  lat: Number(row.lat),
  lon: Number(row.lon),
  speedMph: row.speed_mph === null ? undefined : Number(row.speed_mph),
  recordedAt: row.recorded_at
});

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const allowedRegistrationRoles = new Set<UserRole>([
  UserRole.DISPATCHER,
  UserRole.OFFICER,
  UserRole.VIEWER
]);

const normalizePasswordSearchText = (value?: string | null): string =>
  (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const generateBase32Secret = (): string => {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  bytes.forEach((byte) => {
    bits += byte.toString(2).padStart(8, '0');
  });
  return bits.match(/.{1,5}/g)?.map((chunk) => base32Alphabet[parseInt(chunk.padEnd(5, '0'), 2)]).join('') || '';
};

const base32ToBuffer = (secret: string): Buffer => {
  const clean = secret.replace(/=+$/u, '').replace(/\s+/gu, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const value = base32Alphabet.indexOf(char);
    if (value >= 0) bits += value.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g)?.map((byte) => parseInt(byte, 2)) || [];
  return Buffer.from(bytes);
};

const totpCode = (secret: string, step = Math.floor(Date.now() / 30000)): string => {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = crypto.createHmac('sha1', base32ToBuffer(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
};

const verifyTotp = (secret: string, code: string): boolean => {
  const clean = code.replace(/\s+/gu, '');
  const currentStep = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((offset) => totpCode(secret, currentStep + offset) === clean);
};

const backupCodeHash = (code: string): string => crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

const generateBackupCodes = (): string[] =>
  Array.from({ length: 10 }, () => crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/u, '$1-'));

type TwoFactorSetup = {
  challengeToken: string;
  secret: string;
  otpauthUrl: string;
};

export class AuthService {
  private static setupToken(userId: string, secret: string): string {
    return jwt.sign({ id: userId, purpose: '2fa_setup', secret }, securityConfig.jwtSecret, { expiresIn: '10m' });
  }

  private static challengeToken(userId: string): string {
    return jwt.sign({ id: userId, purpose: '2fa_challenge' }, securityConfig.jwtSecret, { expiresIn: '10m' });
  }

  private static otpauthUrl(user: User, secret: string): string {
    const issuer = 'Blueline CAD';
    const issuerParam = encodeURIComponent(issuer);
    const label = encodeURIComponent(`${issuer}:${user.email}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuerParam}&algorithm=SHA1&digits=6&period=30`;
  }

  static createTwoFactorSetup(user: User): TwoFactorSetup {
    const secret = generateBase32Secret();
    return {
      challengeToken: this.setupToken(user.id, secret),
      secret,
      otpauthUrl: this.otpauthUrl(user, secret)
    };
  }

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

    if (this.isPasswordExpired(user.password_changed_at)) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    return passwordMatches ? toUser(user) : null;
  }

  static async beginLogin(email: string, password: string, twoFactorCode?: string): Promise<
    | { type: 'success'; user: User }
    | { type: 'setup'; user: User; challengeToken: string; secret: string; otpauthUrl: string }
    | { type: 'challenge'; challengeToken: string }
    | null
  > {
    const userRow = await this.getUserWithPasswordByEmail(email);
    if (!userRow || !userRow.active || this.isPasswordExpired(userRow.password_changed_at)) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, userRow.password_hash);
    if (!passwordMatches) {
      return null;
    }

    const user = toUser(userRow);
    if (!userRow.two_factor_enabled || !userRow.two_factor_secret) {
      const setup = this.createTwoFactorSetup(user);
      return {
        type: 'setup',
        user,
        ...setup
      };
    }

    if (!twoFactorCode) {
      return { type: 'challenge', challengeToken: this.challengeToken(user.id) };
    }

    const verified = await this.verifyTwoFactorCode(userRow, twoFactorCode);
    return verified ? { type: 'success', user } : null;
  }

  static async completeTwoFactorSetup(challengeToken: string, code: string): Promise<{ user: User; backupCodes: string[] } | null> {
    try {
      const payload = jwt.verify(challengeToken, securityConfig.jwtSecret) as { id: string; purpose: string; secret: string };
      if (payload.purpose !== '2fa_setup' || !payload.secret || !verifyTotp(payload.secret, code)) {
        return null;
      }
      const backupCodes = generateBackupCodes();
      await pool.execute(
        'UPDATE users SET two_factor_secret = ?, two_factor_enabled = TRUE, two_factor_recovery_codes = ? WHERE id = ? AND active = TRUE',
        [payload.secret, JSON.stringify(backupCodes.map(backupCodeHash)), payload.id]
      );
      const user = await this.getUser(payload.id);
      return user ? { user, backupCodes } : null;
    } catch {
      return null;
    }
  }

  static async completeTwoFactorChallenge(challengeToken: string, code: string): Promise<User | null> {
    try {
      const payload = jwt.verify(challengeToken, securityConfig.jwtSecret) as { id: string; purpose: string };
      if (payload.purpose !== '2fa_challenge') return null;
      const [rows] = await pool.execute<UserRow[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [payload.id]);
      const userRow = rows[0];
      if (!userRow || !userRow.active || !(await this.verifyTwoFactorCode(userRow, code))) return null;
      return toUser(userRow);
    } catch {
      return null;
    }
  }

  private static async verifyTwoFactorCode(user: UserRow, code: string): Promise<boolean> {
    if (user.two_factor_secret && verifyTotp(user.two_factor_secret, code)) {
      return true;
    }
    const cleanHash = backupCodeHash(code);
    const storedCodes = typeof user.two_factor_recovery_codes === 'string'
      ? JSON.parse(user.two_factor_recovery_codes || '[]') as string[]
      : Array.isArray(user.two_factor_recovery_codes)
        ? user.two_factor_recovery_codes as string[]
        : [];
    if (!storedCodes.includes(cleanHash)) return false;
    await pool.execute('UPDATE users SET two_factor_recovery_codes = ? WHERE id = ?', [
      JSON.stringify(storedCodes.filter((item) => item !== cleanHash)),
      user.id
    ]);
    return true;
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

    this.assertPasswordPolicy(newPassword, user);
    await this.assertPasswordNotReused(userId, newPassword, user.password_hash);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.execute('UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?', [
      passwordHash,
      userId
    ]);
    await this.rememberPassword(userId, passwordHash);
    await pool.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [
      userId
    ]);
    return true;
  }

  static async verifyPassword(userId: string, password: string): Promise<boolean> {
    const [rows] = await pool.execute<UserRow[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows[0];
    if (!user || !user.active || !password || this.isPasswordExpired(user.password_changed_at)) {
      return false;
    }

    return bcrypt.compare(password, user.password_hash);
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
    this.assertPasswordPolicy(password, {
      email: normalizedEmail,
      name: normalizedName,
      id: ''
    });
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
    await this.rememberPassword(userId, passwordHash);

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
    const users = rows.map(toUser);
    return this.withLocationTrails(users);
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
    if (!input.newPassword) {
      return false;
    }

    const [rows] = await pool.execute<UserRow[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows[0];
    if (!user) {
      return false;
    }

    this.assertPasswordPolicy(input.newPassword, user);
    await this.assertPasswordNotReused(userId, input.newPassword, user.password_hash);

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await pool.execute('UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?', [
      passwordHash,
      userId
    ]);
    await this.rememberPassword(userId, passwordHash);
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
    await pool.execute(
      `
        INSERT INTO user_location_history (user_id, lat, lon, speed_mph)
        VALUES (?, ?, ?, ?)
      `,
      [userId, lat, lon, speedMph ?? null]
    );
    await pool.execute(
      `
        DELETE FROM user_location_history
        WHERE recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
      `,
      [LOCATION_TRAIL_MINUTES]
    );
    return this.getUser(userId);
  }

  private static async withLocationTrails(users: User[]): Promise<User[]> {
    if (users.length === 0) return users;

    const userIds = users.map((user) => user.id);
    const placeholders = userIds.map(() => '?').join(',');
    const [rows] = await pool.execute<LocationHistoryRow[]>(
      `
        SELECT *
        FROM (
          SELECT
            user_location_history.*,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY recorded_at DESC) AS row_num
          FROM user_location_history
          WHERE user_id IN (${placeholders})
            AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
        ) recent_locations
        WHERE row_num <= ?
        ORDER BY user_id ASC, recorded_at ASC
      `,
      [...userIds, LOCATION_TRAIL_MINUTES, LOCATION_TRAIL_LIMIT]
    );

    const trailsByUser = rows.reduce<Record<string, LocationTrailPoint[]>>((groups, row) => {
      groups[row.user_id] = groups[row.user_id] || [];
      groups[row.user_id].push(toTrailPoint(row));
      return groups;
    }, {});

    return users.map((user) => ({ ...user, locationTrail: trailsByUser[user.id] || [] }));
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

  private static isPasswordExpired(changedAt: Date | null): boolean {
    if (!securityConfig.passwordPolicy.maxAgeDays || !changedAt) {
      return false;
    }

    const maxAgeMs = securityConfig.passwordPolicy.maxAgeDays * 24 * 60 * 60 * 1000;
    return Date.now() - new Date(changedAt).getTime() > maxAgeMs;
  }

  private static assertPasswordPolicy(password: string, user: Pick<UserRow, 'email' | 'name' | 'id'>): void {
    const policy = securityConfig.passwordPolicy;
    const lowerPassword = password.toLowerCase();
    const searchablePassword = normalizePasswordSearchText(password);
    const searchableEmail = normalizePasswordSearchText(user.email?.split('@')[0]);
    const searchableName = normalizePasswordSearchText(user.name);

    if (password.length < policy.minLength) {
      throw new Error(`Password must be at least ${policy.minLength} characters.`);
    }

    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      throw new Error('Password must include uppercase, lowercase, number, and symbol characters.');
    }

    if (COMMON_PASSWORDS.has(lowerPassword) || /(.)\1{3,}/.test(password)) {
      throw new Error('Password is too easy to guess.');
    }

    if (
      searchableEmail.length >= 4 &&
      searchablePassword.includes(searchableEmail)
    ) {
      throw new Error('Password cannot contain your email name.');
    }

    if (searchableName.length >= 4 && searchablePassword.includes(searchableName)) {
      throw new Error('Password cannot contain your name.');
    }
  }

  private static async assertPasswordNotReused(
    userId: string,
    newPassword: string,
    currentHash: string
  ): Promise<void> {
    const recentHashes = [currentHash];
    const [rows] = await pool.execute<PasswordHistoryRow[]>(
      `
        SELECT password_hash
        FROM password_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [userId, securityConfig.passwordPolicy.historyCount]
    );

    recentHashes.push(...rows.map((row) => row.password_hash));
    for (const hash of recentHashes) {
      if (await bcrypt.compare(newPassword, hash)) {
        throw new Error('Password was used recently. Choose a new password.');
      }
    }
  }

  private static async rememberPassword(userId: string, passwordHash: string): Promise<void> {
    await pool.execute('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)', [userId, passwordHash]);
    await pool.execute(
      `
        DELETE FROM password_history
        WHERE user_id = ?
          AND id NOT IN (
            SELECT id FROM (
              SELECT id
              FROM password_history
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT ?
            ) recent_passwords
          )
      `,
      [userId, userId, securityConfig.passwordPolicy.historyCount]
    );
  }
}
