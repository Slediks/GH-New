import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { requestId } from './types';
export interface Message {
  id: number;
  user_id: string;
  login: string;
  text: string;
  deleted: boolean;
  created_at: number;
}
interface History {
  generation?: number;
  items: Message[];
  next_before: number | null;
}

export function useChat(channel: string) {
  const [history, setHistory] = useState<History>({ items: [], next_before: null });
  const [older, setOlder] = useState<Message[]>([]),
    [text, setText] = useState('');
  const [olderCursor, setOlderCursor] = useState<number | null | undefined>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ text: string; id: string; generation?: number } | null>(null);
  const currentChannel = useRef(channel);
  currentChannel.current = channel;
  const generation = useRef<number | undefined>(undefined);
  function accept(value: History, origin: string, olderPage = false) {
    if (origin !== currentChannel.current) return;
    if (value.generation !== undefined) {
      if (generation.current !== undefined && value.generation < generation.current) return;
      if (value.generation !== generation.current) {
        setOlder([]);
        setOlderCursor(undefined);
        pending.current = null;
        generation.current = value.generation;
        // A pagination response from a new chat cannot supply its current page.
        if (olderPage) {
          setHistory({ items: [], next_before: null, generation: value.generation });
          return;
        }
      }
    }
    if (olderPage) {
      setOlder((values) => [...value.items, ...values]);
      setOlderCursor(value.next_before);
    } else setHistory(value);
  }
  useEffect(() => {
    let alive = true,
      running = false;
    generation.current = undefined;
    pending.current = null;
    setOlder([]);
    setOlderCursor(undefined);
    setHistory({ items: [], next_before: null });
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const value = await api<History>(`/casino/chat/${channel}`);
        if (alive) accept(value, channel);
      } catch (error) {
        if (alive) setError((error as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [channel]);
  async function send() {
    if (busy) return;
    setBusy(true);
    setError('');
    if (pending.current?.text !== text)
      pending.current = { text, id: requestId(), generation: generation.current };
    try {
      await api(`/casino/chat/${channel}`, 'POST', {
        text,
        request_id: pending.current.id,
        generation: pending.current.generation,
      });
      pending.current = null;
      setText('');
      accept(await api<History>(`/casino/chat/${channel}`), channel);
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function moderate(action: string, message: Message, reason: string, minutes: number) {
    setBusy(true);
    setError('');
    try {
      await api('/casino/admin/chat', 'POST', {
        action,
        message_id: message.id,
        user_id: message.user_id,
        minutes,
        reason,
      });
      accept(await api<History>(`/casino/chat/${channel}`), channel);
      setOlder([]);
      setOlderCursor(undefined);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const messages = [
    ...new Map([...older, ...history.items].map((message) => [message.id, message])).values(),
  ].sort((a, b) => a.id - b.id);
  async function loadOlder() {
    try {
      const result = await api<History>(
        `/casino/chat/${channel}?before=${olderCursor === undefined ? history.next_before : olderCursor}`,
      );
      accept(result, channel, true);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return {
    messages,
    text,
    setText,
    busy,
    error,
    send,
    moderate,
    loadOlder,
    hasOlder: (olderCursor === undefined ? history.next_before : olderCursor) != null,
  };
}
