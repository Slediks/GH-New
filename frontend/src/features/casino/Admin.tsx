import { useRef, useState } from 'react';
import { api, date, points } from '../../shared/api';
import { useResource } from '../../shared/hooks';
import { ErrorBox, Loading } from '../../shared/UI';
import { requestId } from './types';
import { TablePricingAdmin } from './TablePricingAdmin';
import type { PricedTable } from './tablePricing';
import { CasinoChat } from './Chat';

import {
  SettingsWorkspace,
  ConfigVersions,
  ConfigAudit,
  casinoNames as names,
  type CasinoConfig as Config,
} from './SettingsWorkspace';

const navigation = [
  ['overview', 'Обзор'],
  ['exchange', 'Валюты и обмен'],
  ['games', 'Игры'],
  ['rules', 'Правила и выплаты'],
  ['rounds', 'Общие раунды'],
  ['tables', 'Игровые столы'],
  ['bots', 'Боты и кошельки'],
  ['limits', 'Лимиты и комиссия'],
  ['chat', 'Чаты и модерация'],
  ['history', 'Операции и история'],
  ['metrics', 'Метрики'],
  ['versions', 'Версии настроек'],
  ['audit', 'Аудит действий'],
];
export function CasinoAdmin() {
  const settings = useResource<{ version: number; value: Config }>('/casino/admin/settings');
  const [section, setSection] = useState('overview'),
    [navSearch, setNavSearch] = useState('');
  const [query, setQuery] = useState('');
  const accounts = useResource<{
    items: {
      id: string;
      label: string;
      is_bot: boolean;
      available: number;
      reserved: number;
      at_table: number;
    }[];
  }>(`/casino/admin/accounts?q=${encodeURIComponent(query)}`);
  const [accountId, setAccountId] = useState(''),
    [page, setPage] = useState(1);
  const history = useResource<{
    items: {
      id: number;
      kind: string;
      available_delta: number;
      reserved_delta: number;
      table_delta: number;
      operation_id: string;
      reason: string;
      created_at: number;
    }[];
  }>(`/casino/admin/history?account_id=${encodeURIComponent(accountId)}&page=${page}`);
  const rounds = useResource<{
    items: {
      id: string;
      game: string;
      status: string;
      rules_version: number;
      created_at: number;
    }[];
  }>(`/casino/admin/rounds?user_id=${encodeURIComponent(accountId)}&page=${page}`);
  const exchanges = useResource<{
    items: {
      id: string;
      direction: string;
      debit: number;
      credit: number;
      rate_version: number;
      user_id: string;
    }[];
  }>(`/casino/admin/exchanges?user_id=${encodeURIComponent(accountId)}&page=${page}`);
  const metrics = useResource<{
    items: { kind: string; count: number; available: number; reserved: number; at_table: number }[];
  }>('/casino/admin/metrics');
  const tables = useResource<{ items: PricedTable[] }>('/casino/tables');
  const [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const adjustment = useRef<{ signature: string; id: string } | null>(null);
  async function post(path: string, value: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (path === 'adjust') {
      const data = value as Record<string, unknown>;
      const signature = JSON.stringify([data.account_id, data.amount, data.reason]);
      if (adjustment.current?.signature !== signature)
        adjustment.current = { signature, id: requestId() };
      value = { ...data, request_id: adjustment.current.id };
    }
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api(`/casino/admin/${path}`, 'POST', value);
      if (path === 'adjust') adjustment.current = null;
      setSuccess('Изменения сохранены');
      await Promise.all([
        settings.reload(),
        accounts.reload(),
        history.reload(),
        metrics.reload(),
        tables.reload(),
      ]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!settings.data) return settings.error ? <ErrorBox message={settings.error} /> : <Loading />;
  const config = settings.data.value;
  return (
    <>
      <h2>Управление казино</h2>
      <ErrorBox message={error || accounts.error || history.error || settings.error} />
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      <div className="casino-admin-workspace">
        <nav className="casino-admin-nav" aria-label="Разделы управления казино">
          <input
            aria-label="Поиск раздела настроек"
            placeholder="Поиск настроек…"
            value={navSearch}
            onChange={(event) => setNavSearch(event.target.value)}
          />
          {navigation
            .filter(([, label]) => label.toLowerCase().includes(navSearch.toLowerCase()))
            .map(([key, label]) => (
              <button
                key={key}
                aria-current={section === key ? 'page' : undefined}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
        </nav>
        <div className="casino-admin-content">
          {section === 'overview' && (
            <section className="panel">
              <h3>Обзор казино</h3>
              <p>
                Действующая конфигурация: v{settings.data.version}. Разрешены{' '}
                {Object.values(config.games).filter((game) => game.enabled).length} из 16 игр.
              </p>
              <p>
                Подготовьте черновик в разделах настроек, проверьте изменения и примените новую
                версию. Игры с уже принятыми ставками сохраняют прежние условия.
              </p>
              <button onClick={() => setSection('exchange')}>Настроить обмен</button>
            </section>
          )}
          <div hidden={!['exchange', 'games', 'rules', 'limits'].includes(section)}>
            <SettingsWorkspace
              key={settings.data.version}
              tableGames={[...new Set(tables.data?.items.map((t) => t.game) ?? [])]}
              initial={config}
              version={settings.data.version}
              section={section}
              reload={settings.reload}
            />
          </div>
          {section === 'versions' && <ConfigVersions />}
          {section === 'audit' && <ConfigAudit />}

          <section className="panel" hidden={section !== 'bots'}>
            <h3>Кошельки и резерв ботов</h3>
            <label>
              Поиск по логину или названию
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            {accounts.data?.items.map((account) => (
              <div className="admin-user" key={account.id}>
                <h3>
                  {account.label}
                  {account.is_bot && ' · БОТ / РЕЗЕРВ'}
                </h3>
                <p>
                  Доступно {points(account.available)} · В ставках {points(account.reserved)} · За
                  столом {points(account.at_table)}
                </p>
                <button
                  onClick={() => {
                    setAccountId(account.id);
                    setSection('history');
                    setPage(1);
                  }}
                >
                  Показать операции
                </button>
                <form
                  className="adjustment"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void post('adjust', {
                      account_id: account.id,
                      amount: form.get('amount'),
                      reason: form.get('reason'),
                      request_id: requestId(),
                    });
                  }}
                >
                  <label>
                    Корректировка, шейкели
                    <input name="amount" inputMode="decimal" required placeholder="10 или -10" />
                  </label>
                  <label>
                    Причина
                    <input name="reason" required maxLength={1000} />
                  </label>
                  <button disabled={busy}>Применить</button>
                </form>
              </div>
            ))}
          </section>
          {section === 'tables' && (
            <TablePricingAdmin tables={tables.data?.items ?? []} reload={tables.reload} />
          )}
          <section className="panel" hidden={!['history', 'rounds'].includes(section)}>
            <h3>Журнал операций{accountId && ` · ${accountId}`}</h3>
            {accountId && (
              <button
                onClick={() => {
                  setAccountId('');
                  setPage(1);
                }}
              >
                Все пользователи
              </button>
            )}
            {history.data?.items.map((row) => (
              <div className="stat-row" key={row.id}>
                <div>
                  {row.kind} · {date(row.created_at)}
                  <p>{row.reason}</p>
                  <small>{row.operation_id}</small>
                </div>
                <strong>
                  {points(row.available_delta + row.reserved_delta + row.table_delta)} ш.
                </strong>
              </div>
            ))}
            <h3>Обмены</h3>
            {exchanges.data?.items.map((row) => (
              <p key={row.id}>
                {row.direction === 'deposit' ? 'Пополнение' : 'Вывод'} · {points(row.debit)} →{' '}
                {points(row.credit)} · версия {row.rate_version} · {row.id}
              </p>
            ))}
            <h3>Раунды</h3>
            {rounds.data?.items.map((row) => (
              <p key={row.id}>
                {names[row.game] ?? row.game} · {row.status} · версия {row.rules_version} · {row.id}
              </p>
            ))}
            <div className="actions">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Назад
              </button>
              <span>{page}</span>
              <button onClick={() => setPage(page + 1)}>Далее</button>
            </div>
          </section>
          <section className="panel" hidden={section !== 'metrics'}>
            <h3>Метрики журнала</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Операций</th>
                    <th>Доступные</th>
                    <th>Резерв</th>
                    <th>За столом</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.data?.items.map((row) => (
                    <tr key={row.kind}>
                      <td>{row.kind}</td>
                      <td>{row.count}</td>
                      <td>{points(row.available)}</td>
                      <td>{points(row.reserved)}</td>
                      <td>{points(row.at_table)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {section === 'chat' && <CasinoChat title="Модерация общего чата казино" />}
        </div>
      </div>
    </>
  );
}
