import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Permission, UserRole } from 'cad-shared';

interface ProtectedProps {
  children: React.ReactNode;
  permission?: Permission;
  role?: UserRole;
  fallback?: React.ReactNode;
}

export const Protected: React.FC<ProtectedProps> = ({
  children,
  permission,
  role,
  fallback = null
}) => {
  const { hasPermission, hasRole, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <>{fallback || <div>Not authenticated</div>}</>;
  }

  if (permission && !hasPermission(permission)) {
    return <>{fallback || <div>Insufficient permissions</div>}</>;
  }

  if (role && !hasRole(role)) {
    return <>{fallback || <div>Insufficient role</div>}</>;
  }

  return <>{children}</>;
};

export const RoleBasedRender: React.FC<{
  children: React.ReactNode;
  roles: UserRole[];
  fallback?: React.ReactNode;
}> = ({ children, roles, fallback = null }) => {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
