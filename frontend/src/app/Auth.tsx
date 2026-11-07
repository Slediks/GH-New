import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from '../shared/api';
import type { User } from '../shared/types';
interface AuthValue {
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  login: (login: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  async function refresh() {
    try {
      const result = await api<{ user: User | null; csrf: string }>('/auth/session');
      setUser(result.user);
      setCsrf(result.csrf);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function login(login: string) {
    const result = await api<{ user: User; csrf: string }>('/auth/login', 'POST', { login });
    setUser(result.user);
    setCsrf(result.csrf);
  }
  async function logout() {
    await api('/auth/logout', 'POST', {});
    setUser(null);
    await refresh();
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [user?.id]);
  return (
    <Context.Provider value={{ user, loading, error, refresh, login, logout }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing AuthProvider');
  return value;
}
