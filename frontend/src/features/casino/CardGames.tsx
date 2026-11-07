import { useState } from 'react';
import { points } from '../../shared/api';
import { Cards } from './Cards';
import type { CasinoRound, PlayingCard } from './types';

type Move = (action: string, options?: Record<string, unknown>) => void;
export function CardGames({
  round,
  move,
  busy,
}: {
  round: CasinoRound;
  move: Move;
  busy: boolean;
}) {
  const [held, setHeld] = useState<number[]>([]);
  const state = round.state;
  if (round.game === 'blackjack') {
    const hands = state.hands as {
      cards: PlayingCard[];
      stake: number;
      payout?: number;
      total?: number;
      done?: boolean;
    }[];
    const insurance = state.insurance as
      | { status: string; cost?: number; stake: number; payout?: number }
      | undefined;
    return (
      <>
        <div className="blackjack-dealer">
          <h3>
            Дилер{' '}
            {state.dealer_total != null && (
              <span className="card-total">{String(state.dealer_total)}</span>
            )}
          </h3>
          <Cards cards={state.dealer as (PlayingCard | null)[]} />
          <p className="blackjack-table-mark">BLACKJACK 3:2 · ДИЛЕР СТОИТ НА SOFT 17</p>
        </div>
        {insurance?.status === 'offered' && (
          <div className="casino-insurance" role="status">
            <h3>У дилера туз · страховка</h3>
            <p>
              Дополнительная ставка {points(insurance.cost ?? 0)} ш. При блэкджеке дилера вернётся{' '}
              {points((insurance.cost ?? 0) * 3)} ш., иначе страховка проиграет.
            </p>
            <small>Решение добровольное. Через 60 секунд — отказ от страховки.</small>
          </div>
        )}
        {insurance?.status === 'accepted' && (
          <p>
            Страховка: {points(insurance.stake)} ш. · возврат {points(insurance.payout ?? 0)} ш.
          </p>
        )}
        {hands.map((hand, index) => (
          <div key={index} className={state.index === index ? 'casino-hand active' : 'casino-hand'}>
            <h3>
              Рука {index + 1} · {points(hand.stake)} ш.{' '}
              {hand.total != null && (
                <span className="card-total">
                  {hand.total > 21 ? `Перебор · ${hand.total}` : hand.total}
                </span>
              )}
            </h3>
            <Cards cards={hand.cards} />
            {hand.payout !== undefined && <p>Возврат: {points(hand.payout)}</p>}
          </div>
        ))}
        <div className="actions">
          {(state.actions as string[]).map((action) => (
            <button key={action} disabled={busy} onClick={() => move(action)}>
              {
                (
                  {
                    hit: 'Ещё',
                    stand: 'Хватит',
                    double: 'Удвоить',
                    split: 'Разделить',
                    insure: 'Застраховать',
                    decline_insurance: 'Без страховки',
                  } as Record<string, string>
                )[action]
              }
            </button>
          ))}
        </div>
      </>
    );
  }
  if (round.game === 'video_poker')
    return (
      <>
        <div className="video-poker-title">
          <small>JACKS OR BETTER · 9/6</small>
          <h3>{state.done ? 'Итоговая комбинация' : 'Какие карты оставить?'}</h3>
          <p>
            {state.done
              ? 'Раздача завершена. Выплата включает возврат ставки.'
              : 'Выберите карты для удержания. Остальные заменяются один раз.'}
          </p>
        </div>
        <Cards
          cards={state.cards as PlayingCard[]}
          held={held}
          toggle={
            state.done || busy
              ? undefined
              : (index) =>
                  setHeld((values) =>
                    values.includes(index)
                      ? values.filter((value) => value !== index)
                      : [...values, index],
                  )
          }
        />
        {!state.done && (
          <button disabled={busy} onClick={() => move('draw', { held })}>
            Заменить остальные
          </button>
        )}
      </>
    );
  const choices = state.options as Record<string, { probability: number[]; payout: number }>;
  return (
    <div className="higher-lower-scene">
      <div className="higher-lower-progress">
        <span>Серия {String(state.steps)} / 10</span>
        <strong>Равенство рангов — проигрыш</strong>
      </div>
      <div className="higher-lower-current">
        <Cards cards={(state.cards as PlayingCard[]).slice(-1)} />
        <span className="higher-lower-next" aria-hidden="true">
          ?
        </span>
      </div>
      {(state.cards as PlayingCard[]).length > 1 && (
        <details>
          <summary>Карты этой серии</summary>
          <Cards cards={(state.cards as PlayingCard[]).slice(0, -1)} />
        </details>
      )}
      <div className="actions higher-lower-actions">
        {Object.entries(choices).map(([direction, choice]) => (
          <button
            key={direction}
            disabled={busy || !choice.probability[0]}
            onClick={() => move(direction)}
          >
            <strong>{direction === 'higher' ? '↑ Выше' : '↓ Ниже'}</strong>
            <span>Шанс {choice.probability.join('/')}</span>
            <b>{points(choice.payout)} ш.</b>
          </button>
        ))}
      </div>
    </div>
  );
}
