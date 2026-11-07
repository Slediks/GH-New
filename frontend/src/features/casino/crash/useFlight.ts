import { useLayoutEffect, useRef } from 'react';
import { flightPath, flightPoint } from './model';
import { FlightTimeline } from './timeline';

function paint(
  value: number,
  craft: SVGGElement | null,
  curve: SVGPolylineElement | null,
  trail: SVGPolylineElement | null,
) {
  const point = flightPoint(value);
  craft?.setAttribute('transform', `translate(${point.x},${point.y})`);
  craft?.setAttribute('data-x', String(point.x));
  craft?.setAttribute('data-y', String(point.y));
  const path = flightPath(value);
  curve?.setAttribute('points', path);
  trail?.setAttribute('points', path);
}

export function useFlight(phase: string, multiplier: number, serverTime: number) {
  const craft = useRef<SVGGElement>(null);
  const curve = useRef<SVGPolylineElement>(null);
  const trail = useRef<SVGPolylineElement>(null);
  const timeline = useRef(new FlightTimeline());
  const reduced = useRef(false);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const model = timeline.current;
    model.receive(phase, multiplier, serverTime * 1000);
    paint(
      reduced.current ? model.snapToLatest() : model.value,
      craft.current,
      curve.current,
      trail.current,
    );
  }, [phase, multiplier, serverTime]);

  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let alive = true;
    const tick = (now: number) => {
      if (!alive) return;
      paint(timeline.current.frame(now), craft.current, curve.current, trail.current);
      frame.current = requestAnimationFrame(tick);
    };
    const update = () => {
      cancelAnimationFrame(frame.current);
      timeline.current.resetFrameClock();
      reduced.current = media.matches;
      if (media.matches)
        paint(timeline.current.snapToLatest(), craft.current, curve.current, trail.current);
      else if (phase === 'live') frame.current = requestAnimationFrame(tick);
    };
    update();
    media.addEventListener('change', update);
    return () => {
      alive = false;
      cancelAnimationFrame(frame.current);
      media.removeEventListener('change', update);
    };
  }, [phase]);
  return { craft, curve, trail };
}
