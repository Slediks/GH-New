import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal, Send } from 'lucide-react';
import type { Message } from './useChat';

function MessageRow({
  message,
  canModerate,
  onModerate,
}: {
  message: Message;
  canModerate: boolean;
  onModerate: (message: Message) => void;
}) {
  return (
    <article className={`chat-message-row ${message.deleted ? 'deleted' : ''}`}>
      <time title={new Date(message.created_at * 1000).toLocaleString('ru-RU')}>
        {new Date(message.created_at * 1000).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>{' '}
      <strong>{message.login}:</strong> <span>{message.text}</span>
      {canModerate && !message.deleted && (
        <button
          className="chat-moderation-trigger"
          aria-label={`Действия с сообщением ${message.login}`}
          onClick={() => onModerate(message)}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
    </article>
  );
}

export function ChatMessageList({
  messages,
  canModerate,
  onModerate,
  hasOlder,
  loadOlder,
}: {
  messages: Message[];
  canModerate: boolean;
  onModerate: (message: Message) => void;
  hasOlder: boolean;
  loadOlder: () => Promise<void>;
}) {
  const list = useRef<HTMLDivElement>(null),
    pinned = useRef(true);
  const previous = useRef({ first: 0, last: 0, height: 0 });
  const [newMessages, setNewMessages] = useState(false),
    [loading, setLoading] = useState(false);
  const first = messages[0]?.id ?? 0,
    last = messages.at(-1)?.id ?? 0;
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (previous.current.first && first < previous.current.first) {
      node.scrollTop += node.scrollHeight - previous.current.height;
    } else if (pinned.current) node.scrollTop = node.scrollHeight;
    else if (last > previous.current.last) setNewMessages(true);
    previous.current = { first, last, height: node.scrollHeight };
  }, [first, last, messages]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (list.current && pinned.current) list.current.scrollTop = list.current.scrollHeight;
    });
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="chat-feed">
      <div
        className="casino-chat-messages"
        ref={list}
        role="log"
        aria-label="Сообщения чата"
        onScroll={() => {
          const node = list.current!;
          pinned.current = node.scrollHeight - node.clientHeight - node.scrollTop < 24;
          if (pinned.current) setNewMessages(false);
        }}
      >
        {hasOlder && (
          <button
            className="chat-load-older"
            disabled={loading}
            onClick={async () => {
              pinned.current = false;
              setLoading(true);
              try {
                await loadOlder();
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? 'Загрузка…' : 'Более ранние сообщения'}
          </button>
        )}
        {!messages.length && <p className="muted">Сообщений пока нет.</p>}
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            canModerate={canModerate}
            onModerate={onModerate}
          />
        ))}
      </div>
      {newMessages && (
        <button
          className="chat-jump"
          onClick={() => {
            pinned.current = true;
            list.current!.scrollTop = list.current!.scrollHeight;
            setNewMessages(false);
          }}
        >
          Новые сообщения ↓
        </button>
      )}
    </div>
  );
}

export function ChatComposer({
  text,
  setText,
  busy,
  send,
}: {
  text: string;
  setText: (text: string) => void;
  busy: boolean;
  send: () => Promise<unknown>;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !text.trim()) return;
        input.current?.focus();
        void send();
      }}
    >
      <div className="chat-compose-line">
        <textarea
          ref={input}
          aria-label="Сообщение"
          placeholder="Написать сообщение…"
          maxLength={500}
          required
          value={text}
          readOnly={busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button aria-label="Отправить" title="Отправить" disabled={busy || !text.trim()}>
          <Send size={18} />
        </button>
      </div>
      <small>{text.length}/500 · Enter — отправить · Shift+Enter — новая строка</small>
    </form>
  );
}
