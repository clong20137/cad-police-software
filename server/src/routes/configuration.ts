import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { requireRequestSignature, sensitiveRateLimiter } from '../middleware/security';
import { AuditLogService } from '../services/AuditLogService';
import { ConfigurationService, UpsertConfigurationItemRequest } from '../services/ConfigurationService';

const router = Router();

router.get(
  '/active',
  authMiddleware,
  async (_req: Request, res: Response): Promise<void> => {
    const items = await ConfigurationService.list();
    res.json(items.filter((item) => item.active));
  }
);

router.get(
  '/',
  authMiddleware,
  requirePermission('manage_system'),
  async (_req: Request, res: Response): Promise<void> => {
    const items = await ConfigurationService.list();
    res.json(items);
  }
);

router.post(
  '/',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_system'),
  requireRequestSignature,
  async (req: Request<{}, {}, UpsertConfigurationItemRequest>, res: Response): Promise<void> => {
    const item = await ConfigurationService.create(req.body);
    await AuditLogService.fromRequest(req, {
      action: 'configuration_created',
      resource: 'admin_configuration',
      resourceId: item.id,
      metadata: { section: item.section, code: item.code }
    });
    res.status(201).json(item);
  }
);

router.patch(
  '/:id',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_system'),
  requireRequestSignature,
  async (req: Request<{ id: string }, {}, UpsertConfigurationItemRequest>, res: Response): Promise<void> => {
    const item = await ConfigurationService.update(req.params.id, req.body);
    if (!item) {
      res.status(404).json({ error: 'Configuration item not found' });
      return;
    }

    await AuditLogService.fromRequest(req, {
      action: 'configuration_updated',
      resource: 'admin_configuration',
      resourceId: item.id,
      metadata: { section: item.section, code: item.code, active: item.active }
    });
    res.json(item);
  }
);

router.delete(
  '/:id',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_system'),
  requireRequestSignature,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const deleted = await ConfigurationService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Configuration item not found' });
      return;
    }

    await AuditLogService.fromRequest(req, {
      action: 'configuration_deleted',
      resource: 'admin_configuration',
      resourceId: req.params.id,
      severity: 'warning'
    });
    res.json({ success: true });
  }
);

export default router;
