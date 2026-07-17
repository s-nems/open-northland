import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveMapScript } from '../src/stages/maps/script.js';

/**
 * The per-folder script resolution (`stages/maps/script.ts`): plaintext `player.inc`/`mission.inc`
 * → one MapScript, with roster names resolved through the map's string table. Fixtures are plain
 * ASCII (windows-1250 decodes ASCII 1:1); the reducer grammar itself is pinned in
 * `ini-map-script.test.ts`.
 */
describe('resolveMapScript', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'opennorthland-map-script-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('merges player.inc + mission.inc and resolves nametribe slot names', async () => {
    await writeFile(
      join(dir, 'player.inc'),
      '[playerdata]\nplayer 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_BLUE\n' +
        'player 1 #PLAYER_TYPE_AI #TRIBE_TYPE_HUMAN_FRANK #PLAYER_COLOR_ID_RED\n' +
        '[playermisc]\nnametribe 0 50\nnametribe 1 51\n',
    );
    await writeFile(
      join(dir, 'mission.inc'),
      '[MissionData]\ndebuginfo "Start"\nactive 1\ngoal "True"\nresult "Exit"\n',
    );
    const script = await resolveMapScript([dir], 'x/map.dat', undefined, {
      50: 'Ragnar',
      51: 'Rurik',
    });
    expect(script?.players).toEqual([
      { player: 0, type: 'human', tribeId: 1, colorId: 0, name: 'Ragnar' },
      { player: 1, type: 'ai', tribeId: 2, colorId: 1, name: 'Rurik' },
    ]);
    expect(script?.missions).toHaveLength(1);
    expect(script?.source?.file).toBe('x/player.inc+mission.inc');
  });

  it('keeps the roster nameless without a string table and yields undefined with no sources', async () => {
    await writeFile(
      join(dir, 'player.inc'),
      '[playerdata]\nplayer 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_BLUE\n',
    );
    const script = await resolveMapScript([dir], 'x/map.dat', undefined, undefined);
    expect(script?.players).toEqual([{ player: 0, type: 'human', tribeId: 1, colorId: 0 }]);
    expect(
      await resolveMapScript([dir.concat('-missing')], 'x/map.dat', undefined, undefined),
    ).toBeUndefined();
  });

  it('prefers already-decoded map.cif sections over the plaintext twins', async () => {
    await writeFile(
      join(dir, 'player.inc'),
      '[playerdata]\nplayer 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_BLUE\n',
    );
    const cifSections = [
      {
        name: 'playerdata',
        props: [{ key: 'player', values: ['0', '1', '4', '7'] }],
      },
    ];
    const script = await resolveMapScript([dir], 'x/map.dat', cifSections, undefined);
    expect(script?.players).toEqual([{ player: 0, type: 'human', tribeId: 4, colorId: 7 }]);
    expect(script?.source?.file).toBe('x/map.cif');
  });
});
