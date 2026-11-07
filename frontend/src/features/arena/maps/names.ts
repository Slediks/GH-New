export const mapName = (id?: string) =>
  ({ depot_07: 'Depot 07', foundry: 'Foundry', outpost: 'Outpost' })[id ?? 'depot_07'] ?? id;
