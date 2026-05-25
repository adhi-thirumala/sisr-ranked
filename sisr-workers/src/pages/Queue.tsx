import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Clock01Icon, Diamond, Flash, Trophy, User } from '@hugeicons/core-free-icons';
import { LogoutButton } from '@/components/LogoutButton';
import { MinecraftHead } from '@/components/MinecraftHead';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  copyToClipboard,
  formatItemName,
  formatRating,
  type MatchFoundMessage,
  type MatchPlayer,
  type MatchState,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { RevealConfig } from '@/lib/items';
import { useQueue } from '@/lib/queue-context';
import type { QueueSocketStatus } from '@/lib/ws';

export default function Queue() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const {
    queueStatus,
    queuedSince,
    match,
    matchState,
    reveal,
    revealComplete,
    matchSocketStatus,
    isForfeitingMatch,
    joinQueue,
    leaveQueue,
    queueAgain: queueAgainAction,
    forfeitMatch,
    markRevealComplete,
  } = useQueue();
  const [forfeitError, setForfeitError] = useState<string | null>(null);
  const queuedSeconds = useElapsedSeconds(queueStatus.phase === 'connecting' || queueStatus.phase === 'queued', queuedSince);

  const opponent = match?.players.find((player) => player.uuid !== user?.uuid) ?? null;
  const winner = matchState?.winner ? matchState.players.find((player) => player.uuid === matchState.winner) : null;
  const youWon = Boolean(user && matchState?.winner === user.uuid);

  async function copyServerAddress(): Promise<void> {
    if (!matchState?.serverAddress && !match?.serverAddress) return;
    const ok = await copyToClipboard(matchState?.serverAddress ?? match?.serverAddress ?? '');
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function queueAgain(): void {
    queueAgainAction();
    setCopied(false);
    setForfeitError(null);
  }

  async function requestForfeit(): Promise<void> {
    if (!match || matchState?.winner || matchState?.aborted) return;
    if (!window.confirm('Forfeit this match? This will count as a ranked loss.')) return;

    setForfeitError(null);
    try {
      await forfeitMatch();
    } catch (error) {
      setForfeitError(error instanceof Error ? error.message : 'Failed to forfeit match');
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-6 py-8 lg:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary)/0.18),transparent_30%),radial-gradient(circle_at_80%_10%,hsl(var(--chart-2)/0.12),transparent_28%)]" />

      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <HugeiconsIcon icon={Diamond} size={26} className="text-primary" />
          <span className="text-lg font-bold tracking-tight">SISRanked</span>
        </Link>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild variant="ghost" size="sm">
              <Link to={`/profile/${user.uuid}`}>{user.name}</Link>
            </Button>
          ) : null}
          <Badge variant={matchState?.aborted ? 'destructive' : matchState?.winner ? 'default' : match ? 'secondary' : 'outline'}>
            {matchState?.aborted ? 'Match aborted' : matchState?.winner ? 'Match complete' : match ? 'Match found' : 'Ranked queue'}
          </Badge>
          <LogoutButton />
        </div>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-6xl gap-6 py-10 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="flex flex-col gap-6">
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <HugeiconsIcon icon={Flash} size={20} className="text-primary" />
                Queue Status
              </CardTitle>
              <CardDescription>1v1 ranked, matched by your current ELO bracket.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <QueueStatusPanel status={queueStatus} queuedSeconds={queuedSeconds} hasMatch={Boolean(match)} />
              <QueueActionButton status={queueStatus} hasMatch={Boolean(match)} onJoin={joinQueue} onLeave={leaveQueue} />
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {user ? <PlayerCard player={{ uuid: user.uuid, name: user.name, eloBefore: user.elo }} label="You" /> : null}
                {opponent ? <PlayerCard player={opponent} label="Opponent" /> : <WaitingOpponent />}
              </div>
            </CardContent>
          </Card>

          {match && matchState ? (
            <ConnectPanel
              match={match}
              matchState={matchState}
              revealComplete={revealComplete}
              copied={copied}
              matchSocketStatus={matchSocketStatus}
              canForfeit={!matchState.winner && !matchState.aborted}
              isForfeiting={isForfeitingMatch}
              forfeitError={forfeitError}
              onCopy={() => void copyServerAddress()}
              onForfeit={() => void requestForfeit()}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-bold tracking-tight">Target Reveal</CardTitle>
              <CardDescription>Items flash quickly, then slow down until the target locks in.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-5">
              {match && reveal ? (
                <ItemReveal reveal={reveal} complete={revealComplete} onComplete={markRevealComplete} />
              ) : (
                <div className="flex min-h-[420px] w-full flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border/70 bg-muted/10 text-center">
                  <div className="flex size-16 items-center justify-center rounded-3xl bg-primary/10">
                    <HugeiconsIcon icon={Diamond} size={34} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Ready for item reveal</p>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                      Join the queue when you are ready. The reveal starts after a match forms.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {matchState?.winner ? (
            <PostMatchPanel matchState={matchState} winner={winner} youWon={youWon} onQueueAgain={queueAgain} />
          ) : null}

          {matchState?.aborted && !matchState.winner ? <AbortedMatchPanel matchState={matchState} onQueueAgain={queueAgain} /> : null}
        </div>
      </section>
    </main>
  );
}

function QueueStatusPanel({ status, queuedSeconds, hasMatch }: { status: QueueSocketStatus; queuedSeconds: number; hasMatch: boolean }) {
  if (hasMatch) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
        <p className="font-semibold text-primary">Match found</p>
        <p className="mt-1 text-sm text-muted-foreground">The queue socket handed off to your match socket.</p>
      </div>
    );
  }

  if (status.phase === 'error') {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
        <p className="font-semibold text-destructive">Queue interrupted</p>
        <p className="mt-1 text-sm text-muted-foreground">{status.error}</p>
      </div>
    );
  }

  if (status.phase === 'idle') {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/15 p-4">
        <p className="font-semibold">Not in queue</p>
        <p className="mt-1 text-sm text-muted-foreground">Press Join Queue when you are ready to find a ranked opponent.</p>
      </div>
    );
  }

  const position = status.phase === 'queued' && status.position ? `Position ${status.position}` : 'Finding bracket';

  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/15 p-4">
      <div>
        <p className="font-semibold">{status.phase === 'connecting' ? 'Connecting...' : position}</p>
        <p className="mt-1 text-sm text-muted-foreground">Waited {queuedSeconds}s</p>
      </div>
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10">
        <HugeiconsIcon icon={Clock01Icon} size={22} className="animate-pulse text-primary" />
      </div>
    </div>
  );
}

function QueueActionButton({
  status,
  hasMatch,
  onJoin,
  onLeave,
}: {
  status: QueueSocketStatus;
  hasMatch: boolean;
  onJoin: () => void;
  onLeave: () => void;
}) {
  if (hasMatch) {
    return (
      <Button className="w-full" disabled>
        Match Found
      </Button>
    );
  }

  if (status.phase === 'connecting' || status.phase === 'queued') {
    return (
      <Button className="w-full" variant="destructive" onClick={onLeave}>
        Leave Queue
      </Button>
    );
  }

  return (
    <Button className="w-full" onClick={onJoin}>
      Join Queue
    </Button>
  );
}

function ItemReveal({ reveal, complete, onComplete }: { reveal: RevealConfig; complete: boolean; onComplete: () => void }) {
  const [index, setIndex] = useState(complete ? reveal.sequence.length - 1 : 0);

  useEffect(() => {
    if (complete) {
      setIndex(reveal.sequence.length - 1);
      return;
    }

    let current = 0;
    let timer: number | undefined;
    const lastIndex = reveal.sequence.length - 1;

    function tick() {
      setIndex(current);
      if (current >= lastIndex) {
        onComplete();
        return;
      }

      const progress = current / lastIndex;
      const delay = 42 + progress * progress * 320;
      current += 1;
      timer = window.setTimeout(tick, delay);
    }

    tick();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [complete, onComplete, reveal]);

  const currentItem = reveal.sequence[index] ?? reveal.targetItem;
  const previousItem = reveal.sequence[Math.max(0, index - 1)] ?? currentItem;
  const nextItem = reveal.sequence[Math.min(reveal.sequence.length - 1, index + 1)] ?? currentItem;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="relative flex min-h-[420px] w-full max-w-[560px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-border/50 bg-background/60 p-6 shadow-2xl shadow-primary/10">
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="grid w-full max-w-md grid-cols-[0.8fr_1.2fr_0.8fr] items-center gap-3">
          <RevealItem item={previousItem} muted />
          <RevealItem item={currentItem} active complete={complete} />
          <RevealItem item={nextItem} muted />
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {reveal.sequence.slice(Math.max(0, index - 5), index + 1).map((item, itemIndex) => (
            <span key={`${item}-${itemIndex}-${index}`} className="rounded-full bg-muted/40 px-2 py-1 text-[0.625rem] text-muted-foreground">
              {formatItemName(item)}
            </span>
          ))}
        </div>
      </div>
      <Badge variant={complete ? 'default' : 'outline'} className="h-7 px-3 text-sm">
        {complete ? `Find: ${formatItemName(reveal.targetItem)}` : 'Revealing target item...'}
      </Badge>
    </div>
  );
}

function RevealItem({ item, active = false, complete = false, muted = false }: { item: string; active?: boolean; complete?: boolean; muted?: boolean }) {
  return (
    <div
      className={[
        'flex min-h-32 flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200',
        active ? 'scale-105 border-primary/50 bg-primary/10 shadow-lg shadow-primary/10' : 'border-border/60 bg-muted/10',
        muted ? 'scale-90 opacity-45' : '',
        complete && active ? 'ring-2 ring-primary/40' : '',
      ].join(' ')}
    >
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Item</p>
      <p className="mt-3 text-lg font-bold tracking-tight sm:text-2xl">{formatItemName(item)}</p>
    </div>
  );
}

function PlayerCard({ player, label }: { player: MatchPlayer; label: string }) {
  return (
    <Link to={`/profile/${player.uuid}`} className="rounded-xl border border-border/60 bg-muted/10 p-3 transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <MinecraftHead uuid={player.uuid} className="size-10 rounded-lg" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-semibold">{player.name ?? 'Unknown player'}</p>
          <p className="text-xs text-primary">{formatRating(player.eloBefore)} ELO</p>
        </div>
      </div>
    </Link>
  );
}

function WaitingOpponent() {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted/40">
          <HugeiconsIcon icon={User} size={20} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Opponent</p>
          <p className="font-semibold">Searching...</p>
          <p className="text-xs text-muted-foreground">Adjacent brackets widen after 30s.</p>
        </div>
      </div>
    </div>
  );
}

function ConnectPanel({
  match,
  matchState,
  revealComplete,
  copied,
  matchSocketStatus,
  canForfeit,
  isForfeiting,
  forfeitError,
  onCopy,
  onForfeit,
}: {
  match: MatchFoundMessage;
  matchState: MatchState;
  revealComplete: boolean;
  copied: boolean;
  matchSocketStatus: string;
  canForfeit: boolean;
  isForfeiting: boolean;
  forfeitError: string | null;
  onCopy: () => void;
  onForfeit: () => void;
}) {
  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={ArrowRight01Icon} size={18} className="text-primary" />
          {matchState.ready ? 'Connect Now' : 'Preparing Server'}
        </CardTitle>
        <CardDescription>
          {matchState.ready ? 'Use the Velocity address below.' : 'Wait for the server-ready signal before joining Velocity.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={matchState.ready ? 'default' : 'secondary'}>{matchState.ready ? 'Server ready' : 'Server warming up'}</Badge>
          <Badge variant="outline">Match socket: {matchSocketStatus}</Badge>
          <Badge variant={revealComplete ? 'default' : 'outline'}>{revealComplete ? 'Target revealed' : 'Reveal in progress'}</Badge>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Minecraft server</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{matchState.serverAddress || match.serverAddress}</code>
            <Button variant="outline" onClick={onCopy} disabled={!matchState.ready}>{copied ? 'Copied' : matchState.ready ? 'Copy address' : 'Waiting for server'}</Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Target item: <span className="font-medium text-foreground">{formatItemName(match.targetItem)}</span>. Do not connect until the
          server status changes to ready; Velocity routes only after the Match DO broadcasts readiness.
        </p>
        {forfeitError ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{forfeitError}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button asChild variant="ghost">
          <Link to={`/match/${match.matchId}`}>Open match page</Link>
        </Button>
        {canForfeit ? (
          <Button variant="destructive" onClick={onForfeit} disabled={isForfeiting}>
            {isForfeiting ? 'Forfeiting...' : 'Forfeit match'}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function AbortedMatchPanel({ matchState, onQueueAgain }: { matchState: MatchState; onQueueAgain: () => void }) {
  return (
    <Card className="border-destructive/30 bg-card/90 shadow-2xl shadow-destructive/10">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight text-destructive">Match ended</CardTitle>
        <CardDescription>
          This match was cleaned up and will not count. Reason: {matchState.abortReason ?? 'server error'}.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button onClick={onQueueAgain}>Queue again</Button>
      </CardFooter>
    </Card>
  );
}

function PostMatchPanel({
  matchState,
  winner,
  youWon,
  onQueueAgain,
}: {
  matchState: MatchState;
  winner: MatchPlayer | null | undefined;
  youWon: boolean;
  onQueueAgain: () => void;
}) {
  const forfeiter = matchState.forfeited ? matchState.players.find((player) => player.uuid === matchState.forfeited) : null;
  return (
    <Card className="border-primary/30 bg-card/90 shadow-2xl shadow-primary/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl">
          <HugeiconsIcon icon={Trophy} size={24} className="text-primary" />
          {forfeiter ? (youWon ? 'Opponent forfeited' : 'You forfeited') : youWon ? 'You won the race' : 'Race complete'}
        </CardTitle>
        <CardDescription>
          {forfeiter
            ? `${forfeiter.name ?? 'A player'} forfeited. ${winner?.name ?? 'The opponent'} wins this ranked match.`
            : `${winner?.name ?? 'The winner'} claimed ${formatItemName(matchState.targetItem)} first.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {matchState.players.map((player) => {
          const change = matchState.eloChanges?.[player.uuid];
          return (
            <div key={player.uuid} className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-center gap-3">
                <MinecraftHead uuid={player.uuid} className="size-9 rounded-lg" />
                <div>
                  <p className="font-semibold">{player.name ?? 'Unknown player'}</p>
                  <p className="text-xs text-muted-foreground">{player.uuid === matchState.winner ? 'Winner' : 'Runner-up'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold">{change ? formatRating(change.after) : formatRating(player.eloBefore)}</p>
                <p className="text-xs text-muted-foreground">{change ? `${change.delta >= 0 ? '+' : ''}${formatRating(change.delta)} ELO` : 'ELO pending'}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={onQueueAgain}>Queue again</Button>
        <Button asChild variant="outline">
          <Link to={`/match/${matchState.matchId}`}>Result page</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function useElapsedSeconds(active: boolean, startedAt: number | null): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) {
      setSeconds(0);
      return;
    }

    setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  return seconds;
}
