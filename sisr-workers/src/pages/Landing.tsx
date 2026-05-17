import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Trophy, Diamond, Clock01Icon, User, Star, Flash, ArrowRight01Icon, Command, ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { QuestionMarkCircledIcon, QuestionMarkIcon } from '@radix-ui/react-icons';

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

const particles = Array.from({ length: 20 }, (_, i) => ({
  delay: i * 0.3,
  size: 2 + Math.random() * 4,
  x: Math.random() * 100,
  y: Math.random() * 100,
}));

const leaderboard = [
  { rank: 1, name: 'DiamondHunter', elo: 1842, wins: 47, matches: 52 },
  { rank: 2, name: 'SpeedRunner_X', elo: 1791, wins: 38, matches: 45 },
  { rank: 3, name: 'BlockRacer', elo: 1756, wins: 41, matches: 50 },
  { rank: 4, name: 'EnderMiner', elo: 1723, wins: 29, matches: 38 },
  { rank: 5, name: 'CraftKing', elo: 1698, wins: 33, matches: 44 },
];

export default function Landing() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Animated background gradient */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, hsl(var(--primary) / 0.15), transparent 40%)`,
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {/* Floating particles */}
      {particles.map((p, i) => (
        <FloatingParticle key={i} {...p} />
      ))}

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 lg:px-12">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Diamond} size={28} className="text-primary" />
          <span className="text-xl font-bold tracking-tight">SISRanked</span>
        </div>
        <div className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <span>Leaderboard</span>
          <Button size="sm" className="gap-1.5">
            Sign In <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
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
          <Button size="lg" className="gap-2 px-8 text-base">
            Start Racing
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
          </Button>
          <Button size="lg" variant="outline" className="gap-2 px-8 text-base">
            View Leaderboard
          </Button>
        </div>

        {/* Scroll indicator */}
        <div className="mt-20 animate-bounce">
          <HugeiconsIcon icon={ArrowDown01Icon} size={24} className="text-muted-foreground" />
        </div>
      </section>

      {/* How It Works */}
      <section className="relative z-10 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How It Works</h2>
            <p className="mt-3 text-muted-foreground">Queue. Spin. Win. It is that fast.</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center p-8 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                  <HugeiconsIcon icon={Command} size={28} className="text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Queue</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Sign in with your Microsoft account and hit queue. Matchmaking finds an opponent in your ELO bracket instantly.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center p-8 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                  <HugeiconsIcon icon={Diamond} size={28} className="text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Spin</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Watch the wheel reveal your target item; join a fresh Minecraft world for your match.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center p-8 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                  <HugeiconsIcon icon={Trophy} size={28} className="text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Win</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Connect and race. First to pick up the target item wins.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Leaderboard Preview */}
      <section className="relative z-10 px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Leaderboard</h2>
            <p className="mt-3 text-muted-foreground">The top racers climbing the ranks right now.</p>
          </div>

          <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
            <div className="divide-y divide-border/50">
              {leaderboard.map((player, idx) => (
                <div key={idx} className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/30">
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted font-bold text-sm">{player.rank}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{player.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {player.wins}W / {player.matches - player.wins}L
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-primary">{player.elo}</div>
                    <div className="text-xs text-muted-foreground">ELO</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-6 text-center">
            <Button variant="ghost" className="gap-1.5 text-muted-foreground">
              View Full Leaderboard
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
            </Button>
          </div>
        </div>
      </section>

      <Separator className="mx-auto max-w-6xl opacity-30" />

      {/* CTA Footer */}
      <section className="relative z-10 px-6 py-24 text-center lg:px-12">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready to Race?</h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
          Sign in with your Microsoft account and jump into the queue. Your first match starts in seconds.
        </p>
        <Button size="lg" className="mt-8 gap-2 px-8 text-base">
          Get Started
          <HugeiconsIcon icon={ArrowRight01Icon} size={18} />
        </Button>
      </section>

      {/* Footer */}
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
            {' '}
            <a href="https://github.com/adhi-thirumala/sisr-ranked">Source.</a>
          </u>
        </p>
      </footer>
    </div>
  );
}
