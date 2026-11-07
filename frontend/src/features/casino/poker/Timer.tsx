import { useEffect, useState } from 'react';
export function Timer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil(deadline - now / 1000));
  return (
    <div className={`holdem-timer ${seconds <= 5 ? 'urgent' : ''}`}>
      <span>{seconds ? `${seconds} сек` : 'Ожидание сервера'}</span>
      <progress max={25} value={Math.min(25, seconds)} aria-label="Время на действие" />
    </div>
  );
}
