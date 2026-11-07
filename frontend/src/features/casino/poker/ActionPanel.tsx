import { useState } from 'react';
import { points } from '../../../shared/api';
import { amountText, parseAmount, presetTotal, raiseRange, type Round } from './presentation';

export function ActionPanel({
  round,
  busy,
  bigBlind,
  send,
}: {
  round: Round;
  busy: boolean;
  bigBlind: number;
  send: (action: string, value?: string) => void;
}) {
  const state = round.state,
    options = state.options;
  const { min, max } = raiseRange(options);
  const [draft, setDraft] = useState(amountText(min));
  const value = parseAmount(draft);
  const valid = value !== null && value >= min && value <= max;
  const pot = state.players.reduce((sum, p) => sum + p.committed, 0);
  const bet = state.current_bet === 0;
  const allIn = valid && value === max;
  const select = (value: number) => setDraft(amountText(Math.min(max, Math.max(min, value))));
  return (
    <section className="holdem-actions panel" aria-label="Ваше решение">
      <div className="holdem-decision-context">
        <strong>Ваш ход</strong>
        <span>
          {options.check ? 'Доступен чек' : `${points(options.call ?? 0)} для колла`} · банк{' '}
          {points(pot)}
        </span>
      </div>
      <div className="holdem-primary-actions">
        {!options.check && (
          <button disabled={busy} onClick={() => send('fold')}>
            Фолд
          </button>
        )}
        <button disabled={busy} onClick={() => send(options.check ? 'check' : 'call')}>
          {options.check
            ? 'Чек'
            : `Колл ${points(options.call ?? 0)}${options.call === state.players[round.player!]?.stack ? ' · All-in' : ''}`}
        </button>
        {options.can_raise && (
          <button
            className="holdem-raise-submit"
            disabled={busy || !valid}
            onClick={() => valid && send('raise', amountText(value))}
          >
            {bet ? 'Бет' : 'Рейз'} {allIn ? 'All-in ' : 'до '}
            {valid ? points(value) : '—'}
          </button>
        )}
      </div>
      {options.can_raise && (
        <BetSizing
          draft={draft}
          setDraft={setDraft}
          select={select}
          value={value}
          valid={valid}
          min={min}
          max={max}
          busy={busy}
          step={bigBlind}
          bet={bet}
          preset={(n, d) =>
            select(presetTotal(pot, options.call ?? 0, state.current_bet, n, d, min, max))
          }
        />
      )}
    </section>
  );
}

function BetSizing({
  draft,
  setDraft,
  select,
  value,
  valid,
  min,
  max,
  busy,
  step,
  bet,
  preset,
}: {
  draft: string;
  setDraft: (value: string) => void;
  select: (value: number) => void;
  value: number | null;
  valid: boolean;
  min: number;
  max: number;
  busy: boolean;
  step: number;
  bet: boolean;
  preset: (n: number, d: number) => void;
}) {
  return (
    <div className="holdem-sizing">
      <label htmlFor="holdem-raise-size">{bet ? 'Размер ставки' : 'Рейз до'}</label>
      <div className="holdem-size-input">
        <button
          aria-label="Уменьшить ставку"
          disabled={busy || value === min}
          onClick={() => select((value ?? min) - step)}
        >
          −
        </button>
        <input
          id="holdem-raise-size"
          inputMode="decimal"
          value={draft}
          aria-invalid={!valid}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => select(value ?? min)}
        />
        <button
          aria-label="Увеличить ставку"
          disabled={busy || value === max}
          onClick={() => select((value ?? min) + step)}
        >
          +
        </button>
      </div>
      <input
        type="range"
        aria-label="Размер ставки, ползунок"
        min={min}
        max={max}
        step={1}
        value={valid ? value! : min}
        disabled={busy || min === max}
        onChange={(e) => select(Number(e.target.value))}
      />
      <div className="holdem-presets">
        <button disabled={busy} onClick={() => preset(1, 2)}>
          ½ банка
        </button>
        <button disabled={busy} onClick={() => preset(3, 4)}>
          ¾ банка
        </button>
        <button disabled={busy} onClick={() => preset(1, 1)}>
          Банк
        </button>
        <button disabled={busy} onClick={() => select(max)}>
          All-in · {points(max)}
        </button>
      </div>
      <small className={!valid ? 'invalid' : ''}>
        От {points(min)} до {points(max)} · сумма за текущую улицу
        {!valid ? ' · Введите допустимую сумму' : ''}
      </small>
    </div>
  );
}
