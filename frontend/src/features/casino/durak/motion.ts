import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { DuelTable } from '../duelTypes';

type Position = {
  x: number;
  y: number;
  width: number;
  height: number;
  zone: string;
  clone: HTMLElement;
};
export function useCardMotion(root: RefObject<HTMLDivElement | null>, table: DuelTable) {
  const previous = useRef<{
    cards: Map<string, Position>;
    anchors: Map<string, Position>;
    table: DuelTable;
  } | null>(null);
  const [moving, setMoving] = useState(false);
  const epoch = useRef(0);
  const state = table.round!.state;
  const signature = JSON.stringify([
    table.round!.id,
    state.board,
    state.cards,
    state.hand_sizes,
    state.deck_size,
    state.turn,
    state.taking,
    state.discard,
  ]);
  useLayoutEffect(() => {
    const generation = ++epoch.current;
    setMoving(false);
    const node = root.current!;
    const bounds = node.getBoundingClientRect();
    const position = (element: HTMLElement): Position => {
      const box = element.getBoundingClientRect();
      return {
        x: box.left - bounds.left,
        y: box.top - bounds.top,
        width: box.width,
        height: box.height,
        zone: element.dataset.zone ?? '',
        clone: element.cloneNode(true) as HTMLElement,
      };
    };
    const cards = new Map<string, Position>(),
      anchors = new Map<string, Position>();
    node
      .querySelectorAll<HTMLElement>('[data-card]')
      .forEach((element) => cards.set(element.dataset.card!, position(element)));
    node
      .querySelectorAll<HTMLElement>('[data-seat],[data-anchor]')
      .forEach((element) =>
        anchors.set(element.dataset.anchor ?? `seat:${element.dataset.seat}`, position(element)),
      );
    const old = previous.current;
    previous.current = { cards, anchors, table };
    if (
      !old ||
      old.table.round?.id !== table.round?.id ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const animations: Animation[] = [],
      ghosts: HTMLElement[] = [];
    const fly = (element: HTMLElement, from: Position, to: Position) => {
      animations.push(
        element.animate(
          [
            { transform: `translate(${from.x - to.x}px,${from.y - to.y}px)` },
            { transform: 'translate(0,0)' },
          ],
          { duration: 240, easing: 'ease-out' },
        ),
      );
    };
    node.querySelectorAll<HTMLElement>('[data-card]').forEach((element) => {
      const id = element.dataset.card!,
        dest = cards.get(id)!;
      const from =
        old.cards.get(id) ??
        (dest.zone === 'board'
          ? old.anchors.get(`seat:${old.table.round?.state.turn}`)
          : old.anchors.get('deck'));
      if (from && (!old.cards.has(id) || from.zone !== dest.zone)) fly(element, from, dest);
    });
    const defender = old.table.round!.state.defender ?? 1 - (old.table.round!.state.attacker ?? 0);
    for (const [id, from] of old.cards) {
      if (from.zone !== 'board' || cards.has(id)) continue;
      const taking =
        old.table.round!.state.taking ||
        (state.discard?.length ?? 0) === (old.table.round!.state.discard?.length ?? 0);
      const to = anchors.get(taking ? `seat:${defender}` : 'discard');
      if (!to) continue;
      const ghost = from.clone;
      ghost.removeAttribute('data-card');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {
        position: 'absolute',
        left: `${from.x}px`,
        top: `${from.y}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        pointerEvents: 'none',
        zIndex: '15',
      });
      node.appendChild(ghost);
      ghosts.push(ghost);
      animations.push(
        ghost.animate(
          [
            { transform: 'translate(0,0)', opacity: 1 },
            { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(.5)`, opacity: 0 },
          ],
          { duration: 240, easing: 'ease-in', fill: 'forwards' },
        ),
      );
    }
    // Only counts of opponents' new cards are public: animate card backs, never faces.
    table.participants
      .filter((p) => p.player !== table.round!.player)
      .forEach((p) => {
        const gained =
          (state.hand_sizes?.[p.player] ?? 0) -
          (old.table.round!.state.hand_sizes?.[p.player] ?? 0);
        if (gained <= 0 || (state.deck_size ?? 0) >= (old.table.round!.state.deck_size ?? 0))
          return;
        const to = anchors.get(`seat:${p.player}`),
          from = old.anchors.get('deck');
        if (!to || !from) return;
        const back = from.clone.querySelector<HTMLElement>('.durak-card.back')?.cloneNode(true) as
          | HTMLElement
          | undefined;
        if (!back) return;
        back.setAttribute('aria-hidden', 'true');
        Object.assign(back.style, {
          position: 'absolute',
          left: `${to.x}px`,
          top: `${to.y}px`,
          pointerEvents: 'none',
          zIndex: '15',
        });
        node.appendChild(back);
        ghosts.push(back);
        fly(back, from, to);
      });
    if (animations.length) {
      setMoving(true);
      void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
        ghosts.forEach((g) => g.remove());
        if (epoch.current === generation) setMoving(false);
      });
    }
    return () => {
      ++epoch.current;
      animations.forEach((a) => a.cancel());
      ghosts.forEach((g) => g.remove());
    };
    // Server snapshots drive motion, not local clicks or inferred game outcomes.
  }, [signature]);
  return moving;
}
