import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserRole } from './types/auth';
import { SessionLockGuard } from './components/common/SessionLockGuard';
import { APP_NAME } from './constants/branding';

const LoginPage = React.lazy(() => import('./components/LoginPage').then((module) => ({ default: module.LoginPage })));
const Dashboard = React.lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })));
const AdminConfigurationPage = React.lazy(() =>
  import('./components/AdminConfigurationPage').then((module) => ({ default: module.AdminConfigurationPage }))
);
const OfficerDashboard = React.lazy(() =>
  import('./components/OfficerDashboard').then((module) => ({ default: module.OfficerDashboard }))
);

const AppLoading: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-cad-panel text-sm font-medium text-slate-600 dark:bg-gray-950 dark:text-gray-300">
    Loading {APP_NAME}...
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode; allowedRoles?: UserRole[] }> = ({ children, allowedRoles }) => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <AppLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === UserRole.OFFICER ? '/officer' : '/dashboard'} replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  const basename = process.env.PUBLIC_URL || '/';

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <SessionLockGuard>
          <Suspense fallback={<AppLoading />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.DISPATCHER]}>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                    <Navigate to="/admin/configuration" replace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/configuration"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                    <AdminConfigurationPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/officer"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.OFFICER]}>
                    <OfficerDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<RoleHome />} />
            </Routes>
          </Suspense>
        </SessionLockGuard>
      </AuthProvider>
    </BrowserRouter>
  );
};

const RoleHome: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={user?.role === UserRole.OFFICER ? '/officer' : '/dashboard'} replace />;
};

export default App;
