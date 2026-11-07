import type { CSSProperties } from 'react';
import './race.css';
import { finishOrder, type RaceParticipant } from './racePresentation';
import './raceBroadcast.css';

// Positions are server progress in ten-thousandths. CSS only interpolates
// between received positions; it never predicts the winner or race clock.
export function HorseRace({
  horses,
  positions,
  phase,
  winners,
  times,
  roundId,
  secondsToStart,
  liveDelivery,
}: {
  horses: RaceParticipant[];
  positions: number[];
  phase: string;
  winners?: number[];
  times?: number[];
  roundId: string;
  secondsToStart: number;
  liveDelivery: boolean;
}) {
  const furthest = Math.max(0, ...positions);
  const leaders = horses.filter((_, index) => furthest > 0 && positions[index] === furthest);
  const order = phase === 'result' ? finishOrder(times, horses.length) : [];
  return (
    <div className={`race-course ${phase === 'live' ? 'running' : ''}`}>
      <div className="race-scoreboard">
        <div>
          <span className="race-live-tag">{phase === 'live' ? 'LIVE' : 'GAMEHUB SPORT'}</span>
          <small>Заезд {roundId.slice(0, 8)}</small>
        </div>
        <div className="race-broadcast-status">
          <strong>
            {phase === 'live' ? 'Забег' : phase === 'betting' ? 'Ставки открыты' : 'Финиш'}
          </strong>
          <small>
            {phase === 'betting'
              ? `До старта ${secondsToStart} сек.`
              : phase === 'live'
                ? leaders.length
                  ? `Впереди: ${leaders.map((horse) => horse.name).join(' / ')}`
                  : 'Старт'
                : 'Заезд завершён'}
          </small>
        </div>
        <span className="race-signal">
          {liveDelivery ? '● Прямой эфир' : 'Обновление трансляции'}
        </span>
      </div>
      <div className="race-track-heading">
        <span>СТАРТОВЫЕ ПОЗИЦИИ</span>
        <span>ФИНИШ</span>
      </div>
      <div className="race-lanes">
        {horses.map((horse, index) => (
          <div
            className={`race-lane ${winners?.includes(index) ? 'winner' : ''}`}
            key={horse.name}
            style={{ '--silk': horse.color } as CSSProperties}
          >
            <div className="race-label">
              <b>{index + 1}</b>
              <span>
                {horse.name}
                <small>Участник заезда</small>
              </span>
              {winners?.includes(index) && <em>1 место</em>}
            </div>
            <div className="race-rail">
              <div
                className="race-runner"
                style={{ left: `${Math.min(100, Math.max(0, positions[index] ?? 0) / 100)}%` }}
              >
                <svg viewBox="0 0 80 58" role="img" aria-label={horse.name}>
                  <ellipse cx="38" cy="52" rx="29" ry="3" fill="#0003" />
                  <g className="race-horse">
                    <path
                      d="M14 28Q9 20 3 26L7 30Q8 25 14 34M18 33L12 47L19 48L27 35M49 33L58 48L64 47L56 28"
                      fill="none"
                      stroke="#603b26"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M15 26Q29 19 48 25L54 10L64 6L66 11L75 20L70 25L60 20L57 34Q42 42 23 35L15 32Z"
                      fill="#b98753"
                      stroke="#603b26"
                      strokeWidth="2"
                    />
                    <path
                      className="race-legs"
                      d="M26 35L29 48L35 49M48 35L44 48L51 49"
                      fill="none"
                      stroke="#ab7546"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M54 11L51 26M62 7L58 2L56 10"
                      fill="#513222"
                      stroke="#513222"
                      strokeWidth="3"
                    />
                    <circle cx="65" cy="14" r="1.5" fill="#181811" />
                    <path d="M29 23L42 23L44 31L30 31Z" fill="var(--silk)" />
                    <text x="36" y="30" className="race-saddle-number">
                      {index + 1}
                    </text>
                    <path
                      d="M35 24L38 15L47 16L52 22M39 23L34 30L42 35"
                      fill="none"
                      stroke="var(--silk)"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                    <circle cx="46" cy="10" r="5" fill="#f2c99d" />
                    <path d="M41 9A5 5 0 0 1 51 9Z" fill="var(--silk)" />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>
      {phase === 'result' && !!winners?.length && (
        <section className="race-finish" aria-label="Итоги заезда">
          <small>{winners.length > 1 ? 'РАЗДЕЛЁННОЕ ПЕРВОЕ МЕСТО' : 'ПОБЕДИТЕЛЬ ЗАЕЗДА'}</small>
          <h3>
            {winners.map((index) => `№${index + 1} ${horses[index]?.name ?? ''}`).join(' / ')}
          </h3>
          {order.length > 0 && (
            <ol className="race-finish-order">
              {order.map(({ index, place }) => (
                <li key={index}>
                  <b>{place}</b>
                  <span style={{ color: horses[index].color }}>●</span> №{index + 1}{' '}
                  {horses[index].name}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      <p className="race-caption">
        При разделённом первом месте выплата делится между победившими лошадьми
      </p>
    </div>
  );
}
