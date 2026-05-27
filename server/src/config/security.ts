import crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';
const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const listFromEnv = (name: string): Set<string> =>
  new Set(
    (process.env[name] || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

const getSecret = (name: 'JWT_SECRET' | 'REFRESH_TOKEN_SECRET'): string => {
  const value = process.env[name];

  if (value && value.length >= 32) {
    return value;
  }

  if (isProduction) {
    throw new Error(`${name} must be set to at least 32 characters in production.`);
  }

  if (value) {
    console.warn(`${name} is shorter than 32 characters. Use a stronger value before deploying.`);
    return value;
  }

  console.warn(`${name} is not set. Generated a development-only secret for this process.`);
  return crypto.randomBytes(48).toString('hex');
};

export const securityConfig = {
  isProduction,
  jwtSecret: getSecret('JWT_SECRET'),
  refreshTokenSecret: getSecret('REFRESH_TOKEN_SECRET'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  enforceHttps: process.env.ENFORCE_HTTPS === 'true' || (isProduction && process.env.ENFORCE_HTTPS !== 'false'),
  ipAllowlist: listFromEnv('IP_ALLOWLIST'),
  ipBlocklist: listFromEnv('IP_BLOCKLIST'),
  passwordPolicy: {
    minLength: numberFromEnv('PASSWORD_MIN_LENGTH', 12),
    historyCount: numberFromEnv('PASSWORD_HISTORY_COUNT', 5),
    maxAgeDays: numberFromEnv('PASSWORD_MAX_AGE_DAYS', 180)
  },
  rateLimit: {
    windowMs: numberFromEnv('RATE_LIMIT_WINDOW_MS', 60 * 1000),
    maxRequests: numberFromEnv('RATE_LIMIT_MAX_REQUESTS', 240),
    sensitiveWindowMs: numberFromEnv('SENSITIVE_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    sensitiveMaxRequests: numberFromEnv('SENSITIVE_RATE_LIMIT_MAX_REQUESTS', 30)
  },
  requestSigning: {
    secret: process.env.REQUEST_SIGNING_SECRET || '',
    maxAgeMs: numberFromEnv('REQUEST_SIGNING_MAX_AGE_MS', 5 * 60 * 1000)
  }
};
