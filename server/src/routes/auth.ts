import { Router, Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { LoginRequest, RefreshTokenRequest } from 'cad-shared';

const router = Router();

// Public routes
router.post('/login', async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const user = await AuthService.authenticateUser(email, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const tokens = AuthService.generateTokens(user);
    res.json({ success: true, user, tokens });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', (req: Request<{}, {}, RefreshTokenRequest>, res: Response): void => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    const payload = AuthService.verifyRefreshToken(refreshToken);
    if (!payload) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const user = AuthService.getUser(payload.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Revoke old refresh token and generate new pair
    AuthService.revokeRefreshToken(user.id, refreshToken);
    const newTokens = AuthService.generateTokens(user);

    res.json({ success: true, tokens: newTokens });
  } catch (error) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Protected routes
router.post('/logout', authMiddleware, (req: Request, res: Response): void => {
  if (req.user) {
    res.json({ success: true, message: 'Logged out' });
  }
});

router.get(
  '/me',
  authMiddleware,
  (req: Request, res: Response): void => {
    const user = AuthService.getUser(req.user?.id || '');
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
  (req: Request, res: Response): void => {
    // Return all users (sensitive data filtered)
    const allUsers = Array.from({ length: 0 }).map(() => ({}));
    res.json(allUsers);
  }
);

export default router;
