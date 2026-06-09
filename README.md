# Blueline CAD

A comprehensive Computer-Aided Dispatch (CAD) system for law enforcement built with React, TypeScript, Node.js, and Express.

## Overview

This full-stack application provides a secure platform for police dispatch operations with:

- **Secure Authentication**: JWT + Refresh Token architecture with automatic token rotation
- **Role-Based Access Control (RBAC)**: Dispatcher, Officer, Admin, and Viewer roles
- **Permission-Based Authorization**: Server-side enforcement of fine-grained permissions
- **Strict Security**: Content Security Policy (CSP) headers, CORS protection, HTTPS support
- **Real-time UI Rendering**: Frontend components render based on user role and permissions
- **TypeScript Everywhere**: Full type safety across frontend and backend

## Project Structure

```
├── server/          # Node.js + Express backend
├── client/          # React + TypeScript frontend
├── shared/          # Shared types and utilities
├── package.json     # Root workspace config
└── .github/         # Development guidelines
```

## Prerequisites

- Node.js 18+ and npm 9+
- Windows, macOS, or Linux

## Quick Start

### 1. Install Dependencies

```bash
npm run install-all
```

This installs dependencies for root, server, and client.

### 2. Setup Environment

Create `.env` file in the `server/` directory:

```bash
cp server/.env.example server/.env
```

### 3. Start Development

```bash
npm run dev
```

This runs both frontend and backend concurrently:
- Frontend: http://localhost:3000
- Backend: http://localhost:5001

### Demo Credentials

- **Admin**: admin@dispatch.local / admin123
- **Dispatcher**: dispatcher@dispatch.local / dispatcher123
- **Officer**: officer@dispatch.local / officer123

## Architecture

### Authentication Flow

1. User logs in with email/password
2. Backend validates and issues JWT access token (15 min) + refresh token (7 days)
3. Frontend stores tokens and uses access token for API requests
4. When access token expires, refresh token automatically obtains new pair
5. Refresh tokens rotate on each use
6. Server validates JWT and enforces permissions on every protected request

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| **Admin** | All permissions |
| **Dispatcher** | View/Create/Update dispatch, View officers, View reports |
| **Officer** | View dispatch, View officers |
| **Viewer** | View dispatch, View officers |

### Security Features

- **CSP Headers**: Strict Content-Security-Policy on all responses
- **CORS**: Configured for frontend origin only
- **JWT**: Cryptographically signed tokens with expiration
- **Refresh Token Rotation**: New refresh token on each use
- **Server-Side Authorization**: Permissions validated on backend for every request
- **HTTPS Ready**: Configured for production HTTPS deployment

## Development

### Run Only Backend

```bash
npm run server
# or
cd server && npm run dev
```

### Run Only Frontend

```bash
npm run client
# or
cd client && npm start
```

### Build for Production

```bash
npm run build
```

This builds both frontend and backend.

### Linting

```bash
npm run lint
```

## Key Files

### Server

- `server/src/index.ts` - Express app setup
- `server/src/middleware/auth.ts` - JWT and CSP middleware
- `server/src/services/AuthService.ts` - Authentication logic
- `server/src/routes/auth.ts` - Auth endpoints

### Client

- `client/src/App.tsx` - Main app with routing
- `client/src/context/AuthContext.tsx` - Auth state management
- `client/src/services/authClient.ts` - API client with JWT interceptors
- `client/src/components/Protected.tsx` - Role-based UI components
- `client/src/components/Dashboard.tsx` - Main dashboard

### Shared

- `shared/src/types/index.ts` - TypeScript types for auth, users, permissions

## API Endpoints

### Authentication

- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user (protected)
- `GET /api/auth/users` - List users (admin only)

## Development Guidelines

1. **Always validate permissions server-side** - Never trust frontend authorization
2. **Use TypeScript strict mode** - Enable in all tsconfig.json files
3. **Protect all sensitive routes** - Use `authMiddleware` and `requirePermission`
4. **Handle token expiration** - Frontend automatically refreshes tokens
5. **Add proper error handling** - Use errorHandler middleware
6. **Keep secrets in .env** - Never commit secrets to repository

## Deployment

### Environment Variables

Set these in production:

```env
NODE_ENV=production
BACKEND_PORT=5001
JWT_SECRET=your-very-secure-random-secret
REFRESH_TOKEN_SECRET=your-very-secure-random-secret
FRONTEND_URL=https://yourdomain.com
```

### HTTPS

- Configure your reverse proxy (nginx, CloudFront, etc.) for HTTPS
- Update `FRONTEND_URL` environment variable
- CSP headers will enforce HTTPS in production

### Database

Currently uses in-memory storage. Integrate with MongoDB, PostgreSQL, or other databases:

1. Update `AuthService.ts` to use database client
2. Create migration scripts
3. Add connection pooling
4. Use transactions for critical operations

## Security Considerations

- **Store tokens securely** - HttpOnly cookies or secure storage (avoid localStorage for tokens)
- **Rotate secrets** - Regularly rotate JWT secrets in production
- **Monitor logs** - Track failed login attempts and unauthorized access
- **Update dependencies** - Keep npm packages current
- **Rate limiting** - Add rate limiting to login and token endpoints in production
- **HTTPS only** - Never use HTTP in production
- **CSRF protection** - Add CSRF tokens for state-changing operations

## Support

For issues and questions, refer to:
- `.github/copilot-instructions.md` - Development guidelines
- Backend TypeScript strict mode configuration
- React Router v6 documentation
- Express.js security documentation

## License

MIT
