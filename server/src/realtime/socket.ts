import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { AuthService } from '../services/AuthService';
import { securityConfig } from '../config/security';

let io: Server | null = null;

export const initializeRealtime = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: {
      origin: securityConfig.frontendUrl,
      credentials: true
    }
  });

  io.on('connection', async (socket) => {
    socket.join('units');
    socket.emit('units:update', await AuthService.getTrackedUnits());
  });

  return io;
};

export const broadcastTrackedUnits = async (): Promise<void> => {
  if (!io) {
    return;
  }

  io.to('units').emit('units:update', await AuthService.getTrackedUnits());
};
