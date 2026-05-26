import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {
  User,
  UserRole,
  AuthPayload,
  TokenPair,
  ROLE_PERMISSIONS,
  Permission
} from 'cad-shared';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-super-secret-refresh-token-key';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

// In-memory user store (replace with database in production)
const users = new Map<string, User & { passwordHash: string; refreshTokens: string[] }>();

// Initialize demo users
const initializeDemoUsers = () => {
  const adminHash = bcrypt.hashSync('admin123', 10);
  users.set('admin-1', {
    id: 'admin-1',
    email: 'admin@dispatch.local',
    name: 'Admin User',
    role: UserRole.ADMIN,
    badge: 'ADM001',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: adminHash,
    refreshTokens: []
  });

  const dispatcherHash = bcrypt.hashSync('dispatcher123', 10);
  users.set('dispatcher-1', {
    id: 'dispatcher-1',
    email: 'dispatcher@dispatch.local',
    name: 'Dispatcher User',
    role: UserRole.DISPATCHER,
    badge: 'DIS001',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: dispatcherHash,
    refreshTokens: []
  });

  const officerHash = bcrypt.hashSync('officer123', 10);
  users.set('officer-1', {
    id: 'officer-1',
    email: 'officer@dispatch.local',
    name: 'Officer User',
    role: UserRole.OFFICER,
    badge: 'OF001',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: officerHash,
    refreshTokens: []
  });
};

initializeDemoUsers();

export class AuthService {
  static generateTokens(user: User): TokenPair {
    const payload: AuthPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role] as Permission[]
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY
    });

    const refreshToken = jwt.sign(
      { id: user.id, email: user.email },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // Store refresh token
    const userData = users.get(user.id);
    if (userData) {
      userData.refreshTokens.push(refreshToken);
    }

    return { accessToken, refreshToken };
  }

  static verifyRefreshToken(token: string): { id: string; email: string } | null {
    try {
      return jwt.verify(token, REFRESH_TOKEN_SECRET) as { id: string; email: string };
    } catch {
      return null;
    }
  }

  static revokeRefreshToken(userId: string, token: string): void {
    const user = users.get(userId);
    if (user) {
      user.refreshTokens = user.refreshTokens.filter((t: string) => t !== token);
    }
  }

  static async authenticateUser(email: string, password: string): Promise<User | null> {
    for (const user of users.values()) {
      if (user.email === email && bcrypt.compareSync(password, user.passwordHash)) {
        const { passwordHash, refreshTokens, ...userWithoutSensitive } = user;
        return userWithoutSensitive;
      }
    }
    return null;
  }

  static createUser(email: string, name: string, role: UserRole, password: string): User {
    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    
    users.set(userId, {
      id: userId,
      email,
      name,
      role,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash,
      refreshTokens: []
    });

    return {
      id: userId,
      email,
      name,
      role,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  static getUser(id: string): User | null {
    const user = users.get(id);
    if (!user) return null;
    const { passwordHash, refreshTokens, ...userWithoutSensitive } = user;
    return userWithoutSensitive;
  }

  static getUserByEmail(email: string): User | null {
    for (const user of users.values()) {
      if (user.email === email) {
        const { passwordHash, refreshTokens, ...userWithoutSensitive } = user;
        return userWithoutSensitive;
      }
    }
    return null;
  }
}
