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
  TokenPair,
  User,
  UserRole
} from '../types/auth';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_DAYS = 7;
const BCRYPT_ROUNDS = 12;

const tokenHash = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role as UserRole,
  badge: row.badge || undefined,
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

  static async createUser(
    email: string,
    name: string,
    role: UserRole,
    password: string,
    badge?: string
  ): Promise<User> {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = name.trim();
    const normalizedBadge = badge?.trim() || null;
    const safeRole = allowedRegistrationRoles.has(role) ? role : UserRole.VIEWER;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    await pool.execute<ResultSetHeader>(
      `
        INSERT INTO users (id, email, name, role, badge, password_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userId, normalizedEmail, normalizedName, safeRole, normalizedBadge, passwordHash]
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

  private static async getUserWithPasswordByEmail(email: string): Promise<UserRow | null> {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [normalizeEmail(email)]
    );
    return rows[0] || null;
  }
}
