import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, UserRole, Permission, RegisterRequest } from '../types/auth';
import { authClient } from '../services/authClient';

interface AuthContextType {
  user: User | null;
  permissions: Permission[];
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (input: RegisterRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  hasRole: (role: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load auth from storage on mount
  useEffect(() => {
    const auth = authClient.getAuth();
    if (auth && authClient.isAuthenticated()) {
      setUser(auth.user);
      setPermissions(auth.permissions);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      const auth = await authClient.login(email, password);
      setUser(auth.user);
      setPermissions(auth.permissions);
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (input: RegisterRequest): Promise<boolean> => {
    try {
      setIsLoading(true);
      const auth = await authClient.register(input);
      setUser(auth.user);
      setPermissions(auth.permissions);
      return true;
    } catch (error) {
      console.error('Registration failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    await authClient.logout();
    setUser(null);
    setPermissions([]);
    setIsLoading(false);
  }, []);

  const hasPermission = useCallback((permission: Permission): boolean => {
    return permissions.includes(permission);
  }, [permissions]);

  const hasRole = useCallback((role: UserRole): boolean => {
    return user?.role === role;
  }, [user]);

  const value: AuthContextType = {
    user,
    permissions,
    isAuthenticated: authClient.isAuthenticated(),
    isLoading,
    login,
    register,
    logout,
    hasPermission,
    hasRole
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
