import crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

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
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
};
