import { entryPrice } from './tablePricing';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { ErrorBox } from '../../shared/UI';
import { DurakTable } from './durak/DurakTable';
import { DiceScene } from './DiceScene';
import { Rules } from './Rules';
import { CasinoChat } from './Chat';
import { casinoSound } from './sound';
import { DuelRoomShell } from './DuelRoomShell';
import { TableLobby } from './TableLobby';
import type { DuelTable as Table } from './duelTypes';
import { requestId, type CasinoGame } from './types';

export function DuelTables({
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
  const [tables, setTables] = useState<Table[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    actionRevision = useRef(0),
    restored = useRef(false),
    paid = useRef('');
  const pending = useRef<{ signature: string; payload: Record<string, unknown> } | null>(null);
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
            casinoSound('result');
            void refresh();
          }
        } else {
          const result = await api<{ items: Table[] }>(`/casino/tables?game=${game.id}`);
          if (alive) {
            setTables(result.items);
            if (!restored.current) {
              restored.current = true;
              const occupied = result.items.find(
                (item) =>
                  item.round && item.round.status !== 'finished' && item.round.player !== null,
              );
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
    const timer = window.setInterval(() => void load(), 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [selected, game.id]);
  async function send(
    join: boolean,
    action = '',
    options: Record<string, unknown> = {},
    target = selected,
  ) {
    if (!target || inFlight.current) return;
    inFlight.current = true;
    actionRevision.current++;
    setBusy(true);
    setError('');
    casinoSound('click');
    const source = table?.id === target ? table : tables.find((t) => t.id === target);
    const payload = join
      ? { pricing_version: source?.pricing?.version }
      : { action, options, round_id: table?.round?.id };
    const signature = JSON.stringify({ selected: target, join, payload });
    if (pending.current?.signature !== signature)
      pending.current = { signature, payload: { ...payload, request_id: requestId() } };
    try {
      const result = await api<Table>(
        `/casino/tables/${target}/${join ? 'join' : 'actions'}`,
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
  const round = table?.round,
    state = round?.state;
  return (
    <>
      <h2>{game.rules.name}</h2>
      <ErrorBox message={error} />
      {!selected ? (
        <TableLobby
          available={available}
          active={active}
          busy={busy}
          initialCapacity={game.id === 'durak' ? 2 : undefined}
          tables={tables.map((t) => {
            const finished = t.round?.status === 'finished';
            const occupied = finished ? 0 : t.participants.length;
            const seated = !!t.round && !finished && t.round.player !== null;
            const playing = t.round?.status === 'playing';
            return {
              id: t.id,
              bots: t.bots,
              capacity: t.capacity ?? 2,
              occupied,
              entry: t.pricing ? entryPrice(t.pricing) : t.stake,
              pricing: t.pricing,
              playing,
              seated,
              joinable:
                t.enabled !== false &&
                (!t.round || finished || t.round.status === 'waiting') &&
                !seated &&
                occupied < (t.capacity ?? 2),
            };
          })}
          join={(id) => void send(true, '', {}, id)}
          open={(id) => {
            setSelected(id);
            setTable(tables.find((t) => t.id === id) ?? null);
          }}
        />
      ) : (
        <>
          <button onClick={() => setSelected(null)}>← Столы</button>
          {table && (
            <DuelRoomShell
              table={table}
              name={game.rules.name}
              busy={busy}
              available={available}
              active={active}
              join={() => void send(true)}
              leave={() => void send(false, 'leave')}
            >
              {state?.rolls && (
                <DiceScene
                  rolls={state.rolls}
                  participants={table.participants}
                  winner={state.winner}
                  done={!!state.done}
                />
              )}
              {state?.trump_card && (
                <DurakTable
                  table={table}
                  busy={busy}
                  move={(action, options = {}) => void send(false, action, options)}
                />
              )}
            </DuelRoomShell>
          )}
        </>
      )}
      <Rules game={{ ...game, rules: round?.rules ?? game.rules }} />
      {selected && <CasinoChat key={selected} channel={selected} title="Чат стола" />}
    </>
  );
}
