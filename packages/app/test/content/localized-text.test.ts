import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HypertextBook, MapBriefing } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { GuiStrings } from '../../src/content/gui-gfx.js';
import { originalNameOverlay } from '../../src/content/original-names.js';
import { briefingPage } from '../../src/game/mission-brief.js';
import { messages } from '../../src/i18n/index.js';
import { contentDir, hasRealIr, loadContentUnderTest } from './helpers.js';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(contentDir(), path), 'utf8'));
}

describe.runIf(hasRealIr())('generated localized text', () => {
  it.each(['ger', 'rus'] as const)(
    'serves %s GUI, game-object names, history and briefing text',
    async (lang) => {
      const gui = readJson(`gui/strings/${lang}.json`) as GuiStrings;
      expect(Object.keys(gui)).toHaveLength(14);
      expect(Object.keys(gui.misclogic ?? {}).length).toBeGreaterThan(40);
      if (lang === 'rus') expect(Object.values(gui.misclogic ?? {}).join(' ')).toMatch(/[А-Яа-я]/u);

      const { merge } = await loadContentUnderTest();
      const names = originalNameOverlay(gui, merge.content);
      // The mod leaves a few ids out of these languages' tables, so the authored name fills those in.
      const authored = messages(lang);
      const goodNames: Readonly<Record<string, string | undefined>> = { ...authored.goods, ...names.goods };
      const buildingNames: Readonly<Record<string, string | undefined>> = {
        ...authored.building,
        ...names.building,
      };
      expect(merge.content.goods.filter((good) => goodNames[good.id] === undefined)).toEqual([]);
      expect(merge.content.buildings.filter((house) => buildingNames[house.id] === undefined)).toEqual([]);
      expect(Object.keys(names.goods ?? {}).length).toBeGreaterThan(merge.content.goods.length / 2);
      // The group panel's plurals come from the same tables as the singulars beside them.
      expect(Object.keys(names.professions ?? {})).toEqual(Object.keys(names.profession ?? {}));
      expect(Object.keys(names.soldierClasses ?? {})).toEqual(Object.keys(names.soldierClass ?? {}));

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
    },
  );
});
