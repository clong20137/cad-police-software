import { NextFunction, Request, Response } from 'express';
import { AuditLogService } from '../services/AuditLogService';

const shouldLogBody = (method: string): boolean => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = Date.now();

  res.on('finish', () => {
    if (req.path === '/api/health') {
      return;
    }

    const durationMs = Date.now() - startedAt;
    const severity = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warning' : 'info';
    const metadata: Record<string, unknown> = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.getHeader('content-length') || null
    };

    if (shouldLogBody(req.method)) {
      metadata.bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
    }

    void AuditLogService.fromRequest(req, {
      action: 'http_request',
      resource: 'api',
      severity,
      metadata
    });
  });

  next();
};
