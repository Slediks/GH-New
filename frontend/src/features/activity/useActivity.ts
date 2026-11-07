import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';

/** Only server elapsed time is credited. The browser reports eligibility and new input. */
export function useActivity(sessionId: string | null) {
  const [active, setActive] = useState(false),
    [reason, setReason] = useState('Начисление приостановлено');
  const lastInput = useRef(0),
    inputSeen = useRef(false);
  function signal() {
    lastInput.current = Date.now();
    inputSeen.current = true;
  }
  useEffect(() => {
    if (!sessionId) return;
    let sequence = 0,
      stopped = false;
    const abort = new AbortController();
    ['pointerdown', 'keydown', 'touchstart'].forEach((type) =>
      window.addEventListener(type, signal, { signal: abort.signal, passive: true }),
    );
    async function beat() {
      const eligible =
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        Date.now() - lastInput.current < 120000;
      const seen = inputSeen.current;
      inputSeen.current = false;
      try {
        const result = await api<{ active: boolean; reason?: string }>(
          '/activity/heartbeat',
          'POST',
          { session_id: sessionId, sequence: ++sequence, eligible, input_seen: seen },
        );
        if (!stopped) {
          setActive(result.active);
          setReason(
            result.reason ??
              (result.active ? 'Очки начисляются' : 'Нажмите, чтобы продолжить начисление'),
          );
        }
      } catch {
        if (!stopped) {
          setActive(false);
          setReason('Нет связи с сервером');
        }
      }
    }
    const pause = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) {
        setActive(false);
        void beat();
      }
    };
    document.addEventListener('visibilitychange', pause, { signal: abort.signal });
    window.addEventListener('blur', pause, { signal: abort.signal });
    void beat();
    const timer = setInterval(() => void beat(), 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      abort.abort();
      void api('/activity/heartbeat', 'POST', {
        session_id: sessionId,
        sequence: ++sequence,
        eligible: false,
        input_seen: false,
      }).catch(() => {});
    };
  }, [sessionId]);
  return { active, reason, signal };
}
