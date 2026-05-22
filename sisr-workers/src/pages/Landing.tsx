import { useEffect, useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowRight01Icon, Clock01Icon, Command, Diamond, Flash, Trophy, User } from '@hugeicons/core-free-icons';
import { LogoutButton } from '@/components/LogoutButton';
import { MinecraftHead } from '@/components/MinecraftHead';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { apiJson, formatRating, startMicrosoftSignIn, winRate, type LeaderboardEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function FloatingParticle({ delay, size, x, y }: { delay: number; size: number; x: number; y: number }) {
  return (
    <div
      className="absolute rounded-full bg-primary/20 animate-pulse"
      style={{
        width: size,
        height: size,
        left: `${x}%`,
        top: `${y}%`,
        animationDelay: `${delay}s`,
        animationDuration: `${3 + Math.random() * 4}s`,
      }}
    />
  );
}

const particles = Array.from({ length: 20 }, (_, index) => ({
  delay: index * 0.3,
  size: 2 + Math.random() * 4,
  x: Math.random() * 100,
  y: Math.random() * 100,
}));

export default function Landing() {
  const { status, user } = useAuth();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(true);

  const isAuthenticated = status === 'authenticated';

  async function signIn() {
    try {
      setAuthError(null);
      setIsSigningIn(true);
      await startMicrosoftSignIn('/queue');
    } catch (error) {
      setIsSigningIn(false);
      setAuthError(error instanceof Error ? error.message : 'Failed to start Microsoft sign in');
    }
  }

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => setMousePos({ x: event.clientX, y: event.clientY });
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    let active = true;
    setIsLeaderboardLoading(true);
    setLeaderboardError(null);

    apiJson<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard')
      .then((data) => {
        if (active) setLeaderboard(data.leaderboard);
      })
      .catch((error) => {
        if (active) setLeaderboardError(error instanceof Error ? error.message : 'Failed to load leaderboard');
      })
      .finally(() => {
        if (active) setIsLeaderboardLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, hsl(var(--primary) / 0.15), transparent 40%)`,
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {particles.map((particle, index) => (
        <FloatingParticle key={index} {...particle} />
      ))}

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 lg:px-12">
        <Link to="/" className="flex items-center gap-2">
          <HugeiconsIcon icon={Diamond} size={28} className="text-primary" />
          <span className="text-xl font-bold tracking-tight">SISRanked</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <a href="#leaderboard" className="hover:text-foreground">Leaderboard</a>
          {isAuthenticated && user ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`/profile/${user.uuid}`}>{user.name}</Link>
            </Button>
          ) : null}
          {isAuthenticated ? (
            <>
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/queue">
                  Queue <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                </Link>
              </Button>
              <LogoutButton />
            </>
          ) : (
            <Button size="sm" className="gap-1.5" disabled={isSigningIn || status === 'loading'} onClick={() => void signIn()}>
              {isSigningIn ? 'Signing In...' : 'Sign In'} <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
            </Button>
          )}
        </div>
      </nav>

      <section className="relative z-10 flex flex-col items-center px-6 pt-20 pb-32 text-center lg:px-12">
        <Badge variant="outline" className="mb-6 gap-1.5 border-primary/30 px-3 py-1 text-xs font-medium text-primary">
          <HugeiconsIcon icon={Flash} size={14} />
          1v1 Competitive Minecraft
        </Badge>

        <h1 className="max-w-4xl text-5xl font-bold tracking-tight sm:text-7xl lg:text-8xl">
          <span className="bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">Race for the</span>
          <br />
          <span className="bg-gradient-to-r from-primary via-emerald-400 to-primary bg-clip-text text-transparent">Random Item</span>
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          Drop into a fresh world. Race your opponent. Be the first to find the target item.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          {isAuthenticated ? (
            <Button asChild size="lg" className="gap-2 px-8 text-base">
              <Link to="/queue">
                Start Racing
                <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
              </Link>
            </Button>
          ) : (
            <Button size="lg" className="gap-2 px-8 text-base" disabled={isSigningIn || status === 'loading'} onClick={() => void signIn()}>
              {isSigningIn ? 'Signing In...' : 'Start Racing'}
              <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
            </Button>
          )}
          <Button asChild size="lg" variant="outline" className="gap-2 px-8 text-base">
            <a href="#leaderboard">View Leaderboard</a>
          </Button>
        </div>
        {authError ? <p className="mt-4 text-sm text-destructive">{authError}</p> : null}

        <div className="mt-20 animate-bounce">
          <HugeiconsIcon icon={ArrowDown01Icon} size={24} className="text-muted-foreground" />
        </div>
      </section>

      <section className="relative z-10 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How It Works</h2>
            <p className="mt-3 text-muted-foreground">Queue. Spin. Win. It is that fast.</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            <FeatureCard icon={Command} title="Queue" description="Sign in with Microsoft, enter ranked queue, and get matched in your ELO bracket." />
            <FeatureCard icon={Diamond} title="Spin" description="Both players see the same target item reveal while the match container boots." />
            <FeatureCard icon={Trophy} title="Win" description="Connect through Velocity and be the first player to pick up the target item." />
          </div>
        </div>
      </section>

      <section id="leaderboard" className="relative z-10 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Leaderboard</h2>
            <p className="mt-3 text-muted-foreground">The top racers loaded from the Worker leaderboard endpoint.</p>
          </div>

          <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
            <div className="divide-y divide-border/50">
              {isLeaderboardLoading ? <LeaderboardMessage message="Loading ranked players..." /> : null}
              {leaderboardError ? <LeaderboardMessage message={leaderboardError} destructive /> : null}
              {!isLeaderboardLoading && !leaderboardError && leaderboard.length === 0 ? <LeaderboardMessage message="No ranked players yet. Be the first on the board." /> : null}
              {leaderboard.slice(0, 10).map((player, index) => (
                <LeaderboardRow key={player.uuid} player={player} rank={index + 1} />
              ))}
            </div>
          </Card>

          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <p className="text-xs text-muted-foreground">Showing {leaderboard.length > 0 ? Math.min(leaderboard.length, 10) : 0} of {leaderboard.length} cached entries.</p>
            <Button asChild variant="ghost" className="gap-1.5 text-muted-foreground">
              <Link to={isAuthenticated ? '/queue' : '/login'}>
                {isAuthenticated ? 'Queue into ranked' : 'Sign in to join'}
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Separator className="mx-auto max-w-6xl opacity-30" />

      <section className="relative z-10 px-6 py-24 text-center lg:px-12">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to Race?</h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
          Sign in with your Microsoft account and jump into the queue. Your first match starts in seconds.
        </p>
        {isAuthenticated ? (
          <Button asChild size="lg" className="mt-8 gap-2 px-8 text-base">
            <Link to="/queue">
              Get Started
              <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
            </Link>
          </Button>
        ) : (
          <Button size="lg" className="mt-8 gap-2 px-8 text-base" disabled={isSigningIn || status === 'loading'} onClick={() => void signIn()}>
            {isSigningIn ? 'Signing In...' : 'Get Started'}
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
          </Button>
        )}
      </section>

      <footer className="relative z-10 border-t border-border/50 px-6 py-8 text-center text-sm text-muted-foreground lg:px-12">
        <div className="flex items-center justify-center gap-2">
          <HugeiconsIcon icon={Diamond} size={16} className="text-primary" />
          <span className="font-semibold">SISRanked</span>
        </div>
        <p className="mt-2">
          Built by{' '}
          <u>
            <a href="https://adhithirumala.com" target="_blank" rel="noopener noreferrer">
              Adhi Thirumala
            </a>
          </u>
          . License: AGPL v3.{' '}
          <u>
            <a href="https://github.com/adhi-thirumala/sisr-ranked">Source.</a>
          </u>
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: ComponentProps<typeof HugeiconsIcon>['icon']; title: string; description: string }) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="flex flex-col items-center p-8 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
          <HugeiconsIcon icon={icon} size={28} className="text-primary" />
        </div>
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function LeaderboardRow({ player, rank }: { player: LeaderboardEntry; rank: number }) {
  return (
    <Link to={`/profile/${player.uuid}`} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/30">
      <div className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-bold">{rank}</div>
      <MinecraftHead uuid={player.uuid} className="size-9 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{player.name}</div>
        <div className="text-xs text-muted-foreground">
          {player.wins}W / {player.matches - player.wins}L · {winRate(player)} win rate
        </div>
      </div>
      <div className="text-right">
        <div className="font-bold text-primary">{formatRating(player.elo)}</div>
        <div className="text-xs text-muted-foreground">ELO</div>
      </div>
    </Link>
  );
}

function LeaderboardMessage({ message, destructive = false }: { message: string; destructive?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-6 py-5 text-sm text-muted-foreground">
      <HugeiconsIcon icon={destructive ? User : Clock01Icon} size={18} className={destructive ? 'text-destructive' : 'text-primary'} />
      <span className={destructive ? 'text-destructive' : undefined}>{message}</span>
    </div>
  );
}
