import { useEffect, useRef, useState } from 'react';
import {
  BALL_SPEED,
  INITIAL_POSE,
  sampleStop,
  stopPlan,
  WHEEL_SPEED,
  type StopPlan,
} from './motion';
export function useWheelMotion(
  roundId: string,
  phase: string,
  result: number | undefined,
  onLanded: (id: string, number: number) => void,
  onSettling: (id: string) => void,
) {
  const input = useRef({ roundId, phase, result, onLanded, onSettling });
  input.current = { roundId, phase, result, onLanded, onSettling };
  const [pose, setPose] = useState(INITIAL_POSE);
  const [landed, setLanded] = useState('');
  useEffect(() => {
    let current = { ...INITIAL_POSE },
      previous = performance.now(),
      frame = 0;
    let finished = '',
      plan: { value: StopPlan; start: number; id: string; number: number } | null = null;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const value = input.current;
      if (!plan && value.result !== undefined && finished !== value.roundId) {
        plan = {
          value: stopPlan(current, value.result),
          start: now,
          id: value.roundId,
          number: value.result,
        };
        setLanded('');
        value.onSettling(value.roundId);
      }
      if (plan) {
        const elapsed = preference.matches ? plan.value.seconds : (now - plan.start) / 1000;
        current = sampleStop(plan.value, elapsed);
        if (elapsed >= plan.value.seconds) {
          finished = plan.id;
          setLanded(finished);
          input.current.onLanded(finished, plan.number);
          plan = null;
        }
      } else if (value.phase === 'live' && !preference.matches) {
        current = {
          wheel: current.wheel + WHEEL_SPEED * delta,
          ball: current.ball + BALL_SPEED * delta,
          radius: Math.min(136, current.radius + 20 * delta),
        };
        setLanded('');
      }
      setPose(current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return { pose, landed: landed === roundId };
}
