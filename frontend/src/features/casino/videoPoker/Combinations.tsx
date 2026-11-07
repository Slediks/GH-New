import { points } from '../../../shared/api';
import type { CasinoGame, CasinoRound } from '../types';
import './combinations.css';

const explanations: Record<string, string> = {
  'Роял-флеш': '10, валет, дама, король и туз одной масти.',
  'Стрит-флеш': 'Пять карт подряд по достоинству и одной масти.',
  Каре: 'Четыре карты одного достоинства.',
  'Фулл-хаус': 'Три карты одного достоинства и две карты другого.',
  Флеш: 'Пять карт одной масти, не обязательно подряд.',
  Стрит: 'Пять карт подряд по достоинству. Туз может быть младшим: A–2–3–4–5.',
  Тройка: 'Три карты одного достоинства.',
  'Две пары': 'Две карты одного достоинства и две карты другого.',
  'Валеты или выше':
    'Одна пара валетов, дам, королей или тузов. Пары от двоек до десяток не оплачиваются.',
};

// Translate the already determined server rank; never evaluate cards or settle bets here.
export function combinationName(rank: unknown): string | null {
  if (!Array.isArray(rank) || typeof rank[0] !== 'number') return null;
  if (rank[0] === 8) return rank[1] === 14 ? 'Роял-флеш' : 'Стрит-флеш';
  if (rank[0] === 1) return rank[1] >= 11 ? 'Валеты или выше' : null;
  return (
    (
      { 7: 'Каре', 6: 'Фулл-хаус', 5: 'Флеш', 4: 'Стрит', 3: 'Тройка', 2: 'Две пары' } as Record<
        number,
        string
      >
    )[rank[0]] ?? null
  );
}

export function VideoPokerCombinations({
  rules,
  round,
}: {
  rules: CasinoGame['rules'];
  round: CasinoRound | null;
}) {
  const table = rules.payout as Record<string, number>;
  const order = Object.keys(explanations);
  const rows = Object.entries(table).sort(
    ([left], [right]) => order.indexOf(left) - order.indexOf(right),
  );
  const finished = !!round?.state.done && !round.state.cancel_reason;
  const name = finished ? combinationName(round.state.combination) : null;
  const winning = name != null && Object.hasOwn(table, name);
  return (
    <section className="video-poker-combinations" aria-label="Комбинации и выплаты видеопокера">
      {finished && (
        <div className="casino-result video-poker-result" role="status">
          <strong>{winning ? `${name} · ×${table[name]}` : 'Нет оплачиваемой комбинации'}</strong>
          <span>
            {winning
              ? explanations[name]
              : 'Нужна пара валетов или старше либо другая комбинация из таблицы.'}
          </span>
          <b>Выплата: {points(round.state.payout ?? 0)} шейкелей</b>
        </div>
      )}
      <h3>Комбинации и выплаты</h3>
      <p>
        Оплачивается только лучшая комбинация. Множитель включает возврат ставки: ×1 возвращает
        ставку без прибыли.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Комбинация</th>
            <th scope="col">Какие карты нужны</th>
            <th scope="col">Выплата</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, multiplier]) => (
            <tr
              key={label}
              className={winning && label === name ? 'current-combination' : undefined}
              aria-current={winning && label === name ? 'true' : undefined}
            >
              <th scope="row">
                {label}
                {winning && label === name && <small>Ваша комбинация</small>}
              </th>
              <td>{explanations[label] ?? 'См. правила игры.'}</td>
              <td>×{multiplier}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
