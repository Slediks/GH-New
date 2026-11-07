const rows = [
  ['shots', 'Удары', ''],
  ['on_target', 'В створ', ''],
  ['saves', 'Сейвы', ''],
  ['possession', 'Владение', '%'],
  ['pass_accuracy', 'Точность передач', '%'],
] as const;

export function Statistics({ statistics }: { statistics: Record<string, number[]> }) {
  return (
    <div className="football-statistics" aria-label="Статистика матча">
      {rows.map(([key, label, suffix]) => (
        <div className="football-stat" key={key}>
          <strong>{statistics[key] ? `${statistics[key][0]}${suffix}` : '—'}</strong>
          <span>{label}</span>
          <strong>{statistics[key] ? `${statistics[key][1]}${suffix}` : '—'}</strong>
        </div>
      ))}
    </div>
  );
}
