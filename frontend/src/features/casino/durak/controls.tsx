export function TurnStatus({
  label,
  myTurn,
  defending,
  taking,
  hasBoard,
}: {
  label: string;
  myTurn: boolean;
  defending: boolean;
  taking: boolean;
  hasBoard: boolean;
}) {
  return (
    <div className="durak-turn" role="status">
      <strong>{label}</strong>
      {myTurn && (
        <small>
          {defending
            ? 'Выберите атаку на столе, затем старшую карту той же масти или козырь'
            : taking
              ? 'Защитник берёт карты. Подкиньте подходящий ранг или закончите ход'
              : hasBoard
                ? 'Подкиньте ранг со стола или пропустите'
                : 'Выберите карту для атаки'}
        </small>
      )}
    </div>
  );
}

export function TurnActions({
  canTake,
  canPass,
  passLabel,
  spectator,
  move,
}: {
  canTake: boolean;
  canPass: boolean;
  passLabel: string;
  spectator: boolean;
  move: (action: string) => void;
}) {
  return (
    <div className="durak-actions">
      {canTake && <button onClick={() => move('take')}>Взять</button>}
      {canPass && <button onClick={() => move('pass')}>{passLabel}</button>}
      {spectator && <small>Вы наблюдаете за партией</small>}
    </div>
  );
}
