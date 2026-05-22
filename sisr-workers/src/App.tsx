import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { AuthProvider, useAuth } from './lib/auth';
import { QueueProvider } from './lib/queue';
import Landing from './pages/Landing';
import Login from './pages/Login';
import MatchResult from './pages/MatchResult';
import Profile from './pages/Profile';
import Queue from './pages/Queue';

function App() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <BrowserRouter>
        <AuthProvider>
          <QueueProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/queue"
                element={
                  <RequireAuth>
                    <Queue />
                  </RequireAuth>
                }
              />
              <Route path="/profile/:uuid" element={<Profile />} />
              <Route
                path="/match/:id"
                element={
                  <RequireAuth>
                    <MatchResult />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </QueueProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <Card className="w-full max-w-sm border-border/50 bg-card/70 backdrop-blur-sm">
          <CardContent className="p-6 text-center text-muted-foreground">Checking your session...</CardContent>
        </Card>
      </main>
    );
  }

  if (status === 'anonymous') {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return children;
}

export default App;
