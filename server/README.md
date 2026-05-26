# CAD Server

Express.js TypeScript backend for CAD Police Software with JWT authentication and role-based access control.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled server
- `npm run lint` - Lint TypeScript files

## Architecture

### Middleware

- `authMiddleware` - Validates JWT tokens
- `requirePermission` - Checks user permissions
- `cspMiddleware` - Sets Content Security Policy headers
- `errorHandler` - Centralized error handling

### Services

- `AuthService` - User authentication and token management

### Routes

- `/api/auth/login` - POST - User login
- `/api/auth/refresh` - POST - Refresh access token
- `/api/auth/logout` - POST - User logout (protected)
- `/api/auth/me` - GET - Get current user (protected)
- `/api/auth/users` - GET - List users (admin only)

## Security

- JWT tokens with 15-minute expiration
- Refresh tokens with 7-day expiration
- Refresh token rotation on each use
- Server-side permission enforcement
- Strict CSP headers
- CORS protection
- Input validation

## Environment Variables

```env
BACKEND_PORT=5001
JWT_SECRET=your-super-secret-jwt-key-change-in-production
REFRESH_TOKEN_SECRET=your-super-secret-refresh-token-key-change-in-production
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

## Demo Users

For development, these users are pre-created:

| Email | Password | Role |
|-------|----------|------|
| admin@dispatch.local | admin123 | Admin |
| dispatcher@dispatch.local | dispatcher123 | Dispatcher |
| officer@dispatch.local | officer123 | Officer |

## API Examples

### Login

```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dispatch.local","password":"admin123"}'
```

### Refresh Token

```bash
curl -X POST http://localhost:5001/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<token>"}'
```

### Get Current User

```bash
curl -X GET http://localhost:5001/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```
