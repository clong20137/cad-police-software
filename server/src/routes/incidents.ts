import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { broadcastIncidents, broadcastTrackedUnits } from '../realtime/socket';
import { IncidentService } from '../services/IncidentService';
import {
  AssignIncidentUnitRequest,
  CreateIncidentRequest,
  UpdateIncidentStatusRequest
} from '../types/auth';

const router = Router();

router.get(
  '/',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(await IncidentService.getActiveIncidents());
  }
);

router.post(
  '/',
  authMiddleware,
  requirePermission('create_dispatch'),
  async (req: Request<{}, {}, CreateIncidentRequest>, res: Response): Promise<void> => {
    try {
      const incident = await IncidentService.createIncident(req.body, req.user?.id || '');
      await broadcastIncidents();
      res.status(201).json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to create incident' });
    }
  }
);

router.patch(
  '/:id/status',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (
    req: Request<{ id: string }, {}, UpdateIncidentStatusRequest>,
    res: Response
  ): Promise<void> => {
    try {
      const incident = await IncidentService.updateStatus(req.params.id, req.body.status);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }

      await broadcastIncidents();
      await broadcastTrackedUnits();
      res.json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to update incident' });
    }
  }
);

router.post(
  '/:id/assignments',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (
    req: Request<{ id: string }, {}, AssignIncidentUnitRequest>,
    res: Response
  ): Promise<void> => {
    try {
      if (!req.body.userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const incident = await IncidentService.assignUnit(
        req.params.id,
        req.body.userId,
        req.user?.id || '',
        req.body.status || 'Assigned'
      );
      if (!incident) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }

      await broadcastIncidents();
      await broadcastTrackedUnits();
      res.json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to assign unit' });
    }
  }
);

export default router;
