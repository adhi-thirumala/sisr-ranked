import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Diamond, Trophy, User } from '@hugeicons/core-free-icons';
import { LogoutButton } from '@/components/LogoutButton';
import { MinecraftHead } from '@/components/MinecraftHead';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { apiJson, formatRating, winRate, type LeaderboardEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Profile() {
  const { uuid } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState<LeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) return;
    let active = true;
    setIsLoading(true);
    setError(null);

    apiJson<{ profile: LeaderboardEntry }>(`/api/profile/${uuid}`)
      .then((data) => {
        if (active) setProfile(data.profile);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Failed to load profile');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [uuid]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-6 py-8 lg:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_32%)]" />

      <nav className="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <HugeiconsIcon icon={Diamond} size={26} className="text-primary" />
          <span className="text-lg font-bold tracking-tight">SISRanked</span>
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link to="/queue">
              Queue
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </Link>
          </Button>
          {user ? <LogoutButton /> : null}
        </div>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-5xl gap-6 py-10 lg:grid-cols-[0.75fr_1.25fr]">
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="items-center text-center">
            {profile ? <MinecraftHead uuid={profile.uuid} className="size-24 rounded-3xl" /> : <ProfileAvatarPlaceholder />}
            <CardTitle className="text-2xl font-bold tracking-tight">{profile?.name ?? (isLoading ? 'Loading profile...' : 'Player profile')}</CardTitle>
            <CardDescription>Verified Java Minecraft profile</CardDescription>
            {user?.uuid === profile?.uuid ? <Badge>You</Badge> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-center">
              <Stat label="ELO" value={profile ? formatRating(profile.elo) : '--'} />
              <Stat label="Win Rate" value={profile ? winRate(profile) : '--'} />
              <Stat label="Wins" value={profile ? profile.wins.toString() : '--'} />
              <Stat label="Matches" value={profile ? profile.matches.toString() : '--'} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <HugeiconsIcon icon={Trophy} size={20} className="text-primary" />
              Ranked Snapshot
            </CardTitle>
            <CardDescription>Persistent rating and record from completed 1v1 races.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border/60 bg-muted/10 p-5">
              <p className="text-sm text-muted-foreground">Current rating</p>
              <p className="mt-2 text-5xl font-bold tracking-tight text-primary">{profile ? formatRating(profile.elo) : '--'}</p>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                ELO updates are written by the Match Durable Object after the first valid claim wins. The leaderboard cache refreshes after match completion.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-muted/10 p-5">
                <p className="text-sm text-muted-foreground">Record</p>
                <p className="mt-2 text-2xl font-semibold">
                  {profile ? `${profile.wins}W / ${profile.matches - profile.wins}L` : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/10 p-5">
                <p className="text-sm text-muted-foreground">Account</p>
                <p className="mt-2 text-sm font-medium">Minecraft identity verified</p>
              </div>
            </div>

            {!profile && !isLoading && !error ? (
              <p className="rounded-lg border border-border/60 bg-muted/10 p-3 text-sm text-muted-foreground">No profile was found.</p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function ProfileAvatarPlaceholder() {
  return (
    <div className="flex size-24 items-center justify-center rounded-3xl bg-muted/40">
      <HugeiconsIcon icon={User} size={34} className="text-muted-foreground" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
