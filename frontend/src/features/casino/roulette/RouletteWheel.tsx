import { wheelOrder, rouletteColor } from './model';
import { useWheelMotion } from './useWheelMotion';
export function RouletteWheel({
  roundId,
  phase,
  result,
  onLanded,
  onSettling,
}: {
  roundId: string;
  phase: string;
  result?: number;
  onLanded: (id: string, number: number) => void;
  onSettling: (id: string) => void;
}) {
  const { pose, landed } = useWheelMotion(roundId, phase, result, onLanded, onSettling);
  return (
    <div
      className="roulette-instrument"
      data-landed={landed}
      data-wheel-angle={pose.wheel}
      data-ball-angle={pose.ball}
      aria-label={
        landed && result !== undefined ? `Выпало ${result}` : 'Европейское колесо, одно зеро'
      }
    >
      <div className="roulette-rim" />
      <svg
        className="roulette-rotor"
        viewBox="-150 -150 300 300"
        style={{ transform: `rotate(${pose.wheel}deg)` }}
        aria-hidden="true"
      >
        <circle r="141" fill="#30271d" stroke="#c9a260" strokeWidth="2" />
        {wheelOrder.map((number, sector) => {
          const half = Math.PI / 37;
          const angle = sector * 2 * half - Math.PI / 2;
          const start = angle - half,
            end = angle + half;
          return (
            <g key={number}>
              <path
                d={`M${88 * Math.cos(start)},${88 * Math.sin(start)} L${133 * Math.cos(start)},${133 * Math.sin(start)} A133,133 0 0 1 ${133 * Math.cos(end)},${133 * Math.sin(end)} L${88 * Math.cos(end)},${88 * Math.sin(end)} A88,88 0 0 0 ${88 * Math.cos(start)},${88 * Math.sin(start)}Z`}
                fill={
                  number === 0 ? '#166849' : rouletteColor(number) === 'red' ? '#a42a3b' : '#172024'
                }
                stroke="#d8bb80"
                strokeWidth=".6"
              />
              <text
                transform={`rotate(${(sector * 360) / 37})`}
                x="0"
                y="-117"
                textAnchor="middle"
                fill="#fff7df"
                fontSize="10"
                fontWeight="700"
              >
                {number}
              </text>
              <path
                d={`M${68 * Math.cos(angle)},${68 * Math.sin(angle)} L${88 * Math.cos(angle)},${88 * Math.sin(angle)}`}
                stroke="#b18b51"
                strokeWidth="1"
              />
            </g>
          );
        })}
        <circle r="68" fill="#423022" stroke="#b79252" strokeWidth="3" />
        <circle r="49" fill="#1b2927" stroke="#c5a66a" />
        <path d="M-38,0 H38 M0,-38 V38" stroke="#d9bd80" strokeWidth="5" />
        <circle r="12" fill="#e1c68f" />
      </svg>
      <svg className="roulette-ball-layer" viewBox="-150 -150 300 300" aria-hidden="true">
        <g transform={`rotate(${pose.ball})`}>
          <circle cx="0" cy={-pose.radius} r="4.5" fill="ivory" stroke="#b9ac8a" strokeWidth=".7" />
        </g>
      </svg>
      <div className="roulette-wheel-caption">
        <small>EUROPEAN</small>
        <strong>{landed ? 'Шарик остановился' : 'Одно зеро · 37 секторов'}</strong>
      </div>
    </div>
  );
}
