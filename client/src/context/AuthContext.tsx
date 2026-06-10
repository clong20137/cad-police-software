import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, UserRole, Permission, RegisterRequest, TwoFactorChallengeResponse } from '../types/auth';
import { authClient } from '../services/authClient';

export type AuthFlowResult =
  | { ok: true; backupCodes?: string[] }
  | { ok: false; challenge?: TwoFactorChallengeResponse };

interface AuthContextType {
  user: User | null;
  permissions: Permission[];
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthFlowResult>;
  register: (input: RegisterRequest) => Promise<AuthFlowResult>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<AuthFlowResult>;
  refreshAuth: () => void;
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

  const login = useCallback(async (email: string, password: string): Promise<AuthFlowResult> => {
    try {
      setIsLoading(true);
      const auth = await authClient.login(email, password);
      if ('twoFactorRequired' in auth) {
        return { ok: false, challenge: auth };
      }
      setUser(auth.user);
      setPermissions(auth.permissions);
      return { ok: true };
    } catch (error) {
      console.error('Login failed:', error);
      return { ok: false };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (input: RegisterRequest): Promise<AuthFlowResult> => {
    try {
      setIsLoading(true);
      const auth = await authClient.register(input);
      if ('twoFactorRequired' in auth) {
        return { ok: false, challenge: auth };
      }
      setUser(auth.user);
      setPermissions(auth.permissions);
      return { ok: true };
    } catch (error) {
      console.error('Registration failed:', error);
      return { ok: false };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const verifyTwoFactor = useCallback(async (challengeToken: string, code: string): Promise<AuthFlowResult> => {
    try {
      setIsLoading(true);
      const auth = await authClient.verifyTwoFactor({ challengeToken, code });
      setUser(auth.user);
      setPermissions(auth.permissions);
      return { ok: true, backupCodes: auth.backupCodes };
    } catch (error) {
      console.error('Two-factor verification failed:', error);
      return { ok: false };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshAuth = useCallback((): void => {
    const auth = authClient.getAuth();
    if (auth && authClient.isAuthenticated()) {
      setUser(auth.user);
      setPermissions(auth.permissions);
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
    verifyTwoFactor,
    refreshAuth,
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
