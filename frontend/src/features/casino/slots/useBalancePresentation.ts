import { useCallback, useRef, useState } from 'react';

/** A display-only snapshot. Financial actions always use the server wallet. */
export function useBalancePresentation<T>(server: T | null, reload: () => Promise<void>) {
  const latest = useRef({ server, reload });
  latest.current = { server, reload };
  const sequence = useRef(0);
  const [held, setHeld] = useState<{ id: number; snapshot: T | null } | null>(null);
  const begin = useCallback(() => {
    const id = ++sequence.current;
    setHeld({ id, snapshot: latest.current.server });
    let release: Promise<void> | undefined;
    return () => {
      // Refresh at reveal time: exchange or another device may have changed funds.
      release ??= latest.current.reload().finally(() => {
        setHeld((current) => (current?.id === id ? null : current));
      });
      return release;
    };
  }, []);
  return { displayed: held ? held.snapshot : server, hidden: !!held, begin };
}
