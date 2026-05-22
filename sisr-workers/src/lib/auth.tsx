import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { apiJson, type AuthenticatedUser } from './api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  status: AuthStatus;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setError(null);
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.status === 401) {
      setUser(null);
      setStatus('anonymous');
      return;
    }

    if (!response.ok) {
      setUser(null);
      setStatus('anonymous');
      setError(`${response.status} ${response.statusText}`);
      return;
    }

    const data = (await response.json()) as { user: AuthenticatedUser };
    setUser(data.user);
    setStatus('authenticated');
  }

  async function logout(): Promise<void> {
    await apiJson<{ ok: true }>('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setStatus('anonymous');
  }

  useEffect(() => {
    let active = true;

    async function hydrate(): Promise<void> {
      try {
        await refresh();
      } catch (caught) {
        if (!active) return;
        setUser(null);
        setStatus('anonymous');
        setError(caught instanceof Error ? caught.message : 'Failed to load session');
      }
    }

    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  return <AuthContext.Provider value={{ user, status, error, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
