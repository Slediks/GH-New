import { useEffect, useState } from 'react';
import './decisionTimer.css';

// These windows mirror rounds.py. They scale the bar only; the supplied
// server deadline, never this duration, determines the remaining time.
export const DECISION_WINDOWS: Record<string, number> = {
  blackjack: 60,
  video_poker: 120,
  mines: 120,
  higher_lower: 120,
  ladder: 120,
  penalty: 120,
  slots_lock: 120,
  slots_streak: 120,
};

export function DecisionTimer({
  deadline,
  duration,
  label,
  ownTurn = true,
}: {
  deadline: number;
  duration: number;
  label: string;
  ownTurn?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let frame = 0,
      lastUpdate = 0;
    const tick = (time: number) => {
      if (time - lastUpdate >= 50) {
        setNow(Date.now());
        lastUpdate = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [deadline]);
  const remaining = Math.max(0, deadline - now / 1000);
  return (
    <div
      className={`decision-timer ${ownTurn ? 'your-turn' : ''} ${remaining <= 5 ? 'urgent' : ''}`}
    >
      <strong>{label}</strong>
      <span>{Math.ceil(remaining)} с</span>
      <progress
        max={duration}
        value={Math.min(duration, remaining)}
        aria-label={`Время на действие: ${label}`}
      />
      {remaining === 0 && <small>Ожидаем решение сервера</small>}
    </div>
  );
}
