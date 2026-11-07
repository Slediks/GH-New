import { useEffect, useRef, useState } from 'react';

/** Layout only: the pitch, betting form and socket owner remain mounted. */
export function useMatchFullscreen(matchId?: number) {
  const [open, setOpen] = useState(false),
    [comments, setComments] = useState(false);
  const [betting, setBetting] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
    setComments(false);
    setBetting(false);
  }, [matchId]);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    trigger.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'button, input, select, summary, a[href], [tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.offsetParent !== null && !el.hasAttribute('disabled'));
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      trigger.current?.focus();
    };
  }, [open]);
  return {
    open,
    comments,
    setComments,
    betting,
    setBetting,
    root,
    trigger,
    toggle: () => setOpen((v) => !v),
  };
}
