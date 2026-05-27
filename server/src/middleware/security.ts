import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { securityConfig } from '../config/security';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_STRING_LENGTH = 20000;

const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

const createRateLimiter = (name: string, windowMs: number, maxRequests: number) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${name}:${getClientIp(req)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000).toString());
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }

    next();
  };
};

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })
      .join('')
      .slice(0, MAX_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) {
        continue;
      }
      clean[key] = sanitizeValue(nested);
    }
    return clean;
  }

  return value;
};

export const apiRateLimiter = createRateLimiter(
  'api',
  securityConfig.rateLimit.windowMs,
  securityConfig.rateLimit.maxRequests
);

export const sensitiveRateLimiter = createRateLimiter(
  'sensitive',
  securityConfig.rateLimit.sensitiveWindowMs,
  securityConfig.rateLimit.sensitiveMaxRequests
);

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query) as Request['query'];
  }
  next();
};

export const ipAccessControl = (req: Request, res: Response, next: NextFunction): void => {
  const ip = getClientIp(req);

  if (securityConfig.ipBlocklist.has(ip)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (securityConfig.ipAllowlist.size > 0 && !securityConfig.ipAllowlist.has(ip)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  next();
};

export const enforceHttps = (req: Request, res: Response, next: NextFunction): void => {
  if (!securityConfig.enforceHttps) {
    next();
    return;
  }

  const proto = req.headers['x-forwarded-proto'];
  const isHttps = req.secure || proto === 'https';

  if (!isHttps) {
    res.status(403).json({ error: 'HTTPS is required' });
    return;
  }

  next();
};

const hasFreshTimestamp = (timestamp: string): boolean => {
  const requestTime = Number(timestamp);
  return Number.isFinite(requestTime) && Math.abs(Date.now() - requestTime) <= securityConfig.requestSigning.maxAgeMs;
};

export const requireRequestSignature = (req: Request, res: Response, next: NextFunction): void => {
  const [, bearerToken] = req.headers.authorization?.split(' ') || [];
  const signingSecret = securityConfig.requestSigning.secret || bearerToken || '';

  const timestamp = req.header('x-cad-timestamp') || '';
  const signature = req.header('x-cad-signature') || '';

  if (!signingSecret || !timestamp || !signature || !hasFreshTimestamp(timestamp)) {
    res.status(401).json({ error: 'Valid request signature required' });
    return;
  }

  const body = req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : '';
  const payload = [req.method.toUpperCase(), req.originalUrl, timestamp, body].join('\n');
  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(payload)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    res.status(401).json({ error: 'Valid request signature required' });
    return;
  }

  next();
};
