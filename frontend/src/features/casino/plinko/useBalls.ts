import { useEffect, useState } from 'react';
import { ballFrame } from './motion';
import type { PlinkoBall } from './model';
export function useBalls(balls: PlinkoBall[], animate: boolean, onFinished: () => void) {
  const [elapsed, setElapsed] = useState(0);
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!balls.length) return;
    if (!animate || reduced) {
      onFinished();
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const passed = now - start;
      setElapsed(passed);
      if (balls.every((ball) => ballFrame(ball, passed).done)) onFinished();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [balls, animate, onFinished, reduced]);
  return balls.map((ball) => ballFrame(ball, elapsed, !animate || reduced));
}
