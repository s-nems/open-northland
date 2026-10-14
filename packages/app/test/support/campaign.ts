import { Campaign } from '@open-northland/data';
export const campaignFixture = (): Campaign =>
  Campaign.parse({
    id: 'test',
    language: 'pol',
    title: 'Campaign',
    campaignId: 3,
    maps: [
      { id: 'first', missionId: 10 },
      { id: 'child', missionId: 11 },
      { id: 'second', missionId: 20 },
    ],
    stages: [
      { mapId: 'first', title: 'First', x: 0.2, y: 0.3 },
      { mapId: 'second', title: 'Second', x: 0.5, y: 0.6 },
    ],
    background: '/campaigns/test/map.png',
    videos: [],
  });
export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
  };
}
