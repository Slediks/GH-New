import { autoThreshold, getResultStatus } from './model';
import { useFlight } from './useFlight';

export function CrashScene({
  phase,
  multiplier,
  history,
  auto,
  autoEnabled,
  serverTime,
}: {
  phase: string;
  multiplier: number;
  history: { id: string; result: { point?: number } }[];
  auto: string;
  autoEnabled: boolean;
  serverTime: number;
}) {
  const { craft, curve, trail } = useFlight(phase, multiplier, serverTime);
  const threshold = autoThreshold(auto, autoEnabled);
  return (
    <div className={`crash-scene ${phase}`}>
      <div className="crash-scene-heading">
        <span>FLIGHT CONTROL</span>
        <small>
          {phase === 'live'
            ? 'Общий полёт'
            : phase === 'result'
              ? 'Полёт завершён'
              : 'Посадка на следующий рейс'}
        </small>
      </div>
      <div className="crash-number">
        <strong>×{(multiplier / 100).toFixed(2)}</strong>
        <span>
          {phase === 'live'
            ? 'Множитель сервера'
            : phase === 'result'
              ? 'CRASH'
              : 'Ожидание старта'}
        </span>
      </div>
      <svg
        viewBox="0 0 600 300"
        role="img"
        aria-label={`Полёт ${phase === 'result' ? 'завершился' : 'на множителе'} ×${multiplier / 100}`}
      >
        {[60, 110, 160, 210, 260].map((y) => (
          <path key={y} d={`M30,${y} H570`} stroke="#7a99ad25" strokeDasharray="3 8" />
        ))}
        <polyline
          ref={curve}
          fill="none"
          stroke={phase === 'result' ? '#ff6889' : '#51e0d2'}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <polyline ref={trail} fill="none" stroke="#fff8" strokeWidth="1" className="crash-trail" />
        <g ref={craft} className="crash-craft">
          <path d="M-18,12 L16,-17 L8,15 L0,5Z" fill={phase === 'result' ? '#ff6889' : '#e5fff7'} />
          <path d="M-14,18 L-28,30" stroke="#f1b76a" strokeWidth="5" />
        </g>
        <text x="30" y="287" fill="#a9c1d5" fontSize="11">
          Старт
        </text>
        <text x="550" y="287" textAnchor="end" fill="#a9c1d5" fontSize="11">
          Сейчас
        </text>
      </svg>
      <div className="crash-history" aria-label="История полётов">
        {history.map((item) => {
          const status = getResultStatus(item.result.point, threshold);
          const explanation =
            status === 'neutral'
              ? 'Без оценки автовывода'
              : status === 'high'
                ? 'Автовывод успел бы сработать'
                : 'Crash раньше или одновременно с автовыводом';
          return (
            <span
              key={item.id}
              className={status}
              title={explanation}
              aria-label={`×${((item.result.point ?? 100) / 100).toFixed(2)} · ${explanation}`}
            >
              ×{((item.result.point ?? 100) / 100).toFixed(2)}
            </span>
          );
        })}
      </div>
      <p className="crash-history-note">
        {threshold === null
          ? 'История без оценки: автовывод выключен или порог некорректен.'
          : `История относительно ×${(threshold / 100).toFixed(2)}: зелёный — выше порога. При равенстве приоритет у crash.`}
      </p>
    </div>
  );
}
