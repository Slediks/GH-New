import type { CSSProperties } from 'react';
import { points } from '../../shared/api';
import './scenes.css';

export { CrashScene } from './crash/CrashScene';

export function PenaltyScene({
  shots,
  defense,
  payouts,
  disabled,
  shoot,
}: {
  shots: { zone: number; defended: number; goal: boolean }[];
  defense: number[];
  payouts: number[];
  disabled: boolean;
  shoot: (zone: number) => void;
}) {
  const last = shots.at(-1);
  const zoneX = [10, 30, 50, 70, 90];
  return (
    <div className="penalty-scene">
      <div className="penalty-scoreboard">
        <span>PENALTY ARENA</span>
        <strong>{shots.filter((shot) => shot.goal).length} / 5</strong>
        <small>{last ? (last.goal ? 'ГОЛ!' : 'СЕЙВ') : 'Выберите зону удара'}</small>
      </div>
      <div className="penalty-pitch">
        <div className="penalty-net" />
        <div
          className="penalty-keeper"
          style={{ left: `${last ? zoneX[last.defended] : 50}%` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 50 80">
            <circle cx="25" cy="12" r="9" fill="#ead6b0" />
            <path d="M13,27 L37,27 L32,52 H18Z" fill="#f3b544" />
            <path
              d="M14,31 L2,17 M36,31 L48,17 M20,51 L12,74 M30,51 L38,74"
              fill="none"
              stroke="#eaeaf2"
              strokeWidth="8"
              strokeLinecap="round"
            />
          </svg>
        </div>
        {last && (
          <span
            key={shots.length}
            className={`penalty-ball ${last.goal ? 'goal' : 'saved'}`}
            style={{ '--shot-x': `${zoneX[last.zone]}%` } as CSSProperties}
            aria-label={last.goal ? 'Мяч в воротах' : 'Мяч пойман'}
          >
            ⚽
          </span>
        )}
        <div className="penalty-zones">
          {defense.map((chance, zone) => (
            <button key={zone} disabled={disabled} onClick={() => shoot(zone)}>
              <b>{zone + 1}</b>
              <small>Сейв {chance}%</small>
              <strong>{points(payouts[zone])} ш.</strong>
            </button>
          ))}
        </div>
      </div>
      <p className="penalty-note">Номер зоны — ваш выбор. Скорость нажатия не влияет на исход.</p>
      <div className="penalty-series">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className={shots[index] ? (shots[index].goal ? 'goal' : 'saved') : ''}>
            {shots[index] ? (shots[index].goal ? '✓' : '×') : index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GameArtwork({ game }: { game: string }) {
  if (['chess', 'russian_checkers', 'short_backgammon', 'long_backgammon'].includes(game))
    return (
      <div className={`casino-game-art art-${game}`} aria-hidden="true">
        <svg viewBox="0 0 320 140">
          <rect
            x="38"
            y="7"
            width="244"
            height="126"
            rx="9"
            fill="#533820"
            stroke="#caa56a"
            strokeWidth="4"
          />
          {game.endsWith('backgammon') ? (
            Array.from({ length: 12 }, (_, i) => (
              <g key={i}>
                <path
                  d={`M${46 + i * 19},14 h18 l-9,48 Z M${46 + i * 19},126 h18 l-9,-48 Z`}
                  fill={i % 2 ? '#b67543' : '#e6cf9d'}
                />
                {(i === 1 || i === 5 || i === 9) && (
                  <>
                    <circle cx={55 + i * 19} cy="24" r="8" fill="#f7e5c3" />
                    <circle cx={55 + i * 19} cy="116" r="8" fill="#202b2c" />
                  </>
                )}
              </g>
            ))
          ) : (
            <>
              {Array.from({ length: 32 }, (_, i) => (
                <rect
                  key={i}
                  x={48 + (i % 8) * 28}
                  y={14 + Math.floor(i / 8) * 28}
                  width="28"
                  height="28"
                  fill={(i + Math.floor(i / 8)) % 2 ? '#d6c29d' : '#825f3e'}
                />
              ))}
              <text x="115" y="98" fontSize="82" fill="#fff0cd" fontFamily="Georgia">
                {game === 'chess' ? '♞' : '⛀'}
              </text>
            </>
          )}
        </svg>
      </div>
    );
  const cardGame = ['blackjack', 'holdem', 'durak', 'video_poker', 'higher_lower'].includes(game);
  return (
    <div className={`casino-game-art art-${game}`} aria-hidden="true">
      <svg viewBox="0 0 320 140">
        {cardGame ? (
          <>
            <ellipse cx="160" cy="100" rx="120" ry="30" fill="#2b695a" stroke="#ddc284" />
            {[-1, 0, 1].map((i) => (
              <g
                key={i}
                transform={`translate(${125 + i * 36},${25 + Math.abs(i) * 7}) rotate(${i * 15} 30 45)`}
              >
                <rect width="62" height="88" rx="7" fill="#fff1d6" />
                <text
                  x="9"
                  y="22"
                  fill={i === 0 ? '#be3d55' : '#1e343e'}
                  fontSize="18"
                  fontFamily="Georgia"
                >
                  {game === 'durak' ? '6' : game === 'video_poker' ? 'J' : 'A'}
                </text>
                <text
                  x="31"
                  y="62"
                  textAnchor="middle"
                  fill={i === 0 ? '#be3d55' : '#1e343e'}
                  fontSize="34"
                >
                  {i === 0 ? '♥' : '♠'}
                </text>
              </g>
            ))}
          </>
        ) : game.startsWith('slots') ? (
          <>
            <rect
              x="47"
              y="17"
              width="226"
              height="112"
              rx="15"
              fill="#382124"
              stroke="#e6c078"
              strokeWidth="5"
            />
            {[0, 1, 2].map((i) => (
              <g key={i}>
                <rect x={64 + i * 65} y="33" width="57" height="78" rx="6" fill="#fff0ce" />
                <text
                  x={92 + i * 65}
                  y="89"
                  textAnchor="middle"
                  fill="#b92946"
                  fontSize="55"
                  fontWeight="900"
                >
                  7
                </text>
              </g>
            ))}
          </>
        ) : ['roulette', 'wheel', 'personal_wheel'].includes(game) ? (
          <g transform="translate(160 70)">
            <circle r="64" fill="#553929" stroke="#e3bf78" strokeWidth="4" />
            {Array.from({ length: 20 }, (_, i) => (
              <path
                key={i}
                transform={`rotate(${i * 18})`}
                d="M0,0 L-8,-53 A54,54 0 0 1 8,-53Z"
                fill={i % 2 ? '#213f45' : game === 'wheel' ? '#dcad51' : '#b9434f'}
                stroke="#e3bf78"
              />
            ))}
            <circle r="22" fill="#213e32" stroke="#e3bf78" />
            <circle cy="-55" r="4" fill="white" />
          </g>
        ) : game === 'crash' ? (
          <>
            <path d="M35,114 C130,110 192,85 270,20" fill="none" stroke="#51e0d2" strokeWidth="5" />
            <path d="M246,26 L284,8 L268,45 L264,29Z" fill="#e7fff5" />
            {[0, 1, 2].map((i) => (
              <path key={i} d={`M40,${45 + i * 30} H280`} stroke="#afdcff22" />
            ))}
          </>
        ) : game === 'mines' ? (
          <>
            {Array.from({ length: 8 }, (_, i) => (
              <rect
                key={i}
                x={56 + (i % 4) * 54}
                y={20 + Math.floor(i / 4) * 52}
                width="45"
                height="45"
                rx="8"
                fill="#254d68"
                stroke="#5c8aac"
              />
            ))}
            <path d="M150,22 L173,45 L150,68 L127,45Z" fill="#69e2d2" />
            <path d="M150,22 L150,68 M127,45 H173" stroke="#d6fff2" />
          </>
        ) : game === 'ladder' ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <g key={i} transform={`translate(${75 + i * 32} ${100 - i * 25})`}>
                <rect width="76" height="13" rx="4" fill={i === 3 ? '#f6ce75' : '#7872bd'} />
                <path d="M8,13 V25 M68,13 V25" stroke="#d7caf0" strokeWidth="3" />
              </g>
            ))}
          </>
        ) : game === 'plinko' ? (
          <>
            {Array.from({ length: 6 }, (_, row) =>
              Array.from({ length: row + 2 }, (_, col) => (
                <circle
                  key={`${row}-${col}`}
                  cx={160 - (row + 1) * 15 + col * 30}
                  cy={20 + row * 19}
                  r="3"
                  fill="#a6bbf2"
                />
              )),
            )}
            <path
              d="M160,8 L175,27 L160,46 L175,65 L190,84 L175,103"
              fill="none"
              stroke="#f4a865"
              strokeWidth="3"
            />
            <circle cx="175" cy="103" r="8" fill="#ffd07b" />
          </>
        ) : game === 'target' ? (
          <>
            {[52, 37, 22, 7].map((r, i) => (
              <circle key={r} cx="160" cy="70" r={r} fill={i % 2 ? '#23394d' : '#5ec5dd'} />
            ))}
            <path
              d="M162,68 L235,20 M221,19 L240,14 L236,31"
              stroke="#f5cc7e"
              strokeWidth="4"
              fill="none"
            />
          </>
        ) : game === 'penalty' ? (
          <>
            <path d="M70,105 V28 H250 V105" fill="#1d5944" stroke="#e4ebd9" strokeWidth="5" />
            {[1, 2, 3, 4, 5].map((i) => (
              <path
                key={i}
                d={`M${70 + i * 30},28 V105 M70,${28 + i * 14} H250`}
                stroke="#ffffff35"
              />
            ))}
            <circle cx="160" cy="105" r="20" fill="#f9f4dc" />
            <path d="M154,91 L170,95 L173,111 L158,118 L148,105Z" fill="#253542" />
          </>
        ) : game === 'dice' ? (
          <>
            {[0, 1].map((i) => (
              <g key={i} transform={`translate(${80 + i * 94} 32) rotate(${i ? 12 : -12} 35 35)`}>
                <rect width="70" height="70" rx="12" fill="#f5e6c7" />
                {[0, 1, 2].map((j) => (
                  <circle key={j} cx={18 + j * 17} cy={18 + j * 17} r="5" fill="#253444" />
                ))}
              </g>
            ))}
          </>
        ) : (
          <>
            <path d="M30,115 H290 M30,100 H290" stroke="#9bbb7544" />
            <text x="160" y="110" textAnchor="middle" fontSize="120" fill="#e4bf79">
              ♞
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
