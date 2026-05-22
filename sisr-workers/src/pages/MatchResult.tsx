import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Clock01Icon, Diamond, Trophy } from '@hugeicons/core-free-icons';
import { LogoutButton } from '@/components/LogoutButton';
import { MinecraftHead } from '@/components/MinecraftHead';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  apiJson,
  applyMatchRealtimeMessage,
  copyToClipboard,
  formatItemName,
  formatRating,
  type MatchPlayer,
  type MatchState,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMatchSocket } from '@/lib/ws';

export default function MatchResult() {
  const { id } = useParams();
  const { user } = useAuth();
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const socketStatus = useMatchSocket(id ?? null, (message) => {
    setMatchState((current) => applyMatchRealtimeMessage(current, message));
  });

  useEffect(() => {
    if (!id) return;
    let active = true;
    setIsLoading(true);
    setError(null);

    apiJson<MatchState>(`/api/match/${id}/state`)
      .then((state) => {
        if (active) setMatchState(state);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Failed to load match');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  const winner = matchState?.winner ? matchState.players.find((player) => player.uuid === matchState.winner) : null;
  const youWon = Boolean(user && matchState?.winner === user.uuid);

  async function copyServerAddress(): Promise<void> {
    if (!matchState?.serverAddress) return;
    const ok = await copyToClipboard(matchState.serverAddress);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-6 py-8 lg:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_34%)]" />

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

      <section className="relative z-10 mx-auto flex max-w-5xl flex-col gap-6 py-10">
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={matchState?.winner ? 'default' : 'secondary'}>{matchState?.winner ? 'Final' : 'Live match'}</Badge>
              <Badge variant="outline">Socket: {socketStatus}</Badge>
              {matchState?.ready ? <Badge variant="outline">Ready</Badge> : null}
            </div>
            <CardTitle className="mt-3 text-3xl font-bold tracking-tight">Match Result</CardTitle>
            <CardDescription>
              {matchState ? `Target item: ${formatItemName(matchState.targetItem)}` : 'Loading match state from the Match Durable Object.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
            {isLoading && !matchState ? <p className="rounded-lg border border-border/60 bg-muted/10 p-3 text-sm text-muted-foreground">Loading match...</p> : null}

            {matchState ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                <div className="rounded-2xl border border-border/60 bg-muted/10 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
                      {matchState.winner ? (
                        <HugeiconsIcon icon={Trophy} size={26} className="text-primary" />
                      ) : (
                        <HugeiconsIcon icon={Clock01Icon} size={26} className="text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="text-xl font-semibold">
                        {matchState.winner ? `${winner?.name ?? 'Winner'} claimed ${formatItemName(matchState.targetItem)}` : 'Race in progress'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">
                    {matchState.winner
                      ? youWon
                        ? 'You won this ranked race. ELO is reflected below.'
                        : 'The match result was decided by the Match DO claim arbiter.'
                      : 'Keep Minecraft open. This page will update when a winner is broadcast.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-muted/10 p-5">
                  <p className="text-sm text-muted-foreground">Server address</p>
                  <code className="mt-2 block rounded-lg bg-background px-3 py-2 text-sm">{matchState.serverAddress}</code>
                  <Button variant="outline" className="mt-3" onClick={() => void copyServerAddress()}>
                    {copied ? 'Copied' : 'Copy address'}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {matchState ? <PlayersCard matchState={matchState} /> : null}
      </section>
    </main>
  );
}

function PlayersCard({ matchState }: { matchState: MatchState }) {
  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>Players</CardTitle>
        <CardDescription>Starting and final ELO for this 1v1.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {matchState.players.map((player) => (
          <PlayerResult key={player.uuid} player={player} matchState={matchState} />
        ))}
      </CardContent>
      <CardFooter>
        <Button asChild variant="ghost">
          <Link to="/queue">Queue another match</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function PlayerResult({ player, matchState }: { player: MatchPlayer; matchState: MatchState }) {
  const change = matchState.eloChanges?.[player.uuid];
  return (
    <Link to={`/profile/${player.uuid}`} className="rounded-2xl border border-border/60 bg-muted/10 p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MinecraftHead uuid={player.uuid} className="size-12 rounded-xl" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{player.name ?? 'Unknown player'}</p>
            <p className="text-xs text-muted-foreground">{player.uuid === matchState.winner ? 'Winner' : matchState.winner ? 'Runner-up' : 'Racing'}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold">{change ? formatRating(change.after) : formatRating(player.eloBefore)}</p>
          <p className="text-xs text-muted-foreground">{change ? `${change.delta >= 0 ? '+' : ''}${formatRating(change.delta)}` : 'Pending'}</p>
        </div>
      </div>
    </Link>
  );
}
