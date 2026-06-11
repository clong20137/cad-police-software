import { Router, Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { AuditLogService } from '../services/AuditLogService';
import { ConfigurationService } from '../services/ConfigurationService';
import { IncidentService } from '../services/IncidentService';
import { MessageService } from '../services/MessageService';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { requireRequestSignature, sensitiveRateLimiter } from '../middleware/security';
import {
  broadcastMessage,
  broadcastMessageDeleted,
  broadcastMessageRead,
  broadcastMessageTyping,
  broadcastMessageUpdated,
  broadcastIncidents,
  broadcastOfficerAssignment,
  broadcastPresence,
  broadcastTrackedUnits
} from '../realtime/socket';
import {
  DestinationUpdateRequest,
  ChangePasswordRequest,
  LocationUpdateRequest,
  LoginRequest,
  RefreshTokenRequest,
  ResetUserPasswordRequest,
  RegisterRequest,
  SendMessageRequest,
  TwoFactorVerifyRequest,
  UpdateUserRequest,
  UserRole,
  VerifyPasswordRequest
} from '../types/auth';
import type { UnitStatus } from '../types/auth';

const router = Router();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const isRateLimited = async (key: string): Promise<boolean> => {
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  const lockoutMinutes = Math.max(5, await ConfigurationService.getNumber('LOGIN_LOCKOUT_MINUTES', 15));
  const maxAttempts = Math.max(3, await ConfigurationService.getNumber('MAX_LOGIN_ATTEMPTS', 5));
  const windowMs = lockoutMinutes * 60 * 1000;

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  attempt.count += 1;
  return attempt.count > maxAttempts;
};

// Public routes
router.post('/register', sensitiveRateLimiter, async (req: Request<{}, {}, RegisterRequest>, res: Response): Promise<void> => {
  try {
    const registrationEnabled = await ConfigurationService.getBoolean('ALLOW_PUBLIC_REGISTRATION', true);
    if (!registrationEnabled) {
      res.status(403).json({ error: 'Public registration is disabled' });
      return;
    }

    const {
      email,
      password,
      name,
      role = UserRole.VIEWER,
      badge,
      unitNumber,
      cadUnitNumber,
      status,
      group,
      district
    } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    const existingUser = await AuthService.getUserByEmail(email);
    if (existingUser) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const user = await AuthService.createUser(
      email,
      name,
      role,
      password,
      badge,
      unitNumber,
      cadUnitNumber,
      status,
      group,
      district
    );
    const setup = AuthService.createTwoFactorSetup(user);
    await AuditLogService.fromRequest(req, {
      action: 'user_registered',
      resource: 'user',
      resourceId: user.id,
      metadata: { email: user.email, role: user.role }
    });
    res.status(201).json({
      success: false,
      twoFactorRequired: true,
      setupRequired: true,
      challengeToken: setup.challengeToken,
      setup: {
        secret: setup.secret,
        otpauthUrl: setup.otpauthUrl
      }
    });
  } catch (error) {
    res.status(400).json({ error: getErrorMessage(error, 'Registration failed') });
  }
});

router.post('/login', sensitiveRateLimiter, async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { email, password, twoFactorCode } = req.body;
    const rateLimitKey = `${req.ip}:${email || 'unknown'}`;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    if (await isRateLimited(rateLimitKey)) {
      res.status(429).json({ error: 'Too many login attempts. Try again later.' });
      return;
    }

    const loginResult = await AuthService.beginLogin(email, password, twoFactorCode);
    if (!loginResult) {
      await AuditLogService.fromRequest(req, {
        action: 'login_failed',
        resource: 'auth',
        severity: 'warning',
        metadata: { email }
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (loginResult.type === 'setup') {
      await AuditLogService.fromRequest(req, {
        action: 'login_2fa_setup_required',
        resource: 'auth',
        resourceId: loginResult.user.id,
        severity: 'warning',
        metadata: { email: loginResult.user.email, role: loginResult.user.role }
      });
      res.json({
        success: false,
        twoFactorRequired: true,
        setupRequired: true,
        challengeToken: loginResult.challengeToken,
        setup: {
          secret: loginResult.secret,
          otpauthUrl: loginResult.otpauthUrl
        }
      });
      return;
    }

    if (loginResult.type === 'challenge') {
      await AuditLogService.fromRequest(req, {
        action: 'login_2fa_required',
        resource: 'auth',
        severity: 'warning',
        metadata: { email }
      });
      res.json({
        success: false,
        twoFactorRequired: true,
        setupRequired: false,
        challengeToken: loginResult.challengeToken
      });
      return;
    }

    const user = loginResult.user;
    const tokens = await AuthService.generateTokens(user);
    loginAttempts.delete(rateLimitKey);
    await AuditLogService.fromRequest(req, {
      action: 'login_success',
      resource: 'auth',
      resourceId: user.id,
      metadata: { email: user.email, role: user.role }
    });
    res.json({ success: true, user, tokens });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/2fa/verify', sensitiveRateLimiter, async (req: Request<{}, {}, TwoFactorVerifyRequest>, res: Response): Promise<void> => {
  try {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) {
      res.status(400).json({ error: 'Two-factor challenge and code are required' });
      return;
    }

    const setupResult = await AuthService.completeTwoFactorSetup(challengeToken, code);
    if (setupResult) {
      const tokens = await AuthService.generateTokens(setupResult.user);
      await AuditLogService.fromRequest(req, {
        action: 'two_factor_enabled',
        resource: 'auth',
        resourceId: setupResult.user.id,
        severity: 'warning'
      });
      res.json({ success: true, user: setupResult.user, tokens, backupCodes: setupResult.backupCodes });
      return;
    }

    const user = await AuthService.completeTwoFactorChallenge(challengeToken, code);
    if (!user) {
      await AuditLogService.fromRequest(req, {
        action: 'two_factor_failed',
        resource: 'auth',
        severity: 'warning'
      });
      res.status(401).json({ error: 'Invalid two-factor code' });
      return;
    }

    const tokens = await AuthService.generateTokens(user);
    loginAttempts.delete(`${req.ip}:${user.email}`);
    await AuditLogService.fromRequest(req, {
      action: 'two_factor_verified',
      resource: 'auth',
      resourceId: user.id
    });
    res.json({ success: true, user, tokens });
  } catch (error) {
    res.status(500).json({ error: 'Two-factor verification failed' });
  }
});

router.post(
  '/2fa/setup',
  sensitiveRateLimiter,
  authMiddleware,
  requireRequestSignature,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = await AuthService.getUser(req.user?.id || '');
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (user.twoFactorEnabled) {
        res.status(409).json({ error: 'Two-factor authentication is already enabled' });
        return;
      }

      const setup = AuthService.createTwoFactorSetup(user);
      await AuditLogService.fromRequest(req, {
        action: 'two_factor_setup_started',
        resource: 'auth',
        resourceId: user.id,
        severity: 'warning'
      });
      res.json({
        challengeToken: setup.challengeToken,
        secret: setup.secret,
        otpauthUrl: setup.otpauthUrl
      });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, 'Unable to start two-factor setup') });
    }
  }
);

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
    await AuditLogService.fromRequest(req, {
      action: 'logout',
      resource: 'auth',
      resourceId: req.user.id
    });
    res.json({ success: true, message: 'Logged out' });
  }
});

router.post(
  '/change-password',
  sensitiveRateLimiter,
  authMiddleware,
  requireRequestSignature,
  async (req: Request<{}, {}, ChangePasswordRequest>, res: Response): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword || newPassword.length < 14) {
        res.status(400).json({ error: 'Current password and a new password of at least 14 characters are required' });
        return;
      }

      const changed = await AuthService.changePassword(req.user?.id || '', currentPassword, newPassword);
      if (!changed) {
        await AuditLogService.fromRequest(req, {
          action: 'password_change_failed',
          resource: 'auth',
          severity: 'warning'
        });
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      await AuditLogService.fromRequest(req, {
        action: 'password_changed',
        resource: 'auth',
        severity: 'warning'
      });
      res.json({ success: true });
    } catch (error) {
      await AuditLogService.fromRequest(req, {
        action: 'password_change_failed',
        resource: 'auth',
        severity: 'warning'
      });
      res.status(400).json({ error: getErrorMessage(error, 'Unable to change password') });
    }
  }
);

router.post(
  '/verify-password',
  sensitiveRateLimiter,
  authMiddleware,
  requireRequestSignature,
  async (req: Request<{}, {}, VerifyPasswordRequest>, res: Response): Promise<void> => {
    try {
      const { password } = req.body;
      if (!password) {
        res.status(400).json({ error: 'Password is required' });
        return;
      }

      const verified = await AuthService.verifyPassword(req.user?.id || '', password);
      if (!verified) {
        await AuditLogService.fromRequest(req, {
          action: 'session_unlock_failed',
          resource: 'auth',
          severity: 'warning'
        });
        res.status(401).json({ error: 'Password is incorrect' });
        return;
      }

      await AuditLogService.fromRequest(req, {
        action: 'session_unlocked',
        resource: 'auth'
      });
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, 'Unable to verify password') });
    }
  }
);

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

router.post(
  '/users',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_users'),
  requireRequestSignature,
  async (req: Request<{}, {}, RegisterRequest>, res: Response): Promise<void> => {
    try {
      const user = await AuthService.createUser(
        req.body.email,
        req.body.name,
        req.body.role || UserRole.VIEWER,
        req.body.password,
        req.body.badge,
        req.body.unitNumber,
        req.body.cadUnitNumber,
        req.body.status,
        req.body.group,
        req.body.district
      );

      await AuditLogService.fromRequest(req, {
        action: 'user_created',
        resource: 'user',
        resourceId: user.id,
        metadata: { email: user.email, role: user.role }
      });
      await broadcastPresence();
      res.status(201).json(user);
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, 'Unable to create user') });
    }
  }
);

router.patch(
  '/users/:id',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_users'),
  requireRequestSignature,
  async (req: Request<{ id: string }, {}, UpdateUserRequest>, res: Response): Promise<void> => {
    if (req.params.id === req.user?.id && req.body.active === false) {
      res.status(400).json({ error: 'You cannot deactivate your own account' });
      return;
    }

    const user = await AuthService.updateUser(req.params.id, req.body);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await AuditLogService.fromRequest(req, {
      action: 'user_updated',
      resource: 'user',
      resourceId: user.id,
      metadata: { email: user.email, role: user.role, active: user.active }
    });
    await broadcastPresence();
    await broadcastTrackedUnits();
    res.json(user);
  }
);

router.post(
  '/users/:id/reset-password',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_users'),
  requireRequestSignature,
  async (req: Request<{ id: string }, {}, ResetUserPasswordRequest>, res: Response): Promise<void> => {
    try {
      const changed = await AuthService.resetUserPassword(req.params.id, req.body);
      if (!changed) {
        res.status(400).json({ error: 'User not found or password is too short' });
        return;
      }

      await AuditLogService.fromRequest(req, {
        action: 'user_password_reset',
        resource: 'user',
        resourceId: req.params.id,
        severity: 'warning'
      });
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error, 'Unable to reset password') });
    }
  }
);

router.get(
  '/audit-logs',
  authMiddleware,
  requirePermission('manage_system'),
  async (req: Request, res: Response): Promise<void> => {
    const limit = Number(req.query.limit || 200);
    const logs = await AuditLogService.recent(limit);
    res.json(logs);
  }
);

router.get(
  '/directory',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const allUsers = await AuthService.getUsers();
    res.json(allUsers);
  }
);

router.get(
  '/messages/threads',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const threads = await MessageService.getThreads(req.user?.id || '');
    res.json(threads);
  }
);

router.post(
  '/messages/:userId/read',
  authMiddleware,
  async (req: Request<{ userId: string }>, res: Response): Promise<void> => {
    const readMessageIds = await MessageService.markRead(req.user?.id || '', req.params.userId);
    broadcastMessageRead(req.user?.id || '', req.params.userId, readMessageIds);
    res.json({ messageIds: readMessageIds });
  }
);

router.post(
  '/messages/:userId/typing',
  authMiddleware,
  async (req: Request<{ userId: string }, {}, { isTyping?: boolean }>, res: Response): Promise<void> => {
    const actorId = req.user?.id || '';
    const actor = await AuthService.getUser(actorId);
    broadcastMessageTyping(actorId, req.params.userId, req.body.isTyping === true, actor?.name || 'Someone');
    res.json({ success: true });
  }
);

router.get(
  '/messages/:userId',
  authMiddleware,
  async (req: Request<{ userId: string }>, res: Response): Promise<void> => {
    const readMessageIds = await MessageService.markRead(req.user?.id || '', req.params.userId);
    broadcastMessageRead(req.user?.id || '', req.params.userId, readMessageIds);
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const messages = await MessageService.searchConversation(req.user?.id || '', req.params.userId, query);
    res.json(messages);
  }
);

router.patch(
  '/messages/:messageId/reaction',
  authMiddleware,
  async (req: Request<{ messageId: string }, {}, { reaction?: string | null }>, res: Response): Promise<void> => {
    try {
      const updated = await MessageService.react(req.params.messageId, req.user?.id || '', req.body.reaction || null);
      broadcastMessageUpdated(updated);
      res.json(updated);
    } catch {
      res.status(404).json({ error: 'Message not found' });
    }
  }
);

router.delete(
  '/messages/thread/:userId',
  authMiddleware,
  async (req: Request<{ userId: string }>, res: Response): Promise<void> => {
    const deletedMessageIds = await MessageService.deleteConversation(req.user?.id || '', req.params.userId);
    broadcastMessageDeleted(req.user?.id || '', req.params.userId, deletedMessageIds);
    res.json({ messageIds: deletedMessageIds });
  }
);

router.delete(
  '/messages/:messageId',
  authMiddleware,
  async (req: Request<{ messageId: string }>, res: Response): Promise<void> => {
    const deleted = await MessageService.deleteMessage(req.params.messageId, req.user?.id || '');
    if (!deleted) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const otherUserId = deleted.senderId === req.user?.id ? deleted.recipientId : deleted.senderId;
    broadcastMessageDeleted(req.user?.id || '', otherUserId, [deleted.id]);
    res.json({ messageIds: [deleted.id] });
  }
);

router.post(
  '/messages',
  authMiddleware,
  async (req: Request<{}, {}, SendMessageRequest>, res: Response): Promise<void> => {
    const { recipientId, body, attachments = [] } = req.body;

    if (!recipientId || (!body?.trim() && attachments.length === 0)) {
      res.status(400).json({ error: 'recipientId and a message or attachment are required' });
      return;
    }

    const recipient = await AuthService.getUser(recipientId);
    if (!recipient) {
      res.status(404).json({ error: 'Recipient not found' });
      return;
    }

    const message = await MessageService.createMessage(req.user?.id || '', recipientId, body || '', attachments);
    broadcastMessage(message);
    res.status(201).json(message);
  }
);

router.patch(
  '/me/status',
  authMiddleware,
  async (req: Request<{}, {}, { status?: string | null }>, res: Response): Promise<void> => {
    const allowedStatuses = new Set<UnitStatus>(['Idle', 'Available', 'In Service', 'Out of Service', 'Dispatched', 'En Route', 'On Scene', 'Transporting', 'Traffic Stop']);
    const status = req.body.status || 'Idle';
    if (!allowedStatuses.has(status as UnitStatus)) {
      res.status(400).json({ error: 'Valid unit status is required' });
      return;
    }

    const user = await AuthService.updateStatus(req.user?.id || '', status as UnitStatus);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await AuthService.touchLastSeen(req.user?.id || '');
    await broadcastPresence();
    await broadcastTrackedUnits();
    res.json(user);
  }
);

router.patch(
  '/me/location',
  authMiddleware,
  async (req: Request<{}, {}, LocationUpdateRequest>, res: Response): Promise<void> => {
    const { lat, lon } = req.body;
    const speedMph = req.body.speedMph;

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      (speedMph !== undefined && speedMph !== null && (!Number.isFinite(speedMph) || speedMph < 0))
    ) {
      res.status(400).json({ error: 'Valid lat and lon are required' });
      return;
    }

    const user = await AuthService.updateLocation(req.user?.id || '', lat, lon, speedMph);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await AuthService.touchLastSeen(req.user?.id || '');
    const automatedIncident = await IncidentService.autoUpdateAssignedUnitFromLocation(req.user?.id || '', lat, lon, speedMph);
    const responseUser = automatedIncident ? await AuthService.getUser(req.user?.id || '') : user;
    await broadcastPresence();
    await broadcastTrackedUnits();
    if (automatedIncident) {
      await broadcastIncidents();
      await broadcastOfficerAssignment(req.user?.id || '');
    }
    res.json(responseUser || user);
  }
);

router.patch(
  '/me/destination',
  authMiddleware,
  async (req: Request<{}, {}, DestinationUpdateRequest>, res: Response): Promise<void> => {
    const { destinationLat, destinationLon, destinationLabel } = req.body;

    const clearingDestination = destinationLat === null && destinationLon === null;
    const validDestination =
      Number.isFinite(destinationLat) &&
      Number.isFinite(destinationLon) &&
      Number(destinationLat) >= -90 &&
      Number(destinationLat) <= 90 &&
      Number(destinationLon) >= -180 &&
      Number(destinationLon) <= 180;

    if (!clearingDestination && !validDestination) {
      res.status(400).json({ error: 'Valid destinationLat and destinationLon are required' });
      return;
    }

    const user = await AuthService.updateDestination(
      req.user?.id || '',
      clearingDestination ? null : Number(destinationLat),
      clearingDestination ? null : Number(destinationLon),
      destinationLabel
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await broadcastTrackedUnits();
    res.json(user);
  }
);

router.get(
  '/units',
  authMiddleware,
  requirePermission('view_officers'),
  async (req: Request, res: Response): Promise<void> => {
    const units = await AuthService.getTrackedUnits();
    res.json(units);
  }
);

export default router;
