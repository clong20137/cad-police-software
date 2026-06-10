import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { broadcastUrgentAlerts } from '../realtime/socket';
import { AuthService } from '../services/AuthService';
import { UrgentAlertService } from '../services/UrgentAlertService';
import { CreateUrgentAlertRequest, UserRole } from '../types/auth';

const router = Router();

router.get(
  '/',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await UrgentAlertService.pendingForUser(req.user?.id || ''));
  }
);

router.get(
  '/recent',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(await UrgentAlertService.recent());
  }
);

router.post(
  '/',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (req: Request<{}, {}, CreateUrgentAlertRequest>, res: Response): Promise<void> => {
    try {
      const creator = await AuthService.getUser(req.user?.id || '');
      if (!creator) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      const alert = await UrgentAlertService.create(req.body, creator);
      broadcastUrgentAlerts(alert.recipientIds);
      res.status(201).json(alert);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to send urgent alert' });
    }
  }
);

router.post(
  '/officer-emergency',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (req: Request<{}, {}, { lat?: number | null; lon?: number | null }>, res: Response): Promise<void> => {
    try {
      if (req.user?.role !== UserRole.OFFICER && req.user?.role !== UserRole.ADMIN) {
        res.status(403).json({ error: 'Officer or admin access required' });
        return;
      }
      const officer = await AuthService.getUser(req.user.id);
      if (!officer) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      const alert = await UrgentAlertService.createOfficerEmergency(officer, req.body.lat, req.body.lon);
      broadcastUrgentAlerts(alert.recipientIds);
      res.status(201).json(alert);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to send officer emergency alert' });
    }
  }
);

router.put(
  '/:id/acknowledge',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const acknowledged = await UrgentAlertService.acknowledge(req.params.id, req.user?.id || '');
    if (!acknowledged) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    broadcastUrgentAlerts([req.user?.id || '']);
    res.json({ message: 'Alert acknowledged' });
  }
);

router.delete(
  '/:id',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const removed = await UrgentAlertService.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    broadcastUrgentAlerts();
    res.json({ message: 'Alert removed' });
  }
);

export default router;
