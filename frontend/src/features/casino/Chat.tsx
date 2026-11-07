import { useEffect, useState } from 'react';
import { useAuth } from '../../app/Auth';
import { ErrorBox } from '../../shared/UI';
import { useChatRegistration } from './FloatingChat';
import { useChat, type Message } from './useChat';
import { ChatMessageList, ChatComposer } from './ChatFeed';
import { ChatModeration } from './ChatModeration';
import './chatFeed.css';

export function CasinoChat({
  channel = 'lobby',
  title = 'Общий чат казино',
}: {
  channel?: string;
  title?: string;
}) {
  const register = useChatRegistration();
  useEffect(() => register?.({ channel, title }), [register, channel, title]);
  return register ? null : <CasinoChatContent key={channel} channel={channel} title={title} />;
}

export function CasinoChatContent({
  channel = 'lobby',
  title = 'Общий чат казино',
  floating = false,
}: {
  channel?: string;
  title?: string;
  floating?: boolean;
}) {
  const { user } = useAuth();
  const chat = useChat(channel);
  const [selected, setSelected] = useState<Message | null>(null);
  const Container = floating ? 'div' : 'details';
  return (
    <Container
      className={
        floating ? 'casino-chat-floating-body chat-stream' : 'panel casino-chat chat-stream'
      }
    >
      {!floating && <summary>{title}</summary>}
      <ChatMessageList
        messages={chat.messages}
        canModerate={user?.role === 'admin'}
        onModerate={setSelected}
        hasOlder={chat.hasOlder}
        loadOlder={chat.loadOlder}
      />
      <ErrorBox message={chat.error} />
      <ChatComposer text={chat.text} setText={chat.setText} busy={chat.busy} send={chat.send} />
      {selected && user?.role === 'admin' && (
        <ChatModeration
          message={selected}
          busy={chat.busy}
          close={() => setSelected(null)}
          moderate={chat.moderate}
          error={chat.error}
        />
      )}
    </Container>
  );
}
