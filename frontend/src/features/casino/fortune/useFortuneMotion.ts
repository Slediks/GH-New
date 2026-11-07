import { useEffect, useRef, useState } from 'react';
import { MOTION, sampleFlight, sampleStop, stopPlan, targetAngle } from './model';

export function useFortuneMotion(input: {
  id: string;
  phase: string;
  result?: number;
  count: number;
  animateResult?: boolean;
  onSettling: (id: string) => void;
  onLanded: (id: string) => void;
}) {
  const rotor = useRef<SVGGElement>(null);
  const latest = useRef(input);
  latest.current = input;
  const [phase, setPhase] = useState('ready');
  const [landed, setLanded] = useState<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0,
      angle = 0,
      speed = 0,
      liveStart = 0,
      base = 0,
      round = '',
      finished = '',
      status = 'ready';
    let plan: {
      motion: ReturnType<typeof stopPlan>;
      start: number;
      id: string;
      index: number;
    } | null = null;
    const stage = (value: string) => {
      if (status !== value) {
        status = value;
        setPhase(value);
      }
    };
    const tick = (now: number) => {
      const v = latest.current;
      if (!plan && round !== v.id) {
        round = v.id;
        liveStart = v.animateResult && v.result !== undefined ? now : 0;
        base = angle;
        speed = 0;
        setLanded(null);
        stage('ready');
      }
      if (
        !plan &&
        v.result !== undefined &&
        v.result >= 0 &&
        v.result < v.count &&
        finished !== v.id &&
        (!liveStart ||
          now - liveStart >= (v.animateResult ? 2.8 : MOTION.acceleration) * 1000 ||
          media.matches)
      ) {
        const target = targetAngle(v.result, v.count, v.id);
        v.onSettling(v.id);
        if (!liveStart || media.matches) {
          // A restored result has no in-progress trajectory to interrupt.
          angle = target;
          finished = v.id;
          setLanded({ id: v.id, index: v.result });
          stage('result');
          v.onLanded(v.id);
        } else {
          plan = {
            motion: stopPlan(angle, Math.max(speed, 1), target),
            start: now,
            id: v.id,
            index: v.result,
          };
          stage('braking');
        }
      }
      if (plan) {
        const elapsed = media.matches ? plan.motion.seconds : (now - plan.start) / 1000;
        const pose = sampleStop(plan.motion, elapsed);
        angle = pose.angle;
        speed = pose.speed;
        if (elapsed >= plan.motion.seconds) {
          finished = plan.id;
          setLanded({ id: plan.id, index: plan.index });
          stage('result');
          latest.current.onLanded(plan.id);
          plan = null;
        }
      } else if (
        (v.phase === 'live' || (liveStart && v.result !== undefined)) &&
        finished !== v.id
      ) {
        if (!liveStart) {
          liveStart = now;
          base = angle;
        }
        const elapsed = (now - liveStart) / 1000;
        const pose = sampleFlight(elapsed);
        if (!media.matches) {
          angle = base + pose.angle;
          speed = pose.speed;
        }
        stage(elapsed < MOTION.acceleration ? 'accelerating' : 'spinning');
      }
      if (rotor.current) {
        rotor.current.setAttribute('transform', `rotate(${angle})`);
        rotor.current.dataset.angle = String(angle);
        rotor.current.dataset.speed = String(speed);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return { rotor, phase, landed };
}
