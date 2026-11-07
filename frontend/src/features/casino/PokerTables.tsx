import { entryPrice } from './tablePricing';
import { useEffect, useRef, useState } from 'react';
import { api, points } from '../../shared/api';
import { ErrorBox } from '../../shared/UI';
import type { Table } from './poker/types';
import { TableLobby } from './TableLobby';
import { PokerRoom } from './poker/PokerRoom';
import { CasinoChat } from './Chat';
import { casinoSound } from './sound';
import { Rules } from './Rules';
import { requestId, type CasinoGame } from './types';
import './poker.css';

export function PokerTables({
  game,
  refresh,
  available,
  active,
}: {
  game: CasinoGame;
  refresh: () => Promise<void>;
  available: number;
  active: boolean;
}) {
  const [tables, setTables] = useState<Table[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [amount, setAmount] = useState('400');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    actionRevision = useRef(0),
    restored = useRef(false),
    pending = useRef<{ key: string; payload: Record<string, unknown> } | null>(null),
    paid = useRef('');
  useEffect(() => {
    let alive = true,
      running = false;
    const load = async () => {
      if (running || inFlight.current) return;
      running = true;
      const revision = actionRevision.current;
      try {
        if (selected) {
          const value = await api<Table>(`/casino/tables/${selected}`);
          if (!alive || inFlight.current || revision !== actionRevision.current) return;
          setTable(value);
          if (value.round?.status === 'finished' && paid.current !== value.round.id) {
            paid.current = value.round.id;
            void refresh();
          }
        } else {
          const result = await api<{ items: Table[] }>('/casino/tables?game=holdem');
          if (alive) {
            setTables(result.items);
            if (!restored.current) {
              restored.current = true;
              const occupied = result.items.find((item) => item.player !== null);
              if (occupied) {
                setSelected(occupied.id);
              }
            }
          }
        }
      } catch (error) {
        if (alive) setError((error as Error).message);
      } finally {
        running = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [selected]);
  async function send(action: string, raiseAmount?: string, target = selected) {
    if (!target || inFlight.current) return;
    inFlight.current = true;
    actionRevision.current++;
    setBusy(true);
    setError('');
    casinoSound('click');
    const source = table?.id === target ? table : tables.find((t) => t.id === target);
    const payload = {
      ...(action === 'join' ? { pricing_version: source?.pricing?.version } : {}),
      action,
      amount: action === 'join' ? (raiseAmount ?? amount) : (raiseAmount ?? '0'),
      round_id: table?.round?.id,
    };
    const key = JSON.stringify({ selected: target, payload });
    if (pending.current?.key !== key)
      pending.current = { key, payload: { ...payload, request_id: requestId() } };
    try {
      const result = await api<Table>(
        `/casino/tables/${target}/${action === 'join' ? 'join' : 'actions'}`,
        'POST',
        pending.current.payload,
      );
      pending.current = null;
      setSelected(target);
      setTable(result);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  // A new seat can join during the break after a hand it did not play.
  // Show current seats instead of the previous hand's participants in that case.
  const round =
    table?.round &&
    (table.round.status === 'playing' || table.round.player !== null || table.player === null)
      ? table.round
      : null;
  return (
    <>
      <h2>Техасский холдем</h2>
      <ErrorBox message={error} />
      {!selected ? (
        <TableLobby
          available={available}
          active={active}
          busy={busy}
          stakeLabel="Вход"
          tables={tables.map((t) => ({
            id: t.id,
            bots: t.bots,
            capacity: 6,
            occupied: t.seats.length,
            entry: t.pricing ? entryPrice(t.pricing) : t.minimum,
            pricing: t.pricing,
            seated: t.player !== null,
            playing: t.round?.status === 'playing',
            joinable:
              t.enabled !== false &&
              t.player === null &&
              t.seats.length < 6 &&
              t.round?.status !== 'playing',
            details: `NL Hold’em · Блайнды ${points(t.small_blind)}/${points(t.big_blind)}`,
          }))}
          join={(id) => {
            const t = tables.find((t) => t.id === id);
            if (t) void send('join', String(t.minimum / 100), id);
          }}
          open={(id) => {
            const t = tables.find((t) => t.id === id);
            if (t) {
              setSelected(id);
              setTable(t);
              setAmount(String(t.minimum / 100));
            }
          }}
        />
      ) : (
        <>
          <button onClick={() => setSelected(null)}>← Столы</button>
          {table && (
            <>
              <PokerRoom
                table={table}
                round={round}
                busy={busy}
                available={available}
                active={active}
                amount={amount}
                setAmount={setAmount}
                send={(action, value) => void send(action, value)}
              />
              <p>Комиссия {table.commission_bps / 100}% · Нет флопа — нет комиссии.</p>
              <CasinoChat channel={table.id} title="Чат покерного стола" />
            </>
          )}
        </>
      )}
      <Rules
        game={{
          ...game,
          rules: round?.rules ?? game.rules,
          limits: table
            ? { ...game.limits, minimum: table.minimum, maximum: table.maximum }
            : game.limits,
        }}
      />
    </>
  );
}
