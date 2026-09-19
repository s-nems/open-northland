import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { HYPERTEXT_PICTURES_DIR } from '../src/stages/gui/paths.js';
import { cutsceneIdsOf, resolveMapBriefing } from '../src/stages/maps/briefing.js';
import { rampPalette } from './fixtures/palette.js';
import { makeTempDir } from './support/game-tree.js';

/**
 * The per-folder briefing resolution (`stages/maps/briefing.ts`): each cutscene id reads its `NNNN.hlt`
 * page, which includes its text from `briefings.txt`, per language; the pictures those pages name are
 * emitted once, and a folder without briefings yields no sidecar. Fixtures are ASCII; the renderer
 * itself is pinned in `hypertext.test.ts`.
 */

/** The page a map ships for one block: `<block:2>` and the text colour, then the block's lines. */
function hltPage(label: string): string {
  return `<block:2>\r\n<color:$local$\\palettes\\font_dark.pcx>\r\n<include:$local$\\briefings.txt,${label},1>`;
}

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
  it('renders each id from its NNNN.hlt page, per language, and skips an id without one', async () => {
    const { path: dir } = await makeTempDir('map-briefing');
    await writeBriefings(dir, 'pol', {
      'briefings.txt':
        '[blockstart:500]\n<font:$local$\\fonts\\fonthead16bld.fnt>\nTYTUL\n<font:$local$\\fonts\\font12.fnt>\nTresc\n[blockend:500]\n' +
        '[blockstart:00_title]\nPROLOG\n[blockend:00_title]\n',
      '0000.hlt': '<font:$local$\\fonts\\fonthead16bld.fnt>\n<include:$local$\\briefings.txt,00_title,1>\n',
      '0500.hlt': hltPage('500'),
    });
    await writeBriefings(dir, 'eng', {
      'briefings.txt': '[blockstart:500]\nTITLE\n[blockend:500]\n',
    });
    const { path: out } = await makeTempDir('map-briefing-out');
    const briefing = await resolveMapBriefing(dir, out, 'x/map.dat', [0, 500, 777]);
    expect(briefing).toEqual({
      texts: {
        pol: {
          '0': [{ kind: 'text', style: 'title', text: 'PROLOG' }],
          '500': [
            { kind: 'blank', lines: 1 },
            { kind: 'text', style: 'title', text: 'TYTUL', align: 'center' },
            { kind: 'blank', lines: 1 },
            { kind: 'text', style: 'body', text: 'Tresc', align: 'center' },
          ],
        },
      },
    });
  });

  it('emits each named picture once and points both languages at the same file', async () => {
    const { path: dir } = await makeTempDir('map-briefing-picture');
    const { path: out } = await makeTempDir('map-briefing-picture-out');
    const block = '[blockstart:500]\nOpis\n<picture:$local$\\graphics\\Map.pcx>\n[blockend:500]\n';
    for (const lang of ['pol', 'eng']) {
      await writeBriefings(dir, lang, { 'briefings.txt': block, '0500.hlt': hltPage('500') });
      await mkdir(join(dir, 'text', lang, 'briefings', 'Graphics'), { recursive: true });
      await writeFile(
        join(dir, 'text', lang, 'briefings', 'Graphics', 'map.pcx'),
        encodePcx({ width: 3, height: 2, pixels: new Uint8Array(6).fill(4), palette: rampPalette() }),
      );
    }
    const briefing = await resolveMapBriefing(dir, out, 'x/map.dat', [500]);
    const pictures = await readdir(join(out, HYPERTEXT_PICTURES_DIR));
    const [pol, eng] = [briefing?.texts.pol?.['500']?.[1], briefing?.texts.eng?.['500']?.[1]];
    expect(pictures).toHaveLength(1);
    expect(pol).toEqual({ kind: 'picture', file: pictures[0], width: 3, height: 2 });
    expect(eng).toEqual(pol);
  });

  it('yields undefined with no ids, no briefings folder, or no resolvable page', async () => {
    const { path: dir } = await makeTempDir('map-briefing-empty');
    const { path: out } = await makeTempDir('map-briefing-empty-out');
    expect(await resolveMapBriefing(dir, out, 'x/map.dat', [])).toBeUndefined();
    expect(await resolveMapBriefing(dir, out, 'x/map.dat', [500])).toBeUndefined();
    await writeBriefings(dir, 'pol', { 'briefings.txt': '[blockstart:500]\nx\n[blockend:500]\n' });
    expect(await resolveMapBriefing(dir, out, 'x/map.dat', [500])).toBeUndefined();
  });
});
