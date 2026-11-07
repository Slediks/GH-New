import { useState } from 'react';
import { date, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading, Pagination } from '../../shared/UI';

const labels: Record<string, string> = {
  deposit: 'Пополнение',
  withdraw: 'Вывод в GameHub',
  reserve: 'Резерв ставки',
  stake: 'Списание ставки',
  payout: 'Выплата',
  refund: 'Возврат',
  adjustment: 'Корректировка',
  commission: 'Комиссия',
  table_in: 'Вход за стол',
  table_out: 'Выход из-за стола',
  emission: 'Резерв ботов',
};
interface Entry {
  id: number;
  kind: string;
  available_delta: number;
  reserved_delta: number;
  table_delta: number;
  created_at: number;
  reason: string;
  operation_id: string;
}
export function CasinoHistory() {
  const [page, setPage] = useState(1);
  const { data, error } = useResource<{ items: Entry[] }>(`/casino/history?page=${page}`);
  return (
    <section className="panel casino-ledger">
      <h2>История казино</h2>
      <ErrorBox message={error} />
      {!data && !error && <Loading />}
      {data?.items.length === 0 && <p className="muted">Операций пока нет.</p>}
      {data?.items.map((row) => (
        <div
          className={`stat-row casino-ledger-entry ${row.available_delta + row.reserved_delta + row.table_delta === 0 ? 'transfer' : row.available_delta + row.reserved_delta + row.table_delta > 0 ? 'credit' : 'debit'}`}
          key={row.id}
        >
          <div>
            <strong className="ledger-kind">{labels[row.kind] ?? row.kind}</strong>
            <p>{row.reason}</p>
            <small>{date(row.created_at)}</small>
            <details>
              <summary>Идентификатор операции</summary>
              {row.operation_id}
            </details>
          </div>
          <div>
            <strong>
              {row.available_delta > 0 ? '+' : ''}
              {points(row.available_delta)} ш.
            </strong>
            <small className="ledger-balance-label">Доступный баланс</small>
            {!!row.reserved_delta && <p>В резерве: {points(row.reserved_delta)}</p>}
            {!!row.table_delta && <p>За столом: {points(row.table_delta)}</p>}
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
    </section>
  );
}
