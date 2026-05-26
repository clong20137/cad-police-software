# CAD Police Software - Project Structure

## Root Files
```
package.json              - Root workspace config with npm scripts
tsconfig.base.json        - Base TypeScript configuration
.gitignore               - Git ignore rules
README.md                - Main project documentation
SETUP_COMPLETE.md        - Setup completion checklist
```

## .github/ - Development Standards
```
copilot-instructions.md  - Development guidelines & rules
```

## .vscode/ - VS Code Configuration
```
tasks.json               - Build & run tasks
settings.json            - Editor settings
```

## server/ - Express Backend
```
package.json             - Server dependencies
tsconfig.json            - Server TypeScript config
.env                     - Environment variables (dev)
.env.example             - Example environment template
README.md                - Server documentation

src/
├── index.ts                    - Express app setup
├── middleware/
│   ├── auth.ts                 - JWT & CSP middleware
│   └── errorHandler.ts         - Error handling middleware
├── routes/
│   └── auth.ts                 - Authentication API routes
└── services/
    └── AuthService.ts          - Authentication business logic

dist/                    - Compiled JavaScript output
node_modules/            - npm dependencies
```

### Server Features
- ✅ JWT tokens (15m access, 7d refresh)
- ✅ Refresh token rotation
- ✅ Role-based permissions (Admin, Dispatcher, Officer, Viewer)
- ✅ Server-side permission enforcement
- ✅ Strict CSP headers
- ✅ CORS configuration
- ✅ Error handling middleware
- ✅ Demo user system (in-memory)

## client/ - React Frontend
```
package.json             - Client dependencies
tsconfig.json            - Client TypeScript config
.env.local               - Environment variables
README.md                - Client documentation

public/
└── index.html            - HTML entry point

src/
├── App.tsx                     - Main app component with routing
├── App.css                     - Global styles
├── index.tsx                   - React entry point
├── context/
│   └── AuthContext.tsx         - Global auth state management
├── services/
│   └── authClient.ts           - API client with JWT interceptors
└── components/
    ├── LoginPage.tsx           - Login form
    ├── LoginPage.module.css    - Login styles
    ├── Dashboard.tsx           - Main dashboard
    ├── Dashboard.module.css    - Dashboard styles
    └── Protected.tsx            - Role-based UI rendering

build/                   - Production build output
node_modules/            - npm dependencies
```

### Client Features
- ✅ Role-based UI rendering
- ✅ Protected routes with auth
- ✅ Automatic JWT refresh
- ✅ Secure token storage
- ✅ Permission-based component visibility
- ✅ Responsive modern design
- ✅ TypeScript strict mode

## shared/ - Shared Types
```
package.json             - Shared package config
tsconfig.json            - Shared TypeScript config
README.md                - Shared documentation

src/
├── index.ts                    - Package exports
└── types/
    └── index.ts                - All shared TypeScript types

dist/                    - Compiled type declarations
node_modules/            - npm dependencies
```

### Shared Types
- `User` - User interface with role and badge
- `UserRole` - Admin, Dispatcher, Officer, Viewer
- `AuthPayload` - JWT token payload
- `TokenPair` - Access & refresh token response
- `LoginRequest` - Login API request
- `LoginResponse` - Login API response
- `RefreshTokenRequest` - Token refresh request
- `RefreshTokenResponse` - Token refresh response
- `Permission` - Available permissions
- `ROLE_PERMISSIONS` - Role to permissions mapping

## Key Implementation Details

### Authentication Flow
1. User logs in with email/password
2. Backend validates credentials
3. Backend issues JWT access token (15m) + refresh token (7d)
4. Frontend stores tokens securely
5. Frontend includes access token in all API requests
6. When token expires, frontend auto-refreshes using refresh token
7. Refresh token rotates - new pair issued each refresh
8. Server validates JWT signature and permissions on protected routes

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| **Admin** | All 9 permissions |
| **Dispatcher** | view_dispatch, create_dispatch, update_dispatch, view_officers, view_reports |
| **Officer** | view_dispatch, view_officers |
| **Viewer** | view_dispatch, view_officers |

### Permissions
1. `view_dispatch` - View active dispatch calls
2. `create_dispatch` - Create new dispatch
3. `update_dispatch` - Update dispatch calls
4. `delete_dispatch` - Delete dispatch calls
5. `view_officers` - View officer information
6. `update_officers` - Modify officer data
7. `manage_users` - Manage system users
8. `view_reports` - Access reports
9. `manage_system` - System administration

### Security Features
- **JWT Authentication** - Cryptographically signed tokens
- **Refresh Token Rotation** - New token on each refresh
- **Server-Side Enforcement** - All permissions validated server-side
- **Strict CSP Headers** - Content Security Policy headers on all responses
- **CORS Protection** - Configured for frontend origin only
- **Type Safety** - TypeScript strict mode throughout
- **Error Handling** - Centralized middleware error handling
- **Demo Users** - Pre-configured for testing

## Demo Users

```
Email: admin@dispatch.local
Password: admin123
Role: Admin

Email: dispatcher@dispatch.local
Password: dispatcher123
Role: Dispatcher

Email: officer@dispatch.local
Password: officer123
Role: Officer
```

## File Statistics

- **Total Files Created**: ~35
- **TypeScript Files**: ~15
- **React Components**: ~5
- **Configuration Files**: ~8
- **Documentation Files**: ~4
- **CSS Files**: ~3

## Build Status

✅ **Shared Package**: Built successfully
✅ **Server**: Built successfully (dist/ folder created)
✅ **Client**: Configured for build with react-scripts

## Next Steps for Production

1. Replace in-memory users with database
2. Set strong JWT secrets
3. Configure HTTPS/SSL
4. Add rate limiting
5. Implement audit logging
6. Add two-factor authentication
7. Set up monitoring & alerts
8. Deploy to cloud platform

## Dependencies Summary

### Backend
- express (HTTP server)
- jsonwebtoken (JWT tokens)
- cors (CORS middleware)
- bcryptjs (Password hashing)
- uuid (ID generation)
- dotenv (Environment configuration)
- TypeScript & ts-node (Type safety & development)

### Frontend
- react (UI framework)
- react-router-dom (Routing)
- axios (HTTP client)
- TypeScript & react-scripts (Build & development)

### Shared
- TypeScript (Types)

---

**Total LOC (Lines of Code)**:
- TypeScript: ~1000 lines
- CSS: ~300 lines
- JSON/Config: ~200 lines
- **Total**: ~1500 lines of production code
