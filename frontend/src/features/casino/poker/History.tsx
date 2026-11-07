import { actionText, streets, type Round } from './presentation';
export function History({ round }: { round: Round | null }) {
  if (!round?.state.last_actions?.length) return null;
  return (
    <details className="holdem-history" open>
      <summary>Действия раздачи</summary>
      <ol>
        {round.state.last_actions.slice(-8).map((action, i) => (
          <li key={i}>
            <strong>
              {round.player === action.player ? 'Вы' : round.labels[action.player]?.label}
            </strong>
            <span>{actionText(action.action, action.total)}</span>
            <small>{streets[action.street]}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}
