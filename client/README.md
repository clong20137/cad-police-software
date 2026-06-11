# CAD Client

React + TypeScript frontend for CAD Police Software with role-based UI rendering and JWT authentication.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file (optional):
```env
REACT_APP_API_URL=http://localhost:5001/api
REACT_APP_GOOGLE_MAPS_API_KEY=
REACT_APP_GOOGLE_API_KEY=
REACT_APP_SOCKET_URL=http://localhost:5001
```

## Scripts

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run lint` - Lint TypeScript/TSX files

## Architecture

### Context

- `AuthContext` - Global authentication state with login/logout/permissions

### Services

- `authClient` - API client with JWT interceptors and auto token refresh

### Components

- `LoginPage` - Login form with demo credentials
- `Dashboard` - Protected dashboard with role-based UI rendering
- `Protected` - Component wrapper for permission/role-based rendering

## Security Features

- Automatic JWT token refresh
- Secure token storage
- Protected routes with authentication checks
- Role-based UI rendering
- Permission-based component visibility

## Demo Credentials

Login with:
- **Admin**: admin@dispatch.local / admin123
- **Dispatcher**: dispatcher@dispatch.local / dispatcher123
- **Officer**: officer@dispatch.local / officer123

## Usage Examples

### Using Protected Component

```tsx
<Protected permission="view_dispatch">
  <DispatchView />
</Protected>

<Protected role={UserRole.ADMIN}>
  <AdminPanel />
</Protected>

<RoleBasedRender roles={[UserRole.DISPATCHER, UserRole.ADMIN]}>
  <DispatcherTools />
</RoleBasedRender>
```

### Using Auth Context

```tsx
import { useAuth } from './context/AuthContext';

export const MyComponent: React.FC = () => {
  const { user, permissions, hasPermission, logout } = useAuth();
  
  if (!hasPermission('view_dispatch')) {
    return <div>No access</div>;
  }
  
  return <div>Welcome {user?.name}</div>;
};
```

## Styling

- CSS Modules for component-scoped styling
- Responsive design with flexbox
- Gradient backgrounds and modern UI

## Environment Variables

```env
REACT_APP_API_URL=http://localhost:5001/api
```

Default: `http://<current-browser-host>:5001/api`. On the host machine this is usually `http://localhost:5001/api`; from another device on the same network it becomes something like `http://192.168.1.25:5001/api`.

`REACT_APP_GOOGLE_API_KEY` or `REACT_APP_GOOGLE_MAPS_API_KEY` enables the dashboard Google Map. Without it, the dashboard shows a local coordinate map fallback. `REACT_APP_SOCKET_URL` controls the live unit WebSocket endpoint.

## Runtime API Config

Preferred setup is through `.env` before building:

```env
REACT_APP_API_URL=http://localhost:5001/api
REACT_APP_SOCKET_URL=http://localhost:5001
REACT_APP_GOOGLE_API_KEY=
```

Then run `npm run build` and deploy the build folder to IIS.

For a deployed build, edit `build/config.js` without rebuilding:

```js
window.CAD_CONFIG = {
  API_URL: 'https://api.your-domain.com/api',
  SOCKET_URL: 'https://api.your-domain.com',
  GOOGLE_API_KEY: ''
};
```

Blank values are ignored. If `SOCKET_URL` is blank, it is derived from `API_URL` by removing the trailing `/api`.

## Local Network Access

To let other devices on the same network connect to your local CAD server:

1. Start the backend and LAN-visible frontend from the repo root:
```bash
npm run dev:lan
```

2. Set the backend allowed frontend origins in `server/.env`:
```env
FRONTEND_URLS=http://localhost:3000,http://192.168.1.25:3000
```

3. Open the app from another device using the host computer IP:
```text
http://192.168.1.25:3000
```

The client automatically points API and socket traffic to `http://192.168.1.25:5001` unless `REACT_APP_API_URL`, `REACT_APP_SOCKET_URL`, or `config.js` overrides it.

## TypeScript

- Strict mode enabled
- Full type safety for React components
- Shared types from `cad-shared` package

## CSP Headers

The backend sets strict CSP headers. Inline scripts/styles must use nonces generated server-side.

## Production Build

```bash
npm run build
```

Creates optimized production build in `build/` directory. Deploy this to a static hosting service or CDN.

## Known Limitations

- Demo users stored in-memory (resets on server restart)
- No real database integration yet
- UI is basic functional implementation

## Future Enhancements

- Real-time dispatch updates with WebSockets
- Map view for officer locations
- Incident tracking and reporting
- Database integration
- Mobile app
- Real-time notifications
