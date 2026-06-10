import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { broadcastIncidents, broadcastOfficerAssignment, broadcastTrackedUnits } from '../realtime/socket';
import { IncidentService } from '../services/IncidentService';
import {
  AssignIncidentUnitRequest,
  AddIncidentNoteRequest,
  CreateIncidentRequest,
  OfficerEventRequest,
  UpdateIncidentStatusRequest,
  UserRole
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

router.post(
  '/officer-events',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (req: Request<{}, {}, OfficerEventRequest>, res: Response): Promise<void> => {
    try {
      if (req.user?.role !== UserRole.OFFICER && req.user?.role !== UserRole.ADMIN) {
        res.status(403).json({ error: 'Officer or admin access required' });
        return;
      }

      const eventType = req.body.type?.trim();
      if (!eventType) {
        res.status(400).json({ error: 'Event type is required' });
        return;
      }

      const incident = await IncidentService.createIncident(
        {
          type: eventType,
          priority: req.body.priority || 'Normal',
          address:
            req.body.address?.trim() ||
            (Number.isFinite(req.body.lat) && Number.isFinite(req.body.lon)
              ? `Officer location ${Number(req.body.lat).toFixed(5)}, ${Number(req.body.lon).toFixed(5)}`
              : 'Officer initiated event'),
          description: req.body.description || `${eventType} initiated by officer`,
          district: req.body.district,
          beat: req.body.beat,
          lat: req.body.lat ?? null,
          lon: req.body.lon ?? null
        },
        req.user.id
      );
      const assigned = await IncidentService.assignUnit(incident.id, req.user.id, req.user.id, 'Acknowledged');

      await broadcastIncidents();
      await broadcastTrackedUnits();
      await broadcastOfficerAssignment(req.user.id);
      res.status(201).json(assigned || incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to create officer event' });
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
      const incident = await IncidentService.updateStatus(req.params.id, req.body.status, req.body.disposition, req.user?.id);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }

      await broadcastIncidents();
      await broadcastTrackedUnits();
      await Promise.all(incident.units.map((unit) => broadcastOfficerAssignment(unit.userId)));
      res.json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to update incident' });
    }
  }
);

router.post(
  '/:id/reopen',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const incident = await IncidentService.reopenIncident(req.params.id, req.user?.id);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }

      await broadcastIncidents();
      await broadcastTrackedUnits();
      await Promise.all(incident.units.map((unit) => broadcastOfficerAssignment(unit.userId)));
      res.json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to reopen incident' });
    }
  }
);

router.post(
  '/:id/notes',
  authMiddleware,
  requirePermission('update_dispatch'),
  async (req: Request<{ id: string }, {}, AddIncidentNoteRequest>, res: Response): Promise<void> => {
    try {
      const note = await IncidentService.addNote(req.params.id, req.user?.id || null, req.body);
      if (!note) {
        res.status(404).json({ error: 'Incident not found' });
        return;
      }

      await broadcastIncidents();
      res.status(201).json(note);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to add note' });
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
      await broadcastOfficerAssignment(req.body.userId);
      res.json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to assign unit' });
    }
  }
);

router.patch(
  '/:id/my-status',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (
    req: Request<{ id: string }, {}, AssignIncidentUnitRequest>,
    res: Response
  ): Promise<void> => {
    try {
      if (req.user?.role !== UserRole.OFFICER && req.user?.role !== UserRole.ADMIN) {
        res.status(403).json({ error: 'Officer or admin access required' });
        return;
      }

      const incident = await IncidentService.updateAssignedUnitStatus(
        req.params.id,
        req.user?.id || '',
        req.body.status || 'Assigned'
      );
      if (!incident) {
        res.status(404).json({ error: 'Assigned incident not found' });
        return;
      }

      await broadcastIncidents();
      await broadcastTrackedUnits();
      res.json(incident);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to update unit status' });
    }
  }
);

router.post(
  '/:id/my-notes',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (req: Request<{ id: string }, {}, AddIncidentNoteRequest>, res: Response): Promise<void> => {
    try {
      if (req.user?.role !== UserRole.OFFICER && req.user?.role !== UserRole.ADMIN) {
        res.status(403).json({ error: 'Officer or admin access required' });
        return;
      }

      const note = await IncidentService.addAssignedUnitNote(req.params.id, req.user?.id || '', req.body);
      if (!note) {
        res.status(404).json({ error: 'Assigned incident not found' });
        return;
      }

      await broadcastIncidents();
      res.status(201).json(note);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to add note' });
    }
  }
);

export default router;
