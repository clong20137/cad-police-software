import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import bmvRoutes from './routes/bmv';
import configurationRoutes from './routes/configuration';
import idacsRoutes from './routes/idacs';
import incidentRoutes from './routes/incidents';
import integrationRoutes from './routes/integrations';
import urgentAlertRoutes from './routes/urgentAlerts';
import { cspMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { apiRateLimiter, enforceHttps, ipAccessControl, sanitizeInput } from './middleware/security';
import { securityConfig } from './config/security';
import { legacyUploadRoots, uploadRoot } from './config/uploads';
import { initializeDatabase } from './db/mysql';
import { initializeRealtime } from './realtime/socket';

const app = express();
const PORT = process.env.BACKEND_PORT || 5001;
const HOST = process.env.BACKEND_HOST?.trim();
const PUBLIC_URL = process.env.BACKEND_PUBLIC_URL?.trim();
const server = http.createServer(app);

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use('/uploads', express.static(uploadRoot));
legacyUploadRoots.forEach((legacyRoot) => {
  app.use('/uploads', express.static(legacyRoot));
});
app.use(cors({ origin: securityConfig.frontendUrls, credentials: true }));
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
app.use('/api/integrations', integrationRoutes);
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

  const listenCallback = () => {
    const displayHost = HOST && !['0.0.0.0', '::'].includes(HOST) ? HOST : 'localhost';
    console.log(`CAD Backend running on ${PUBLIC_URL || `http://${displayHost}:${PORT}`}`);
    if (HOST && ['0.0.0.0', '::'].includes(HOST)) {
      console.log(`Listening on all network interfaces at port ${PORT}`);
    }
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  };

  if (HOST) {
    server.listen(Number(PORT), HOST, listenCallback);
    return;
  }

  server.listen(Number(PORT), listenCallback);
};

startServer().catch((error) => {
  console.error('Failed to start CAD backend:', error);
  process.exit(1);
});
