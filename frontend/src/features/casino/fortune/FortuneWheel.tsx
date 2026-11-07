import { SECTORS, sectorAngle } from './model';
import { useFortuneMotion } from './useFortuneMotion';
import './fortune.css';

export function FortuneWheel(props: {
  id: string;
  phase: string;
  result?: number;
  sectors: string[];
  payouts: Record<string, [number, number]>;
  risk: string;
  animateResult?: boolean;
  appearance?: typeof SECTORS;
  personal?: boolean;
  onSettling: (id: string) => void;
  onLanded: (id: string) => void;
}) {
  const { rotor, phase, landed } = useFortuneMotion({ ...props, count: props.sectors.length });
  const appearance = props.appearance ?? SECTORS;
  const selected = landed ? props.sectors[landed.index] : undefined;
  const status = {
    ready: 'Сделайте свой выбор',
    accelerating: 'Разгон',
    spinning: 'Колесо вращается',
    braking: 'Колесо замедляется',
    result: selected ? appearance[selected]?.name : 'Результат',
  }[phase];
  const step = 360 / props.sectors.length;
  const polar = (angle: number, radius: number) => {
    const radians = ((angle - 90) * Math.PI) / 180;
    return `${Math.cos(radians) * radius},${Math.sin(radians) * radius}`;
  };
  return (
    <div className={`fortune-show phase-${phase}`} data-phase={phase}>
      <div className="fortune-title">
        <small>{props.personal ? 'ВАШЕ ЛИЧНОЕ ВРАЩЕНИЕ' : 'ОБЩИЙ РАУНД · КОЛЕСО УДАЧИ'}</small>
        <h3>
          {props.personal
            ? 'Личное колесо'
            : props.risk === 'low'
              ? 'Сияние золота'
              : props.risk === 'medium'
                ? 'Цветная призма'
                : 'Алмазная ночь'}
        </h3>
      </div>
      <div className="fortune-machine">
        <svg viewBox="-240 -240 480 480" role="img" aria-label={`Колесо удачи: ${status}`}>
          <circle r="226" className="fortune-rim" />
          {Array.from({ length: 48 }, (_, i) => (
            <circle
              key={i}
              cx={Math.cos((i * Math.PI) / 24) * 216}
              cy={Math.sin((i * Math.PI) / 24) * 216}
              r="3"
              className="fortune-bulb"
            />
          ))}
          <g ref={rotor} className="fortune-rotor">
            {props.sectors.map((sector, index) => {
              const center = sectorAngle(index, props.sectors.length);
              const fraction = props.payouts[sector];
              const multiplier = fraction
                ? (fraction[0] / fraction[1]).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
                : '—';
              return (
                <g
                  key={index}
                  className={`fortune-sector ${index % 2 ? 'alternate' : ''} ${landed?.index === index ? 'winner' : ''}`}
                  data-index={index}
                >
                  <path
                    d={`M0,0 L${polar(center - step / 2, 202)} A202,202 0 ${step > 180 ? 1 : 0} 1 ${polar(center + step / 2, 202)} Z`}
                    fill={appearance[sector]?.color ?? '#344a5b'}
                  />
                  <g transform={`rotate(${center})`}>
                    <text y="-173" className="fortune-glyph">
                      {appearance[sector]?.symbol}
                    </text>
                    <text y="-137" className="fortune-value">
                      ×{multiplier}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
          <circle r="59" className="fortune-hub" />
          <circle r="49" className="fortune-hub-inner" />
          <text y="5" className="fortune-hub-icon">
            ◆
          </text>
          <text y="27" className="fortune-hub-label">
            GAMEHUB
          </text>
          <path className="fortune-needle" d="M-14,-230 Q0,-240 14,-230 L0,-191 Z" />
        </svg>
      </div>
      <div className="fortune-announcement" role="status">
        <small>{phase === 'result' ? 'ВЫПАВШИЙ СЕКТОР' : 'СЛЕДИТЕ ЗА УКАЗАТЕЛЕМ'}</small>
        <strong>{status}</strong>
      </div>
      <div className="fortune-paytable">
        {Object.entries(props.payouts).map(([sector, fraction]) => (
          <span key={sector}>
            <i style={{ background: appearance[sector]?.color }} />
            {props.personal
              ? `${props.sectors.filter((value) => value === sector).length}/${props.sectors.length}`
              : appearance[sector]?.name}
            <b>
              ×{(fraction[0] / fraction[1]).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}
