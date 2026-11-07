import './dice.css';

const pips = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function Die({ value, index }: { value: number | undefined; index: number }) {
  return (
    <div
      className={`duel-die ${value ? 'revealed' : 'waiting'}`}
      role="img"
      aria-label={value ? `Бросок ${index + 1}: выпало ${value}` : `Бросок ${index + 1}: ожидается`}
    >
      {value ? (
        Array.from({ length: 9 }, (_, dot) => (
          <i key={dot} className={pips[value].includes(dot) ? 'pip' : ''} />
        ))
      ) : (
        <b>?</b>
      )}
    </div>
  );
}

export function DiceScene({
  rolls,
  participants,
  winner,
  done,
}: {
  rolls: number[][];
  participants: { player: number; label: string; bot: boolean }[];
  winner?: number | null;
  done: boolean;
}) {
  const revealed = Math.min(...rolls.map((values) => values.length));
  return (
    <div className="dice-arena">
      <div className="dice-arena-heading">
        <span>ТРИ БРОСКА · ДВЕ СТОРОНЫ</span>
        <strong>
          {done
            ? 'Все броски раскрыты'
            : revealed >= 3
              ? 'Равный счёт · дополнительный бросок'
              : `Раскрыто ${revealed} из 3`}
        </strong>
      </div>
      <div className="dice-contestants">
        {rolls.map((values, player) => {
          const participant = participants.find((value) => value.player === player);
          return (
            <section
              key={player}
              className={`dice-contestant ${done && winner === player ? 'winner' : ''}`}
            >
              <div className="dice-player-heading">
                <h3>{participant?.label ?? `Игрок ${player + 1}`}</h3>
                {participant?.bot && <small>БОТ</small>}
              </div>
              <div className="dice-row">
                {Array.from({ length: 3 }, (_, index) => (
                  <Die key={index} index={index} value={values[index]} />
                ))}
              </div>
              {values.length > 3 && (
                <div className="dice-extra">
                  <small>Дополнительные броски</small>
                  <div className="dice-row">
                    {values.slice(3).map((value, index) => (
                      <Die key={index} index={index + 3} value={value} />
                    ))}
                  </div>
                </div>
              )}
              <div className="dice-score">
                <span>Сумма открытых бросков</span>
                <strong>{values.reduce((sum, value) => sum + value, 0)}</strong>
              </div>
              {done && winner === player && <b className="dice-victory">Победа</b>}
            </section>
          );
        })}
      </div>
      <p>При равной сумме — дополнительные парные броски до первого различия.</p>
    </div>
  );
}
