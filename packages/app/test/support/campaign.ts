import { Campaign } from '@open-northland/data';
export const campaignFixture = (): Campaign =>
  Campaign.parse({
    id: 'test',
    campaignId: 3,
    order: 0,
    title: { pol: 'Kampania', eng: 'Campaign' },
    languages: ['pol', 'eng'],
    maps: [
      { id: 'first', missionId: 10 },
      { id: 'child', missionId: 11 },
      { id: 'second', missionId: 20 },
    ],
    stages: [
      { mapId: 'first', title: { eng: 'First' }, x: 0.2, y: 0.3 },
      { mapId: 'second', title: { eng: 'Second' }, x: 0.5, y: 0.6 },
    ],
    background: '/campaigns/test/map.png',
    movies: {
      pol: {
        videos: [
          {
            url: '/campaigns/test/video/video-1.webm',
            audio: '/campaigns/test/pol/video-1.webm',
            width: 640,
            height: 480,
            sequence: 1,
          },
        ],
      },
      eng: {
        videos: [
          {
            url: '/campaigns/test/video/video-1.webm',
            audio: '/campaigns/test/eng/video-1.webm',
            width: 640,
            height: 480,
            sequence: 1,
          },
        ],
      },
    },
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
