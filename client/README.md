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

Default: `http://localhost:5001/api`

`REACT_APP_GOOGLE_API_KEY` or `REACT_APP_GOOGLE_MAPS_API_KEY` enables the dashboard Google Map. Without it, the dashboard shows a local coordinate map fallback. `REACT_APP_SOCKET_URL` controls the live unit WebSocket endpoint.

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
