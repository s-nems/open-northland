import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HypertextBook, MapBriefing } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { resolveGoodNameMap } from '../../src/content/good-names.js';
import type { GoodsManifest } from '../../src/content/goods-gfx.js';
import { briefingPage } from '../../src/game/mission-brief.js';
import { contentDir, hasRealIr } from './helpers.js';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(contentDir(), path), 'utf8'));
}

describe.runIf(hasRealIr())('generated localized text', () => {
  it.each([
    ['ger', 'de'],
    ['rus', 'ru'],
  ] as const)('serves %s GUI, goods, history and briefing text', (lang, tag) => {
    const gui = readJson(`gui/strings/${lang}.json`) as Record<string, Record<string, string>>;
    expect(Object.keys(gui)).toHaveLength(8);
    expect(Object.keys(gui.misclogic ?? {}).length).toBeGreaterThan(40);
    if (lang === 'rus') expect(Object.values(gui.misclogic ?? {}).join(' ')).toMatch(/[А-Яа-я]/u);

    const goods = readJson('goods/manifest.json') as GoodsManifest;
    const table = goods.names?.[tag] ?? {};
    expect(Object.keys(table).length).toBeGreaterThan(40);
    const resolved = resolveGoodNameMap(goods.names ?? {}, lang);
    for (const [id, name] of Object.entries(table)) expect(resolved.get(id), id).toBe(name);

    const history = HypertextBook.parse(readJson(`gui/history/${lang}.json`));
    expect(Object.keys(history.pages).length).toBeGreaterThan(1);
    if (lang === 'rus') expect(JSON.stringify(history.pages)).toMatch(/[А-Яа-я]/u);

    let pages = 0;
    for (const file of readdirSync(join(contentDir(), 'maps')).filter((name) =>
      name.endsWith('.briefing.json'),
    )) {
      const briefing = MapBriefing.parse(readJson(`maps/${file}`));
      for (const id of Object.keys(briefing.texts[lang] ?? {})) {
        expect(briefingPage(briefing, lang, Number(id))?.lang, `${file}:${id}`).toBe(lang);
        pages++;
      }
    }
    expect(pages).toBeGreaterThan(0);
  });
});
