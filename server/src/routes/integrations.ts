import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { AccessControlService } from '../services/AccessControlService';
import { AuditLogService } from '../services/AuditLogService';
import { AuthService } from '../services/AuthService';
import { IntegrationSettingsService, SensitiveIntegrationCode } from '../services/IntegrationSettingsService';
import { CourtLookupAuditRequest, IntegrationStatus } from '../types/auth';

const router = Router();
const labels: Record<SensitiveIntegrationCode, string> = {
  BMV: 'BMV',
  IDACS: 'IDACS',
  COURTS: 'Indiana Courts'
};

const toStatus = async (code: SensitiveIntegrationCode): Promise<IntegrationStatus> => {
  const settings = await IntegrationSettingsService.get(code);
  const configured = code === 'COURTS' ? Boolean(settings.endpoint) : Boolean(settings.endpoint && settings.apiKey);
  return {
    code,
    label: labels[code],
    enabled: settings.enabled,
    configured,
    message: settings.enabled
      ? configured
        ? `${labels[code]} is configured.`
        : `${labels[code]} is enabled but missing endpoint or key.`
      : `${labels[code]} is disabled.`
  };
};

router.get(
  '/status',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(await Promise.all((['BMV', 'IDACS', 'COURTS'] as SensitiveIntegrationCode[]).map(toStatus)));
  }
);

router.post(
  '/:code/test',
  authMiddleware,
  requirePermission('manage_system'),
  async (req: Request<{ code: string }>, res: Response): Promise<void> => {
    const code = req.params.code.toUpperCase() as SensitiveIntegrationCode;
    if (!['BMV', 'IDACS', 'COURTS'].includes(code)) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    const status = await toStatus(code);
    await AuditLogService.fromRequest(req, {
      action: 'integration_test',
      resource: 'integration',
      resourceId: code,
      severity: status.configured ? 'info' : 'warning',
      metadata: { ...status }
    });
    res.json(status);
  }
);

router.get(
  '/inquiries/history',
  authMiddleware,
  requirePermission('query_courts'),
  async (req: Request, res: Response): Promise<void> => {
    res.json(await AuditLogService.sensitiveInquiryHistory(Number(req.query.limit || 200)));
  }
);

router.post(
  '/court-lookups',
  authMiddleware,
  requirePermission('query_courts'),
  async (req: Request<{}, {}, CourtLookupAuditRequest>, res: Response): Promise<void> => {
    try {
      const requester = await AuthService.getUser(req.user?.id || '');
      if (!requester) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      const lookup = await AccessControlService.authorizeCourtLookup(req.body, requester);
      await AuditLogService.fromRequest(req, {
        action: 'court_lookup',
        resource: 'sensitive_inquiry',
        resourceId: `${lookup.mode}-${Date.now()}`,
        severity: 'warning',
        metadata: {
          mode: lookup.mode,
          reason: lookup.reason,
          name: lookup.name || undefined,
          dob: lookup.dob || undefined,
          caseNumber: lookup.caseNumber || undefined,
          sourceUrl: lookup.sourceUrl
        }
      });
      res.json({ success: true });
    } catch (error) {
      await AccessControlService.auditDeniedLookup(req.user?.id, 'COURTS', (error as Error).message || 'Court lookup denied');
      res.status(400).json({ error: (error as Error).message || 'Court lookup denied' });
    }
  }
);

export default router;
