import { Scoreboard } from './Scoreboard';
import { keyLabel } from './preferences';
import { useEffect, useRef, useState } from 'react';
import { PlayerSettings } from './PlayerSettings';
import { useMatchLeaveGuard } from './leaveGuard';
import { ArenaClient } from './client';
import type { Manifest, Preferences, Room, Snapshot } from './types';
import { modes } from './types';
import { showPauseMenu } from './pauseMenu';

export function MatchView({
  room,
  manifest: suppliedManifest,
  self,
  debugAllowed,
  leave,
  lobby,
  prefs,
  setPrefs,
}: {
  room: Room;
  manifest: Manifest;
  self: string;
  debugAllowed?: boolean;
  leave: () => void;
  lobby: () => void;
  prefs: Preferences;
  setPrefs: (prefs: Preferences) => void;
}) {
  const [manifest] = useState(() => room.manifest ?? suppliedManifest);
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    client = useRef<ArenaClient | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [scoped, setScoped] = useState(false);
  const [fullscreenMenuRequested, setFullscreenMenuRequested] = useState(false);
  const [target, setTarget] = useState('');
  const [fireDebug, setFireDebug] = useState(false);
  const [hit, setHit] = useState('');
  const hitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!canvas.current) return;
    try {
      client.current = new ArenaClient(
        canvas.current,
        manifest,
        room,
        self,
        prefs,
        setSnapshot,
        (value) => {
          setLocked(value);
          if (value) setFullscreenMenuRequested(false);
        },
        setError,
        setTab,
        (head) => {
          setHit(head ? 'head' : 'body');
          clearTimeout(hitTimer.current);
          hitTimer.current = setTimeout(() => setHit(''), 180);
        },
        (scope, target) => {
          setScoped(scope);
          setTarget(target);
        },
        () => setFullscreenMenuRequested(true),
      );
    } catch (e) {
      setError(`Не удалось открыть 3D-сцену: ${(e as Error).message}`);
    }
    return () => {
      client.current?.dispose();
      client.current = null;
      clearTimeout(hitTimer.current);
    };
    // A match owns its scene for its entire lifetime; changing HUD settings must not reconnect.
  }, [room.match_id, manifest, self]);
  useEffect(() => {
    client.current?.configure(prefs);
    localStorage.setItem('arena-preferences', JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    const change = () => {
      const fullscreen = document.fullscreenElement === root.current;
      setExpanded(fullscreen);
      if (fullscreen) setFullscreenMenuRequested(false);
      client.current?.scene.resize();
    };
    document.addEventListener('fullscreenchange', change);
    change();
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const me = snapshot?.players.find((p) => p.id === self);
  const watched = snapshot?.players.find(
    (p) => p.id === target && p.alive && p.connected && p.spectator,
  );
  const spectating = !!me && !me.alive && room.settings.mode === 'elimination';
  const ended = snapshot?.phase === 'finished' || room.status === 'finished';
  const phase = snapshot?.phase;
  const confirmLeave = useMatchLeaveGuard(!ended && ['loading', 'active'].includes(room.status));
  const sorted = [...(snapshot?.players ?? room.result?.players ?? [])].sort(
    (a, b) => b.kills - a.kills,
  );
  const winner = snapshot?.winner ?? room.result?.winner;
  const winnerName = sorted.find((p) => p.id === winner)?.name ?? winner;
  const time = Math.max(0, Math.ceil((snapshot?.deadline ?? 0) - (snapshot?.time ?? 0)));
  const noSpectator = me && !me.alive && room.settings.mode === 'elimination' && !watched;
  return (
    <section ref={root} className={`arena-match ${expanded ? 'is-expanded' : ''}`}>
      <canvas
        ref={canvas}
        aria-label={`Трёхмерная карта Арены — ${manifest.map?.name ?? 'Depot 07'}`}
        onClick={() => {
          if (expanded && !locked) void client.current?.lock();
        }}
      />
      {expanded && !locked && !fullscreenMenuRequested && !ended && (
        <div className="arena-fullscreen-resume-hint">Нажмите на поле, чтобы вернуть управление</div>
      )}
      <div className="arena-match-top">
        <span>
          <b>{manifest.map?.name ?? 'DEPOT 07'}</b>
          <small>{modes[room.settings.mode]}</small>
        </span>
        <div className="arena-live-score">
          {room.settings.mode === 'dm' ? (
            `Вы #${sorted.findIndex((p) => p.id === self) + 1} · ${me?.kills ?? 0} / лидер ${sorted[0]?.kills ?? 0}`
          ) : (
            <>
              <b className="alpha">ALPHA {snapshot?.scores.Alpha ?? 0}</b>
              <span>:</span>
              <b className="bravo">{snapshot?.scores.Bravo ?? 0} BRAVO</b>
            </>
          )}
        </div>
        <span>
          {snapshot?.overtime ? 'OVERTIME · ' : ''}
          {Math.floor(time / 60)}:{String(time % 60).padStart(2, '0')}
          <small>
            {room.settings.mode === 'elimination'
              ? `Раунд ${snapshot?.round ?? 0} · живых ${snapshot?.players.filter((p) => p.alive && p.team === 'Alpha').length ?? 0} : ${snapshot?.players.filter((p) => p.alive && p.team === 'Bravo').length ?? 0}`
              : 'До ' + room.settings.kills + ' убийств'}
          </small>
        </span>
      </div>
      {debugAllowed && (
        <button type="button" className="arena-fire-debug"
          onClick={() => {
            const next = !fireDebug;
            setFireDebug(next);
            client.current?.scene.fire.setDebug(next);
          }}>
          {fireDebug ? 'Скрыть зоны огня' : 'Показать зоны урона огня'}
          {fireDebug && ` · ${snapshot?.fire_areas?.length ?? 0}`}
        </button>
      )}
      {scoped && locked && me?.alive && !ended && (
        <div className="arena-scope" aria-label="Снайперский прицел">
          <div className="arena-optic">
            <i />
            <b />
          </div>
        </div>
      )}
      {locked && !scoped && me?.alive && phase === 'active' && (
        <div
          className={`arena-crosshair ${hit}`}
          style={{
            transform: `translate(-50%, -50%) scale(${1 + Math.min(1.5, (me.spread ?? 0) * 18)})`,
          }}
          aria-label={hit ? 'Попадание' : 'Прицел'}
        >
          +
        </div>
      )}
      <div className="arena-flash-overlay" aria-hidden="true" />
      <div className="arena-killfeed">
        {snapshot?.events
          .filter((e) => e.kind === 'kill' && snapshot.time - e.time < 7)
          .slice(-4)
          .map((e) => (
            <div key={e.id}>
              {snapshot.players.find((p) => p.id === e.killer)?.name ?? 'Отключение'}{' '}
              <b>
                {e.weapon === 'frag' ? '✹ Frag Grenade' : e.weapon === 'molotov'
                  ? '🔥 Molotov' : manifest.weapons[e.weapon ?? '']?.name}{' '}
                {e.head ? '⌖' : '→'}
              </b>{' '}
              {snapshot.players.find((p) => p.id === e.victim)?.name}
            </div>
          ))}
      </div>
      {me && !me.alive && !watched && !ended && phase === 'active' && (
        <div className={`arena-death ${noSpectator ? 'opaque' : ''}`}>
          <b>Вы выбыли</b>
          <span>
            {room.settings.mode === 'elimination'
              ? noSpectator
                ? 'Ожидание следующего раунда'
                : `Наблюдение: ${snapshot?.players.find((p) => p.id === client.current?.spectator)?.name ?? 'союзник'} · ← / → сменить`
              : `Возрождение через ${Math.max(0, (me.respawn_at ?? 0) - (snapshot?.time ?? 0)).toFixed(1)} с`}
          </span>
        </div>
      )}
      {phase === 'countdown' && (
        <div className="arena-round-banner">Начало раунда через {time} с</div>
      )}
      {phase === 'intermission' && (
        <div className="arena-round-banner">Раунд завершён · следующий через {time} с</div>
      )}
      {spectating && !ended && (
        <aside className="arena-spectator" aria-label="Наблюдение за союзником">
          <small>ВЫ ВЫБЫЛИ · НАБЛЮДЕНИЕ</small>
          <h2>{watched ? `Наблюдение: ${watched.name}` : 'Живых подключённых союзников нет'}</h2>
          {watched && (
            <>
              <p>
                {watched.team} · {watched.spectator?.hp} HP ·{' '}
                {manifest.weapons[watched.weapon]?.name}
                {' · '}
                {watched.spectator?.ammo[watched.weapon]?.join(' / ')} патронов
                {watched.reloading ? ' · Перезарядка' : ''}
              </p>
              <p>
                {watched.kills} убийств · {watched.deaths} смертей
              </p>
            </>
          )}
          <span>
            {watched ? '← / → — сменить союзника · Esc — меню' : 'Ожидание следующего раунда'}
          </span>
        </aside>
      )}
      {me?.alive && !ended && (
        <div className="arena-hud-bottom">
          <div>
            <b>{me.hp ?? 0}</b>
            <small>
              ЗДОРОВЬЕ{' '}
              {me.protected
                ? `· ЗАЩИТА ${Math.max(0, (me.protection_until ?? 0) - (snapshot?.time ?? 0)).toFixed(1)} с`
                : ''}
            </small>
          </div>
          <span>
            {[
              prefs.bindings.forward,
              prefs.bindings.left,
              prefs.bindings.backward,
              prefs.bindings.right,
            ]
              .map(keyLabel)
              .join('/')}{' '}
            — движение · {keyLabel(prefs.bindings.jump)} — прыжок ·{' '}
            {keyLabel(prefs.bindings.crouch)} — удерживать приседание ·{' '}
            {keyLabel(prefs.bindings.crouchToggle)} — присесть/встать ·{' '}
            {keyLabel(prefs.bindings.reload)} — перезарядка · 1–4 — оружие · 5 — гранаты · G — быстрый бросок ·{' '}
            {keyLabel(prefs.bindings.scoreboard)} — счёт · Esc — меню
            {me.weapon === 'sniper' ? ' · ПКМ — оптика (удерживать)' : ''}
          </span>
          <div>
            <small aria-label="Гранаты">
              {client.current?.grenadeSlot ? '● ' : ''}
              {['frag', 'smoke', 'flash', 'molotov'].filter((kind) => kind in (manifest.grenades ?? {})).map((kind) =>
                `${kind === 'molotov' ? 'Molotov' : kind === 'flash' ? 'Flash' : kind === 'smoke' ? 'Smoke' : 'Frag'} ×${me.grenades?.[kind] ?? 0}`).join(' · ')}
              {' · выбрана '}{client.current?.grenadeType === 'molotov' ? 'Molotov'
                : client.current?.grenadeType === 'flash' ? 'Flash'
                : client.current?.grenadeType === 'smoke' ? 'Smoke' : 'Frag'}
              {(me.grenades?.[client.current?.grenadeType ?? 'frag'] ?? 0) === 0
                ? ' · нет в запасе' : ''}
            </small>
            <b>
              {me.ammo?.[me.weapon]?.[0] ?? 0}
              <em> / {me.ammo?.[me.weapon]?.[1] ?? 0}</em>
            </b>
            <small>
              {me.reloading
                ? `ПЕРЕЗАРЯДКА · ${Math.max(0, (me.reload_until ?? 0) - (snapshot?.time ?? 0)).toFixed(1)} с`
                : manifest.weapons[me.weapon]?.name}
            </small>
            {me.reloading && (
              <progress
                aria-label="Перезарядка"
                max={manifest.weapons[me.weapon].reload}
                value={
                  manifest.weapons[me.weapon].reload -
                  Math.max(0, (me.reload_until ?? 0) - (snapshot?.time ?? 0))
                }
              />
            )}
          </div>
        </div>
      )}
      {!ended && !error && (me?.ping ?? 0) > 200 && (
        <div className="arena-connection" role="status">
          Высокая задержка · {me?.ping} мс
        </div>
      )}
      {snapshot?.events
        .filter((e) => e.kind === 'damage' && e.player === self && snapshot.time - e.time < 0.65)
        .slice(-1)
        .map((e) => (
          <div
            key={e.id}
            className="arena-damage"
            style={{ transform: `translate(-50%, -50%) rotate(${(e.sector ?? 0) * 45}deg)` }}
            aria-label="Направление полученного урона"
          >
            ▲
          </div>
        ))}
      {snapshot?.events.some(
        (e) => e.kind === 'kill' && e.killer === self && snapshot.time - e.time < 1.2,
      ) && <div className="arena-confirm">Устранение подтверждено</div>}
      {error && (
        <div className="arena-connection" role="alert">
          {error}
        </div>
      )}
      {(tab || ended) && (
        <div className="arena-score-layer">
          <h2>
            {ended ? (winnerName ? `Победа: ${winnerName}` : 'Матч завершён') : 'Таблица счёта'}
          </h2>
          {ended && (
            <>
              <p>{room.result?.reason}</p>
              <h3>
                {room.settings.mode === 'dm'
                  ? `1 место: ${winnerName ?? 'ничья'} · ${sorted[0]?.kills ?? 0} убийств`
                  : `Итоговый счёт: ${(room.result?.scores ?? snapshot?.scores)?.Alpha ?? 0} : ${(room.result?.scores ?? snapshot?.scores)?.Bravo ?? 0}`}
              </h3>
              <p>
                Ваш результат:{' '}
                {me?.kills ?? room.result?.players.find((p) => p.id === self)?.kills ?? 0} убийств ·{' '}
                {me?.deaths ?? room.result?.players.find((p) => p.id === self)?.deaths ?? 0} смертей
              </p>
            </>
          )}
          <Scoreboard
            players={snapshot?.players ?? room.result?.players ?? []}
            mode={room.settings.mode}
            self={self}
          />
          {ended && (
            <div className="arena-actions">
              {room.host_id === self ? (
                <button className="primary" disabled={room.status !== 'finished'} onClick={lobby}>
                  Повторный матч
                </button>
              ) : (
                <button disabled title="Подготовку следующего матча открывает владелец комнаты">
                  Повторный матч · ожидаем владельца
                </button>
              )}
              <button disabled={room.status !== 'finished'} onClick={lobby}>
                Вернуться в комнату
              </button>
              <button onClick={leave}>Покинуть комнату</button>
            </div>
          )}
        </div>
      )}
      {showPauseMenu(locked, ended, tab, expanded, fullscreenMenuRequested) && (
        <div className="arena-pause">
          <div>
            <div className="eyebrow">GAMEHUB / ARENA</div>
            <h2>
              {phase === 'loading' || !snapshot ? 'Подготовка матча' : 'Пауза · матч продолжается'}
            </h2>
            <p>
              GameHub Arena · {manifest.map?.name ?? 'Depot 07'} · {modes[room.settings.mode]}
              {snapshot ? ' · соединение установлено' : ' · подключение…'}
            </p>
            <p>
              {phase === 'loading'
                ? 'Ожидаем загрузки карты у всех участников. Максимум 30 секунд.'
                : 'Нажмите кнопку для захвата мыши. Esc освобождает указатель; матч продолжается.'}
            </p>
            <button
              className="primary"
              onClick={() => void client.current?.lock()}
              disabled={!snapshot}
            >
              Продолжить · захватить мышь
            </button>
            <button
              onClick={() => {
                if (root.current) void client.current?.fullscreen(root.current);
              }}
            >
              {expanded ? 'Выйти из полного экрана' : 'На весь экран'}
            </button>
            <PlayerSettings value={prefs} onChange={setPrefs} />
            <button
              onClick={() => {
                if (confirmLeave()) leave();
              }}
            >
              Покинуть матч
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
