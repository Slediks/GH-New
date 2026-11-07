import { useEffect, useRef, type ReactNode } from 'react';
import './wallet.css';

export function CasinoDialog({
  label,
  close,
  blocked = false,
  children,
}: {
  label: string;
  close: () => void;
  blocked?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="casino-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) close();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !blocked) close();
      }}
    >
      <div className="casino-dialog-content">{children}</div>
    </dialog>
  );
}
