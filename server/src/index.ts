import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import bmvRoutes from './routes/bmv';
import configurationRoutes from './routes/configuration';
import idacsRoutes from './routes/idacs';
import incidentRoutes from './routes/incidents';
import urgentAlertRoutes from './routes/urgentAlerts';
import { cspMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { apiRateLimiter, enforceHttps, ipAccessControl, sanitizeInput } from './middleware/security';
import { securityConfig } from './config/security';
import { initializeDatabase } from './db/mysql';
import { initializeRealtime } from './realtime/socket';

const app = express();
const PORT = process.env.BACKEND_PORT || 5001;
const server = http.createServer(app);

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use(cors({ origin: securityConfig.frontendUrl, credentials: true }));
app.use(cspMiddleware);
app.use(enforceHttps);
app.use(ipAccessControl);
app.use('/api', apiRateLimiter);
app.use(sanitizeInput);
app.use(requestLogger);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bmv', bmvRoutes);
app.use('/api/configuration', configurationRoutes);
app.use('/api/idacs', idacsRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/urgent-alerts', urgentAlertRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling
app.use(errorHandler);

const startServer = async (): Promise<void> => {
  await initializeDatabase();
  initializeRealtime(server);

  server.listen(PORT, () => {
    console.log(`CAD Backend running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start CAD backend:', error);
  process.exit(1);
});
