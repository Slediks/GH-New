import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import type { Draft } from './types';

type Member = { userId: string; login: string };
type Author = { id: string; login: string };
const root = '/arena/maps-admin';

export function MapAccess({ draft }: { draft: Draft }) {
  const [owner, setOwner] = useState({ id: draft.ownerUserId, login: draft.ownerLogin });
  const [editors, setEditors] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [authors, setAuthors] = useState<Author[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = draft.accessRole === 'owner' || draft.accessRole === 'admin';
  useEffect(() => {
    if (!canManage) return;
    void api<{ editors: Member[] }>(`${root}/${draft.id}/access`)
      .then((value) => setEditors(value.editors)).catch((error: Error) => setMessage(error.message));
  }, [draft.id, canManage]);
  useEffect(() => {
    if (!canManage || query.trim().length < 2) { setAuthors([]); return; }
    const timer = window.setTimeout(() => {
      void api<{ authors: Author[] }>(`${root}/${draft.id}/authors?q=${encodeURIComponent(query.trim())}`)
        .then((value) => setAuthors(value.authors)).catch((error: Error) => setMessage(error.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [draft.id, query, canManage]);
  async function change(operation: 'add' | 'remove' | 'transfer', userId: string) {
    setBusy(true);
    try {
      const result = await api<{ editors: Member[] }>(`${root}/${draft.id}/access/${operation}`, 'POST', { userId });
      setEditors(result.editors);
      if (operation === 'transfer') {
        const selected = authors.find((author) => author.id === userId)
          ?? editors.find((editor) => editor.userId === userId);
        if (selected) setOwner({ id: userId, login: selected.login });
      }
      setMessage(operation === 'remove' ? 'Доступ отозван' : operation === 'transfer' ? 'Владелец изменён' : 'Редактор добавлен');
      setQuery('');
      setAuthors([]);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="map-access">
    <summary>Доступ к карте · владелец {owner.login} · {draft.accessRole === 'editor' ? 'редактор' : draft.accessRole === 'owner' ? 'владелец' : 'администратор'}</summary>
    {canManage && <>
      <label>Добавить автора <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти по логину" /></label>
      {authors.filter((author) => author.id !== owner.id && !editors.some((item) => item.userId === author.id)).map((author) =>
        <div key={author.id}>{author.login} <button disabled={busy} onClick={() => void change('add', author.id)}>Добавить</button>
          {draft.accessRole === 'admin' && <button disabled={busy} onClick={() => {
            if (window.confirm(`Передать карту «${draft.name}» от ${owner.login} пользователю ${author.login}?`)) void change('transfer', author.id);
          }}>Сделать владельцем</button>}</div>)}
      <ul>{editors.map((editor) => <li key={editor.userId}>{editor.login} · редактор
        <button disabled={busy} onClick={() => void change('remove', editor.userId)}>Отозвать</button>
        {draft.accessRole === 'admin' && <button disabled={busy} onClick={() => {
          if (window.confirm(`Передать карту «${draft.name}» от ${owner.login} пользователю ${editor.login}?`)) void change('transfer', editor.userId);
        }}>Сделать владельцем</button>}</li>)}</ul>
      <p role="status">{message}</p>
    </>}
  </details>;
}
