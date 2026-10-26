import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, type Envelope } from './api';

export interface AdminUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  role: 'customer' | 'manager' | 'admin';
  avatar?: string;
}

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const result = await api.get<AdminUser>('/public/auth/me');
      if (result.data.role === 'admin' || result.data.role === 'manager') {
        setUser(result.data);
      } else {
        setUser(null);
        setToken(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ token: string; user: AdminUser }>('/public/auth/login', { email, password });
    if (result.data.user.role !== 'admin' && result.data.user.role !== 'manager') {
      throw new Error('This account does not have admin access.');
    }
    setToken(result.data.token);
    setUser(result.data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/public/auth/logout');
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export type { Envelope };
