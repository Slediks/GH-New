import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

type Position = { x: number; y: number };
const storageKey = 'gamehub-route-scroll';
const currentPosition = (): Position => ({ x: window.scrollX, y: window.scrollY });
function savedPositions() {
  try {
    const entries = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as [string, Position][];
    return new Map(
      entries.filter(
        ([key, p]) => typeof key === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    );
  } catch {
    return new Map<string, Position>();
  }
}

/** New pages start at the top; POP restores an entry, including async content. */
export function RouteScroll() {
  const location = useLocation();
  const navigation = useNavigationType();
  // Native document navigations may all have key="default"; include the URL.
  const entryKey = `${location.key}:${location.pathname}${location.search}${location.hash}`;
  const positions = useRef(savedPositions());
  const activeKey = useRef(entryKey);
  const previous = useRef<typeof location | null>(null);

  useLayoutEffect(() => {
    const original = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const remember = () => positions.current.set(activeKey.current, currentPosition());
    const persist = () => {
      remember();
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...positions.current].slice(-100)));
      } catch {
        /* Storage may be disabled. */
      }
    };
    window.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      history.scrollRestoration = original;
      window.removeEventListener('scroll', remember);
      window.removeEventListener('pagehide', persist);
    };
  }, []);

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = location;
    activeKey.current = entryKey;
    const saved = navigation === 'POP' ? positions.current.get(entryKey) : undefined;
    // Query-only changes keep their current position; a different page resets it.
    const target =
      saved ?? (old?.pathname === location.pathname ? currentPosition() : { x: 0, y: 0 });
    let anchor = '';
    try {
      anchor = decodeURIComponent(location.hash.slice(1));
    } catch {
      anchor = location.hash.slice(1);
    }
    let stopped = false;
    const stop = () => {
      stopped = true;
      resize.disconnect();
      mutations.disconnect();
      clearTimeout(timeout);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('keydown', stop);
    };
    const restore = () => {
      if (stopped) return;
      if (anchor && (!saved || !old || old.key === location.key)) {
        const element = document.getElementById(anchor) ?? document.getElementsByName(anchor)[0];
        if (!element) return;
        element.scrollIntoView({ behavior: 'instant', block: 'start' });
        stop();
      } else {
        window.scrollTo({ left: target.x, top: target.y, behavior: 'instant' });
        if (Math.abs(window.scrollY - target.y) <= 1) stop();
      }
    };
    const resize = new ResizeObserver(restore);
    const mutations = new MutationObserver(restore);
    const timeout = window.setTimeout(stop, 10000);
    resize.observe(document.body);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('pointerdown', stop, { passive: true });
    window.addEventListener('keydown', stop);
    restore();
    if (positions.current.size > 100)
      positions.current.delete(positions.current.keys().next().value!);
    return stop;
  }, [location, navigation, entryKey]);
  return null;
}
