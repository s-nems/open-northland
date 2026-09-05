import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { describe, expect, it } from 'vitest';
import { cutsceneIdsOf, resolveMapBriefing } from '../src/stages/maps/briefing.js';
import { makeTempDir } from './support/game-tree.js';

const fs = nodeVfs();

/**
 * The per-folder briefing resolution (`stages/maps/briefing.ts`): a block id reads `briefings.txt`,
 * a page id reads `NNNN.hlt` with its includes, per language, and a folder without briefings yields
 * no sidecar. Fixtures are ASCII; the renderer itself is pinned in `hypertext.test.ts`.
 */

async function writeBriefings(dir: string, lang: string, files: Record<string, string>): Promise<void> {
  const briefingsDir = join(dir, 'text', lang, 'briefings');
  await mkdir(briefingsDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(briefingsDir, name), body);
}

describe('cutsceneIdsOf', () => {
  it('collects the PlayCutscene ids over every mission, ascending and unique', () => {
    const ids = cutsceneIdsOf({
      missions: [
        { goals: [], other: [], results: [{ key: 'result', values: ['PlayCutscene', '501', '1'] }] },
        {
          goals: [],
          other: [],
          results: [
            { key: 'result', values: ['PlayCutscene', '0', '1'] },
            { key: 'result', values: ['MissionWon', '0'] },
            { key: 'result', values: ['PlayCutscene', '501', '1'] },
            { key: 'result', values: ['PlayCutscene', 'x', '1'] },
          ],
        },
      ],
    });
    expect(ids).toEqual([0, 501]);
  });
});

describe('resolveMapBriefing', () => {
  it('renders block ids from briefings.txt and page ids from NNNN.hlt, per language', async () => {
    const { path: dir } = await makeTempDir('map-briefing');
    await writeBriefings(dir, 'pol', {
      'briefings.txt':
        '[blockstart:500]\n<font:$local$\\fonts\\fonthead16bld.fnt>\nTYTUL\n<font:$local$\\fonts\\font12.fnt>\nTresc\n[blockend:500]\n' +
        '[blockstart:00_title]\nPROLOG\n[blockend:00_title]\n',
      '0000.hlt': '<font:$local$\\fonts\\fonthead16bld.fnt>\n<include:$local$\\briefings.txt,00_title,1>\n',
    });
    await writeBriefings(dir, 'eng', {
      'briefings.txt': '[blockstart:500]\nTITLE\n[blockend:500]\n',
    });
    const briefing = await resolveMapBriefing(fs, [dir], 'x/map.dat', [0, 500, 777]);
    expect(briefing).toEqual({
      texts: {
        pol: {
          '0': [{ style: 'title', text: 'PROLOG' }],
          '500': [
            { style: 'title', text: 'TYTUL' },
            { style: 'body', text: 'Tresc' },
          ],
        },
        eng: { '500': [{ style: 'body', text: 'TITLE' }] },
      },
    });
  });

  it('yields undefined with no ids, no briefings folder, or no resolvable page', async () => {
    const { path: dir } = await makeTempDir('map-briefing-empty');
    expect(await resolveMapBriefing(fs, [dir], 'x/map.dat', [])).toBeUndefined();
    expect(await resolveMapBriefing(fs, [dir], 'x/map.dat', [500])).toBeUndefined();
    await writeBriefings(dir, 'pol', { 'briefings.txt': '[blockstart:1]\nx\n[blockend:1]\n' });
    expect(await resolveMapBriefing(fs, [dir], 'x/map.dat', [500])).toBeUndefined();
  });
});
