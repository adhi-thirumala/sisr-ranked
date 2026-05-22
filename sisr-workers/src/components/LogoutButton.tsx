import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

export function LogoutButton({ className }: { className?: string }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    try {
      setIsLoggingOut(true);
      await logout();
      navigate('/', { replace: true });
    } catch (error) {
      setIsLoggingOut(false);
      console.error('Logout failed', error);
    }
  }

  return (
    <Button size="sm" variant="ghost" className={className} disabled={isLoggingOut} onClick={() => void handleLogout()}>
      {isLoggingOut ? 'Logging out...' : 'Logout'}
    </Button>
  );
}
