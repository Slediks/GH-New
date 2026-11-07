import { useEffect, useRef, useState } from 'react';
import type { Message } from './useChat';

function MuteFields({
  minutes,
  setMinutes,
}: {
  minutes: number;
  setMinutes: (value: number) => void;
}) {
  return (
    <label>
      Минут ограничения (0 — снять)
      <input
        type="number"
        min={0}
        max={43200}
        step={1}
        required
        value={minutes}
        onChange={(event) => setMinutes(event.target.valueAsNumber)}
      />
    </label>
  );
}

export function ChatModeration({
  message,
  busy,
  close,
  moderate,
  error,
}: {
  message: Message;
  busy: boolean;
  close: () => void;
  error: string;
  moderate: (
    action: string,
    message: Message,
    reason: string,
    minutes: number,
  ) => Promise<boolean | undefined>;
}) {
  const [action, setAction] = useState<'delete' | 'mute' | null>(null);
  const [reason, setReason] = useState(''),
    [minutes, setMinutes] = useState(10);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div
      className="chat-moderation-panel"
      role="dialog"
      aria-label={`Модерация: ${message.login}`}
      ref={panel}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header>
        <strong>{message.login}</strong>
        <button onClick={close} aria-label="Закрыть модерацию">
          ×
        </button>
      </header>
      {!action ? (
        <div className="chat-moderation-menu">
          <button onClick={() => setAction('delete')}>Удалить сообщение</button>
          <button onClick={() => setAction('mute')}>Выдать мут / снять ограничение</button>
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            if (await moderate(action, message, reason, minutes)) close();
          }}
        >
          <strong>{action === 'delete' ? 'Удалить сообщение' : 'Ограничение пользователя'}</strong>
          {action === 'mute' && <MuteFields minutes={minutes} setMinutes={setMinutes} />}
          <label>
            Причина
            <input
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            disabled={
              busy || !reason.trim() || !Number.isInteger(minutes) || minutes < 0 || minutes > 43200
            }
          >
            {busy ? 'Сохранение…' : 'Подтвердить'}
          </button>
        </form>
      )}
    </div>
  );
}
