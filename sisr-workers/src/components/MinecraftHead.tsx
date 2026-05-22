import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { User } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

interface SkinResponse {
  skinUrl: string | null;
  model?: 'classic' | 'slim';
}

export function MinecraftHead({ uuid, className }: { uuid: string; className?: string }) {
  const [skinUrl, setSkinUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setSkinUrl(null);
    setFailed(false);

    fetch(`/api/skin/${uuid}`, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Skin lookup failed');
        return (await response.json()) as SkinResponse;
      })
      .then((data) => {
        if (active) setSkinUrl(data.skinUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [uuid]);

  if (!skinUrl || failed) {
    return (
      <div className={cn('flex size-10 items-center justify-center rounded-lg bg-muted/40', className)}>
        <HugeiconsIcon icon={User} size={18} className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('relative size-10 overflow-hidden rounded-lg bg-muted image-pixelated', className)}>
      <img src={skinUrl} alt="" className="absolute left-[-100%] top-[-100%] size-[800%] max-w-none select-none" draggable={false} />
      <img src={skinUrl} alt="" className="absolute left-[-500%] top-[-100%] size-[800%] max-w-none select-none" draggable={false} />
    </div>
  );
}
