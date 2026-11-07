// Development-only entry: not imported by index.html or included in production output.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Pitch } from '../src/features/football/Pitch';
import { Statistics } from '../src/features/football/Statistics';
import type { Snapshot, Team } from '../src/shared/types';
import '../src/app/styles.css';

function Review() {
  const [value, setValue] = useState<{snapshot: Snapshot; teams: Team[]} | null>(null);
  useEffect(() => {
    const receive = (event: Event) => setValue((event as CustomEvent).detail);
    window.addEventListener('review-frame', receive);
    return () => window.removeEventListener('review-frame', receive);
  }, []);
  return <main style={{maxWidth:1000, margin:'auto', padding:16}}>
    <h2>Просмотр движка 2.0</h2>
    <p>{value?.teams.map(t=>`${t.name}: ${t.style_label}`).join(' — ')}</p>
    <div data-testid="review-score">{value?.snapshot.clock} сек. · {value?.snapshot.score.join(' : ')} · {value?.snapshot.phase}</div>
    <Pitch snapshot={value?.snapshot ?? null} teams={value?.teams ?? []} />
    <Statistics statistics={value?.snapshot.statistics ?? {}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Review />);
