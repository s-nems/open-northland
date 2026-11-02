import { createSavedSessionMetadata, type GameSession } from '@open-northland/lockstep';
import type { RoomSeatSetup } from '@open-northland/net-protocol';
import { exportSaveGame } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  restoreSavedSeats,
  savedDayNightMode,
  savedRoster,
  savedWeatherMode,
} from '../../../../src/entries/main-menu/network/saved-roster.js';
import { runDemoWorld } from '../../../../src/game/world/index.js';

const descriptor: GameSession = {
  world: { kind: 'map', mapId: 'test' },
  seed: 7,
  localSeat: 0,
  speed: 2,
  rules: {
    fog: null,
    progression: null,
    needs: null,
    weather: null,
    dayNight: null,
    alliedVision: null,
    peace: null,
  },
  seats: [
    { player: 0, mode: 'human', color: 3, tribe: 7 },
    { player: 1, mode: 'computer', color: 4 },
  ],
};
const authored: RoomSeatSetup[] = [
  {
    player: 0,
    mode: 'idle',
    claimable: true,
    offers: ['computer', 'idle', 'absent'],
    color: 0,
    authoredTribe: 1,
  },
  { player: 1, mode: 'idle', claimable: false, offers: ['idle'], color: 1, authoredTribe: 2 },
];
const metadata = createSavedSessionMetadata(descriptor, [
  { player: 0, nick: 'Ania' },
  { player: 1, nick: null },
]);
const save = exportSaveGame(runDemoWorld(7, 0), { mapId: 'test', session: metadata });

describe('saved multiplayer roster', () => {
  it('recovers colors, tribes and AI, leaving saved humans free for an explicit claim', () => {
    expect(restoreSavedSeats(save, authored)).toEqual([
      {
        player: 0,
        mode: 'idle',
        claimable: true,
        offers: ['computer', 'idle', 'absent'],
        color: 3,
        authoredTribe: 1,
        tribe: 7,
      },
      // The saved mode stays valid even where the map no longer offers it.
      {
        player: 1,
        mode: 'computer',
        claimable: false,
        offers: ['idle', 'computer'],
        color: 4,
        authoredTribe: 2,
      },
    ]);
    expect(savedRoster(save)?.roster[0]?.nick).toBe('Ania');
  });
  it('retains single-player reserved Map AI, Computer and Idle modes instead of resetting them to the map defaults', () => {
    const single = { ...save, header: { ...save.header, session: null } };
    const seats = [
      { player: 0, mode: 'idle' as const, color: 0 },
      { player: 1, mode: 'map-ai' as const, color: 1 },
      { player: 2, mode: 'computer' as const, color: 2 },
    ];
    const map = [
      ...authored.filter((seat) => seat.player === 0),
      { player: 1, color: 1, claimable: false, mode: 'map-ai' as const, offers: ['map-ai' as const] },
      {
        player: 2,
        mode: 'idle' as const,
        claimable: true,
        offers: ['computer' as const, 'idle' as const],
        color: 2,
      },
    ];
    const restored = restoreSavedSeats(single, map, seats);
    expect(restored.map((seat) => seat.mode)).toEqual(['idle', 'map-ai', 'computer']);
    expect(restored[2]?.offers).toContain('computer');
  });
  it('rejects a saved map AI on a selectable seat', () => {
    const single = { ...save, header: { ...save.header, session: null } };
    expect(() =>
      restoreSavedSeats(single, authored, [
        { player: 0, mode: 'map-ai', color: 0 },
        { player: 1, mode: 'idle', color: 1 },
      ]),
    ).toThrow(/authored reservation/);
  });
  it('keeps a saved computer seat’s level, and hard where the save names none', () => {
    const levelled = authored.map((seat) => ({ ...seat, difficulty: 'medium' as const }));
    const withLevel = createSavedSessionMetadata(
      {
        ...descriptor,
        seats: [
          { player: 0, mode: 'computer', color: 3, difficulty: 'easy' },
          { player: 1, mode: 'computer', color: 4 },
        ],
      },
      [
        { player: 0, nick: null },
        { player: 1, nick: null },
      ],
    );
    const restored = restoreSavedSeats({ ...save, header: { ...save.header, session: withLevel } }, levelled);
    expect(restored.map((seat) => seat.difficulty)).toEqual(['easy', 'hard']);
  });
  it('preserves the legacy fallback and distinguishes absent metadata from corrupt metadata', () => {
    expect(restoreSavedSeats({ ...save, header: { ...save.header, session: null } }, authored)).toEqual(
      authored,
    );
    expect(() => savedRoster({ ...save, header: { ...save.header, session: {} } })).toThrow();
  });
  it('reads the weather a relayed save recorded, else the one a single-player launch search named', () => {
    const winter = createSavedSessionMetadata(
      { ...descriptor, rules: { ...descriptor.rules, weather: 'winter' } },
      [
        { player: 0, nick: 'Ania' },
        { player: 1, nick: null },
      ],
    );
    expect(savedWeatherMode({ ...save, header: { ...save.header, session: winter } })).toBe('winter');
    expect(savedWeatherMode(save)).toBeNull();
    const single = { ...save.header, session: null, entry: '?map=test&weathermode=map' };
    expect(savedWeatherMode({ ...save, header: single })).toBe('map');
    expect(savedWeatherMode({ ...save, header: { ...single, entry: null } })).toBeNull();
  });
  it('reads the day and night mode a save played under from its descriptor or its entry URL', () => {
    const cycling = createSavedSessionMetadata(
      { ...descriptor, rules: { ...descriptor.rules, dayNight: 'on' } },
      [
        { player: 0, nick: 'Ania' },
        { player: 1, nick: null },
      ],
    );
    expect(savedDayNightMode({ ...save, header: { ...save.header, session: cycling } })).toBe('on');
    const single = { ...save.header, session: null, entry: '?map=test&daynight=off' };
    expect(savedDayNightMode({ ...save, header: single })).toBe('off');
    expect(savedDayNightMode({ ...save, header: { ...single, entry: null } })).toBeNull();
  });
  it('rejects a saved descriptor naming a different map, seed or roster', () => {
    expect(() => savedRoster({ ...save, header: { ...save.header, mapId: 'other' } })).toThrow(/world/);
    expect(() => savedRoster({ ...save, header: { ...save.header, seed: 8 } })).toThrow(/world/);
    expect(() => restoreSavedSeats(save, authored.slice(0, 1))).toThrow(/roster/);
  });
});
