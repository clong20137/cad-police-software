import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { AuthService } from '../services/AuthService';
import { IncidentService } from '../services/IncidentService';
import { securityConfig } from '../config/security';
import { ChatMessage } from '../types/auth';
import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/auth';

let io: Server | null = null;
const onlineUsers = new Map<string, number>();
const UNIT_RELIABILITY_BROADCAST_MS = 15000;

export const initializeRealtime = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: {
      origin: securityConfig.frontendUrls,
      credentials: true
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token || typeof token !== 'string') {
      next();
      return;
    }

    try {
      const user = jwt.verify(token, securityConfig.jwtSecret) as AuthPayload;
      socket.data.userId = user.id;
      socket.data.role = user.role;
      next();
    } catch {
      next();
    }
  });

  io.on('connection', async (socket) => {
    socket.join('units');
    socket.join('incidents');
    if (socket.data.role) {
      socket.join(`role:${socket.data.role}`);
    }
    if (socket.data.userId) {
      socket.join(`user:${socket.data.userId}`);
      onlineUsers.set(socket.data.userId, (onlineUsers.get(socket.data.userId) || 0) + 1);
      await AuthService.touchLastSeen(socket.data.userId);
      await broadcastPresence();
    }
    socket.emit('units:update', await AuthService.getTrackedUnits());
    socket.emit('incidents:update', await IncidentService.getActiveIncidents());
    socket.emit('realtime:ready', {
      serverTime: new Date().toISOString(),
      onlineUserIds: Array.from(onlineUsers.keys())
    });

    socket.on('client:resync', async (_payload: { reason?: string } = {}) => {
      await AuthService.clearExpiredTrackedUnits();
      socket.emit('units:update', await AuthService.getTrackedUnits());
      socket.emit('incidents:update', await IncidentService.getActiveIncidents());
      socket.emit('presence:update', {
        onlineUserIds: Array.from(onlineUsers.keys()),
        users: await AuthService.getUsers()
      });
      socket.emit('realtime:resynced', {
        serverTime: new Date().toISOString()
      });
    });

    socket.on('disconnect', async () => {
      if (!socket.data.userId) {
        return;
      }

      const count = Math.max((onlineUsers.get(socket.data.userId) || 1) - 1, 0);
      if (count === 0) {
        onlineUsers.delete(socket.data.userId);
        await AuthService.touchLastSeen(socket.data.userId);
      } else {
        onlineUsers.set(socket.data.userId, count);
      }
      await broadcastPresence();
    });
  });

  const reliabilityTimer = setInterval(async () => {
    await AuthService.clearExpiredTrackedUnits();
    await broadcastTrackedUnits();
  }, UNIT_RELIABILITY_BROADCAST_MS);
  reliabilityTimer.unref();

  return io;
};

export const broadcastMessage = (message: ChatMessage): void => {
  if (!io) {
    return;
  }

  io.to(`user:${message.senderId}`).emit('message:new', message);
  io.to(`user:${message.recipientId}`).emit('message:new', message);
};

export const broadcastMessageRead = (readerId: string, senderId: string, messageIds: string[]): void => {
  if (!io || messageIds.length === 0) {
    return;
  }

  io.to(`user:${readerId}`).emit('message:read', { readerId, senderId, messageIds });
  io.to(`user:${senderId}`).emit('message:read', { readerId, senderId, messageIds });
};

export const broadcastMessageUpdated = (message: ChatMessage): void => {
  if (!io) {
    return;
  }

  io.to(`user:${message.senderId}`).emit('message:update', message);
  io.to(`user:${message.recipientId}`).emit('message:update', message);
};

export const broadcastMessageDeleted = (actorId: string, otherUserId: string, messageIds: string[]): void => {
  if (!io || messageIds.length === 0) {
    return;
  }

  io.to(`user:${actorId}`).emit('message:deleted', { actorId, otherUserId, messageIds });
};

export const broadcastMessageTyping = (actorId: string, recipientId: string, isTyping: boolean, name: string): void => {
  if (!io) {
    return;
  }

  io.to(`user:${recipientId}`).emit('message:typing', {
    actorId,
    typingThreadId: actorId,
    name,
    isTyping
  });
};

export const broadcastPresence = async (): Promise<void> => {
  if (!io) {
    return;
  }

  io.emit('presence:update', {
    onlineUserIds: Array.from(onlineUsers.keys()),
    users: await AuthService.getUsers()
  });
};

export const broadcastTrackedUnits = async (): Promise<void> => {
  if (!io) {
    return;
  }

  io.to('units').emit('units:update', await AuthService.getTrackedUnits());
};

export const broadcastIncidents = async (): Promise<void> => {
  if (!io) {
    return;
  }

  io.to('incidents').emit('incidents:update', await IncidentService.getActiveIncidents());
};

export const broadcastOfficerAssignment = async (officerId: string): Promise<void> => {
  if (!io) {
    return;
  }

  io.to(`user:${officerId}`).emit('assignment:changed', {
    officerId,
    serverTime: new Date().toISOString()
  });
};

export const broadcastUrgentAlerts = (recipientIds?: string[]): void => {
  if (!io) {
    return;
  }

  if (!recipientIds || recipientIds.length === 0) {
    io.emit('urgent-alerts:update', { serverTime: new Date().toISOString() });
    return;
  }

  Array.from(new Set(recipientIds.filter(Boolean))).forEach((recipientId) => {
    io?.to(`user:${recipientId}`).emit('urgent-alerts:update', { serverTime: new Date().toISOString() });
  });
};
