import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import { cspMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { securityConfig } from './config/security';
import { initializeDatabase } from './db/mysql';
import { initializeRealtime } from './realtime/socket';

const app = express();
const PORT = process.env.BACKEND_PORT || 5001;
const server = http.createServer(app);

// Middleware
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cors({ origin: securityConfig.frontendUrl, credentials: true }));
app.use(cspMiddleware);

// Routes
app.use('/api/auth', authRoutes);

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
