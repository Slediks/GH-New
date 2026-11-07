import { useRef, useState, type FormEvent } from 'react';
import { api, date, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading, Pagination } from '../../shared/UI';
import type { Page, Transaction, User } from '../../shared/types';

const kindLabels: Record<string, string> = {
  welcome: 'Стартовое начисление',
  activity: 'За активность',
  bet: 'Ставка',
  payout: 'Выигрыш',
  refund: 'Возврат ставки',
  adjustment: 'Корректировка',
};

function BalanceHistory({ user }: { user: User }) {
  const [page, setPage] = useState(1);
  const { data, error } = useResource<Page<Transaction>>(
    `/admin/users/${user.id}/transactions?page=${page}`,
  );
  return (
    <div className="admin-history" id={`balance-history-${user.id}`}>
      <h3>История баланса · {user.login}</h3>
      <ErrorBox message={error} />
      {!data && !error && <Loading />}
      {data?.items.length === 0 && <p className="muted">Записей пока нет.</p>}
      {data?.items.map((row) => (
        <div className="stat-row" key={row.id}>
          <div>
            <strong>{kindLabels[row.kind] ?? row.kind}</strong>
            {row.reason && <p>{row.reason}</p>}
            <span className="muted">{date(row.created_at)}</span>
          </div>
          <div className="admin-history-amount">
            <strong>
              {row.amount > 0 ? '+' : ''}
              {points(row.amount)} очков
            </strong>
            <span className="muted">Баланс: {points(row.balance_after)}</span>
          </div>
        </div>
      ))}
      {data && (
        <Pagination
          page={page}
          setPage={setPage}
          total={data.items.length < 24 ? page * 24 : undefined}
        />
      )}
    </div>
  );
}

export function AdminUserCard({
  user,
  action,
  onBalanceChanged,
}: {
  user: User;
  action: (name: string, payload: unknown) => Promise<boolean>;
  onBalanceChanged: () => Promise<void>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inFlight = useRef(false);
  const pending = useRef<{ amount: number; reason: string; request_id: string } | null>(null);

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = Math.round(Number(values.get('amount')) * 100);
    const reason = String(values.get('reason') ?? '').trim();
    setError('');
    setSuccess('');
    if (!Number.isSafeInteger(amount) || amount === 0 || !reason) {
      setError('Укажите ненулевую сумму и причину корректировки.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      if (
        !pending.current ||
        pending.current.amount !== amount ||
        pending.current.reason !== reason
      ) {
        // getRandomValues is available on LAN HTTP; randomUUID requires a secure context.
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        pending.current = {
          amount,
          reason,
          request_id: Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(''),
        };
      }
      await api('/admin/balance', 'POST', { user_id: user.id, ...pending.current });
      pending.current = null;
      form.reset();
      setSuccess('Баланс скорректирован.');
      setRevision((value) => value + 1);
      await onBalanceChanged();
    } catch (error) {
      // Retain the operation key so retrying after a lost response cannot charge twice.
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="panel admin-user">
      <div className="section-heading">
        <h3>{user.login}</h3>
        <strong>{points(user.balance)} очков</strong>
      </div>
      <div className="actions admin-user-actions">
        <label>
          Роль
          <select
            value={user.role}
            onChange={(event) =>
              void action('role', { user_id: user.id, role: event.target.value })
            }
          >
            <option value="user">Пользователь</option>
            <option value="author">Автор</option>
            <option value="admin">Администратор</option>
          </select>
        </label>
        <button
          type="button"
          aria-expanded={showHistory}
          aria-controls={`balance-history-${user.id}`}
          onClick={() => setShowHistory((value) => !value)}
        >
          {showHistory ? 'Скрыть историю' : 'История баланса'}
        </button>
      </div>
      <form className="adjustment" onSubmit={(event) => void adjust(event)}>
        <label>
          Корректировка, очки
          <input
            name="amount"
            type="number"
            step="0.01"
            required
            disabled={busy}
            placeholder="10 или −10"
          />
        </label>
        <label>
          Причина
          <input name="reason" required maxLength={1000} disabled={busy} />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Сохранение…' : 'Применить'}
        </button>
      </form>
      <ErrorBox message={error} />
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      {showHistory && <BalanceHistory key={revision} user={user} />}
    </section>
  );
}
