import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
const message = 'Покинуть активный матч? Игра продолжится без вас.';
export function useMatchLeaveGuard(active: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (document.pointerLockElement) document.exitPointerLock();
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
  return () => !active || window.confirm(message);
}
