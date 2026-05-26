import { Router, Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { LoginRequest, RefreshTokenRequest, RegisterRequest, UserRole } from '../types/auth';

const router = Router();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;

const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }

  attempt.count += 1;
  return attempt.count > MAX_LOGIN_ATTEMPTS;
};

// Public routes
router.post('/register', async (req: Request<{}, {}, RegisterRequest>, res: Response): Promise<void> => {
  try {
    const { email, password, name, role = UserRole.VIEWER, badge } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const existingUser = await AuthService.getUserByEmail(email);
    if (existingUser) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const user = await AuthService.createUser(email, name, role, password, badge);
    const tokens = await AuthService.generateTokens(user);
    res.status(201).json({ success: true, user, tokens });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const rateLimitKey = `${req.ip}:${email || 'unknown'}`;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    if (isRateLimited(rateLimitKey)) {
      res.status(429).json({ error: 'Too many login attempts. Try again later.' });
      return;
    }

    const user = await AuthService.authenticateUser(email, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const tokens = await AuthService.generateTokens(user);
    res.json({ success: true, user, tokens });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', async (req: Request<{}, {}, RefreshTokenRequest>, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    const payload = await AuthService.verifyRefreshToken(refreshToken);
    if (!payload) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const user = await AuthService.getUser(payload.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Revoke old refresh token and generate new pair
    await AuthService.revokeRefreshToken(user.id, refreshToken);
    const newTokens = await AuthService.generateTokens(user);

    res.json({ success: true, tokens: newTokens });
  } catch (error) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Protected routes
router.post('/logout', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.user) {
    const refreshToken = req.body?.refreshToken;
    if (typeof refreshToken === 'string') {
      await AuthService.revokeRefreshToken(req.user.id, refreshToken);
    }
    res.json({ success: true, message: 'Logged out' });
  }
});

router.get(
  '/me',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const user = await AuthService.getUser(req.user?.id || '');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  }
);

// Admin only
router.get(
  '/users',
  authMiddleware,
  requirePermission('manage_users'),
  async (req: Request, res: Response): Promise<void> => {
    const allUsers = await AuthService.getUsers();
    res.json(allUsers);
  }
);

export default router;
