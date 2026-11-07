import type { CasinoRound } from './types';
import './instant.css';

export function InstantGames({ round }: { round: CasinoRound }) {
  if (round.game === 'target')
    return (
      <div
        className={`casino-target-result target-scene ${round.state.outcome === 'win' ? 'won' : 'lost'}`}
      >
        <small>ВЫПАВШЕЕ ЧИСЛО · 0000–9999</small>
        <strong>{String(round.state.result).padStart(4, '0')}</strong>
        <div className="target-range" aria-label="Выигрышный диапазон и результат">
          <span
            style={{
              left: `${Number(round.state.low) / 100}%`,
              width: `${(Number(round.state.high) - Number(round.state.low) + 1) / 100}%`,
            }}
          />
          <i style={{ left: `${Number(round.state.result) / 99.99}%` }} />
        </div>
        <div className="target-ticks">
          <span>0000</span>
          <span>2500</span>
          <span>5000</span>
          <span>7500</span>
          <span>9999</span>
        </div>
        <p>
          Ваш диапазон: {String(round.state.low)}–{String(round.state.high)}, включая границы.
        </p>
      </div>
    );
  return null;
}
