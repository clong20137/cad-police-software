import fs from 'fs/promises';
import path from 'path';
import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { requireRequestSignature, sensitiveRateLimiter } from '../middleware/security';
import { AuditLogService } from '../services/AuditLogService';
import { ConfigurationService, UpsertConfigurationItemRequest } from '../services/ConfigurationService';
import { uploadRoot } from '../config/uploads';

const router = Router();
const MAX_LOGO_UPLOAD_BYTES = 5 * 1024 * 1024;
const LOGO_UPLOAD_DIR = path.join(uploadRoot, 'branding');

const publicBaseUrl = (req: Request): string =>
  (process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host') || 'localhost:5001'}`).replace(/\/+$/, '');

const publicLogoUrl = (req: Request, logoUrl: string): string => {
  if (!logoUrl || /^https?:\/\//i.test(logoUrl) || logoUrl.startsWith('data:')) {
    return logoUrl;
  }
  return `${publicBaseUrl(req)}${logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`}`;
};

const extensionForMimeType = (mimeType: string): string | null => {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/svg+xml') return 'svg';
  return null;
};

const bufferFromDataUrl = (dataUrl: string, mimeType: string): Buffer => {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('Logo data does not match the uploaded image type.');
  }
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
};

router.get(
  '/public/auth',
  async (_req: Request, res: Response): Promise<void> => {
    const registrationEnabled = await ConfigurationService.getBoolean('ALLOW_PUBLIC_REGISTRATION', true);
    res.json({ registrationEnabled });
  }
);

router.get(
  '/public/branding',
  async (req: Request, res: Response): Promise<void> => {
    const item = await ConfigurationService.getBySectionCode('branding', 'APP_LOGO');
    const logoUrl = item?.active && typeof item.metadata.logoUrl === 'string' ? item.metadata.logoUrl : '';
    res.json({
      logoUrl: publicLogoUrl(req, logoUrl),
      logoAlt: typeof item?.metadata.logoAlt === 'string' ? item.metadata.logoAlt : 'CAD logo'
    });
  }
);

router.post(
  '/branding/logo',
  sensitiveRateLimiter,
  authMiddleware,
  requirePermission('manage_system'),
  requireRequestSignature,
  async (req: Request<{}, {}, { fileName?: string; mimeType?: string; dataUrl?: string; logoAlt?: string }>, res: Response): Promise<void> => {
    const mimeType = req.body.mimeType || '';
    const dataUrl = req.body.dataUrl || '';
    const extension = extensionForMimeType(mimeType);
    if (!extension || !dataUrl) {
      res.status(400).json({ error: 'Valid image upload is required.' });
      return;
    }

    const logoBuffer = bufferFromDataUrl(dataUrl, mimeType);
    if (logoBuffer.length === 0 || logoBuffer.length > MAX_LOGO_UPLOAD_BYTES) {
      res.status(413).json({ error: 'Logo must be smaller than 5 MB.' });
      return;
    }

    await fs.mkdir(LOGO_UPLOAD_DIR, { recursive: true });
    const fileName = `app-logo.${extension}`;
    const relativeUrl = `/uploads/branding/${fileName}?v=${Date.now()}`;
    await fs.writeFile(path.join(LOGO_UPLOAD_DIR, fileName), logoBuffer);

    const existing = await ConfigurationService.getBySectionCode('branding', 'APP_LOGO');
    if (!existing) {
      res.status(404).json({ error: 'Branding configuration item not found.' });
      return;
    }

    const item = await ConfigurationService.update(existing.id, {
      metadata: {
        ...existing.metadata,
        logoUrl: publicLogoUrl(req, relativeUrl),
        logoAlt: req.body.logoAlt?.trim() || existing.metadata.logoAlt || 'CAD logo',
        logoFileName: req.body.fileName?.slice(0, 255) || fileName
      }
    });

    if (!item) {
      res.status(404).json({ error: 'Branding configuration item not found.' });
      return;
    }

    await AuditLogService.fromRequest(req, {
      action: 'configuration_logo_uploaded',
      resource: 'admin_configuration',
      resourceId: item.id,
      metadata: { section: item.section, code: item.code, fileName: req.body.fileName || fileName }
    });
    res.json(item);
  }
);

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
