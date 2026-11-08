import { useState } from 'react';
import { ArenaMaps } from './editor/Maps';
import { AssetManager } from './assets/Manager';
import './arena.css';

export function ArenaCreator() {
  const [tab, setTab] = useState<'maps' | 'assets'>('maps');
  return <section className="arena-creator">
    <header><small>GAMEHUB ARENA</small><h1>Мастерская Арены</h1>
      <p>Ваши карты, совместные черновики и модели. Публикацию выполняет администратор.</p></header>
    <nav className="arena-creator-tabs" aria-label="Разделы мастерской">
      <button className={tab === 'maps' ? 'active' : ''} onClick={() => setTab('maps')}>Карты и prefab</button>
      <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>Модели</button>
    </nav>
    {tab === 'maps' ? <ArenaMaps /> : <AssetManager />}
  </section>;
}
