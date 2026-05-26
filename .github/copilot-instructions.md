# CAD Police Software - Development Guidelines

## Project Overview
Full-stack CAD (Computer-Aided Dispatch) system for law enforcement with:
- React + TypeScript frontend with strict CSP headers and role-based UI rendering
- Node + Express + TypeScript backend with JWT + Refresh Token authentication
- Server-side permission enforcement and role-based access control

## Security Requirements
- **CSP Headers**: Strict Content Security Policy on all responses
- **Authentication**: JWT + Refresh Token architecture
- **Authorization**: Server-side permission validation on all protected routes
- **CORS**: Configured for frontend origin only
- **HTTPS**: Required in production

## Architecture
```
/server     - Express API backend
/client     - React SPA frontend
/shared     - Shared types and utilities
```

## Key Development Rules
1. All protected API endpoints must validate JWT and enforce permissions server-side
2. Frontend UI must render based on user roles, but rely on backend for actual authorization
3. TypeScript strict mode enabled everywhere
4. CSP headers configured in Express middleware
5. Refresh token rotation on each use
6. Role-based access control (RBAC) enforced on backend
7. Never trust frontend authorization - always verify server-side

## Build and Run
- **Install**: `npm install` (root) then `npm install` in /server and /client
- **Dev**: `npm run dev` (concurrent frontend + backend)
- **Build**: `npm run build` (both frontend and backend)
- **Server only**: `cd server && npm run dev`
- **Client only**: `cd client && npm start`
