import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Diamond } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { startMicrosoftSignIn } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Login() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const params = new URLSearchParams(location.search);
  const redirectTo = safeRedirect(params.get('redirect'));
  const oauthError = params.get('error');
  const [error, setError] = useState<string | null>(oauthError);
  const [isStarting, setIsStarting] = useState(false);

  async function beginSignIn(): Promise<void> {
    try {
      setError(null);
      setIsStarting(true);
      await startMicrosoftSignIn(redirectTo);
    } catch (caught) {
      setIsStarting(false);
      setError(caught instanceof Error ? caught.message : 'Failed to start Microsoft sign in');
    }
  }

  useEffect(() => {
    if (status === 'authenticated') navigate(redirectTo, { replace: true });
  }, [status, navigate, redirectTo]);

  useEffect(() => {
    if (status !== 'anonymous' || oauthError || startedRef.current) return;
    startedRef.current = true;
    void beginSignIn();
  }, [status, oauthError]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.22),transparent_35%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,4rem_4rem,4rem_4rem]" />

      <Card className="relative w-full max-w-md border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <HugeiconsIcon icon={Diamond} size={28} className="text-primary" />
          </div>
          <Badge variant="outline" className="mx-auto border-primary/30 text-primary">
            Microsoft + Minecraft identity
          </Badge>
          <CardTitle className="text-2xl font-bold tracking-tight">Sign in to race</CardTitle>
          <CardDescription>
            We use Microsoft OAuth to verify the Java Minecraft UUID that Velocity will see in-game.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
            After Microsoft redirects back, the Worker sets an HTTP-only session cookie and sends you to the queue.
          </div>
          {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button className="w-full gap-2" size="lg" disabled={isStarting || status === 'loading'} onClick={() => void beginSignIn()}>
            {isStarting || (status === 'anonymous' && !oauthError) ? 'Opening Microsoft...' : 'Continue with Microsoft'}
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">Back to landing</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/queue';
  return value;
}
