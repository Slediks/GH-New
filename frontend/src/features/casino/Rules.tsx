import type { CasinoGame } from './types';
import { points } from '../../shared/api';
import { PLAYER_RULES } from './playerRules';

const risks = ['low', 'medium', 'high'] as const;
const riskNames = { low: 'Низкий риск', medium: 'Средний риск', high: 'Высокий риск' };
const sectorNames: Record<string, string> = {
  bronze: 'Бронза',
  silver: 'Серебро',
  gold: 'Золото',
  diamond: 'Алмаз',
};
function coefficient(value: unknown) {
  const number = Array.isArray(value) ? Number(value[0]) / Number(value[1]) : Number(value);
  return Number.isFinite(number)
    ? `×${number.toLocaleString('ru-RU', { maximumFractionDigits: 8 })}`
    : '—';
}
function PayoutTable({ rows }: { rows: [string, unknown][] }) {
  return (
    <table className="casino-rule-table">
      <thead>
        <tr>
          <th>Исход</th>
          <th>Выплата со ставкой</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value], index) => (
          <tr key={index}>
            <th scope="row">{label}</th>
            <td>
              {typeof value === 'string' && value.startsWith('×') ? value : coefficient(value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function SlotPayouts({ game }: { game: CasinoGame }) {
  const rules = game.rules;
  if (Array.isArray(rules.payout_rows))
    return (
      <table className="casino-rule-table">
        <thead>
          <tr>
            <th>Комбинация</th>
            <th>Обычный режим</th>
            <th>Покупной режим</th>
          </tr>
        </thead>
        <tbody>
          {(rules.payout_rows as { label: string; normal: string[]; premium: string[] }[]).map(
            (row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>{coefficient(row.normal)}</td>
                <td>{coefficient(row.premium)}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    );
  const modes = rules.normalization as Record<string, [string, string]> | undefined;
  const symbols = rules.symbols as string[] | undefined;
  const pay = rules.payout;
  const rows: [string, number][] = [];
  if (game.id === 'slots_hold') {
    for (const coin of [1, 2, 5, 10, 25]) rows.push([`Монета ${coin}`, coin]);
  } else if (Array.isArray(pay)) {
    pay.forEach((line: number[], symbol) =>
      line.forEach((amount, index) =>
        rows.push([
          `${symbols?.[symbol] ?? `Символ ${symbol + 1}`} · ${index + 3} подряд`,
          amount / 5,
        ]),
      ),
    );
  }
  const modeNames = ['Обычный', 'Покупной'];
  return (
    <>
      <table className="casino-rule-table">
        <thead>
          <tr>
            <th>Комбинация</th>
            {modeNames.map((mode) => (
              <th key={mode}>{mode} режим</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, amount]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {modeNames.map((mode) => (
                <td key={mode}>
                  {modes?.[mode]
                    ? coefficient((amount * Number(modes[mode][0])) / Number(modes[mode][1]))
                    : 'См. выплату на поле'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Коэффициенты показаны до восьми знаков после запятой. Итоговая сумма округляется вниз до
        сотых после расчёта серии.
      </p>
    </>
  );
}
export function Rules({ game, omitPayout = false }: { game: CasinoGame; omitPayout?: boolean }) {
  const copy = PLAYER_RULES[game.id];
  const payout = game.rules.payout as Record<string, unknown> | undefined;
  return (
    <details className="panel casino-rules">
      <summary>Правила игры и выплаты</summary>
      <section>
        <h3>Как играть</h3>
        <p>
          {copy?.play ??
            'Следуйте подсказкам игрового поля. Доступные действия показаны рядом с игрой.'}
        </p>
      </section>
      <section>
        <h3>Выплаты</h3>
        <p>
          {game.multiplayer
            ? 'Стоимость участия или диапазон входа указаны на выбранном столе.'
            : `${game.id.startsWith('slots_') ? 'Базовая ставка' : 'Ставка'}: ${points(game.limits.minimum)}–${points(game.limits.maximum)} шейкелей.`}{' '}
          Коэффициенты обозначают выплату вместе со ставкой. При проигрыше выплата равна нулю, если
          не указан частичный возврат. Суммы округляются вниз до 0,01 шейкеля.
        </p>
        <p>{copy?.payout ?? 'Сумма выплаты показана на игровом поле.'}</p>
        {!omitPayout && ['blackjack', 'video_poker'].includes(game.id) && payout && (
          <PayoutTable
            rows={(game.id === 'blackjack'
              ? ['Победа', 'Натуральный блэкджек', 'Ничья']
              : [
                  'Роял-флеш',
                  'Стрит-флеш',
                  'Каре',
                  'Фулл-хаус',
                  'Флеш',
                  'Стрит',
                  'Тройка',
                  'Две пары',
                  'Валеты или выше',
                ]
            )
              .filter((key) => payout[key] !== undefined)
              .map((key) => [key, payout[key]])}
          />
        )}
        {!omitPayout &&
          ['wheel', 'plinko'].includes(game.id) &&
          payout &&
          risks.map((risk) => (
            <div key={risk}>
              <h4>{riskNames[risk]}</h4>
              <PayoutTable
                rows={
                  game.id === 'wheel'
                    ? Object.keys(sectorNames)
                        .filter(
                          (key) => (payout[risk] as Record<string, unknown>)?.[key] !== undefined,
                        )
                        .map((key) => [
                          sectorNames[key],
                          (payout[risk] as Record<string, unknown>)[key],
                        ])
                    : ((payout[risk] ?? []) as unknown[]).map((value, index) => [
                        `Ячейка ${index + 1} слева`,
                        value,
                      ])
                }
              />
            </div>
          ))}
        {!omitPayout && game.id === 'personal_wheel' && Array.isArray(game.rules.sectors_bps) && (
          <PayoutTable
            rows={game.rules.sectors_bps.map((value, index) => [
              `Сектор ${index + 1}`,
              Number(value) / 10000,
            ])}
          />
        )}
        {!omitPayout && game.id.startsWith('slots_') && <SlotPayouts game={game} />}
      </section>
      {copy?.special && (
        <section>
          <h3>Особые правила</h3>
          <p>{copy.special}</p>
        </section>
      )}
    </details>
  );
}
