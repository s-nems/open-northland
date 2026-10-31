import type { ObjectHelp } from '@open-northland/data';
import { extractStringTable } from '@open-northland/formats/ini';
import { errorMessage } from '../../errors.js';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';
import { normalizeName, readTextTable } from './strings.js';

/** The source tables (`Data/text/<lang>/strings/help/<file>.{ini,cif}`), whose ids are type ids, with the
 *  scope a string correction names each by; `goods` alone would name the name table. */
const HELP_TABLES = [
  { key: 'goods', file: 'goodshelp', scope: 'goodsHelp' },
  { key: 'houses', file: 'houseshelp', scope: 'housesHelp' },
] as const;

export const HELP_TABLE_SCOPES: readonly string[] = HELP_TABLES.map(({ scope }) => scope);

/** The line-break mark inside a help string. */
const NEWLINE_MARK = '{newline}';

export interface GuiObjectHelpResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/help/<lang>.json`). */
  readonly path: string;
  readonly strings: number;
}

const helpText = (text: string): string => text.split(NEWLINE_MARK).map(normalizeName).join('\n');

async function readHelpTable(
  roots: SourceRoots,
  lang: string,
  file: string,
): Promise<Record<number, string>> {
  const stem = `Data/text/${lang}/strings/help/${file}`;
  const { sections, decode } = await readTextTable(roots, lang, stem);
  return Object.fromEntries(
    Object.entries(extractStringTable(sections)).map(([id, text]) => [Number(id), helpText(decode(text))]),
  );
}

/**
 * Decodes each language's goods and houses descriptions into `content/gui/help/<lang>.json`, with the
 * string corrections applied. A missing table stays empty and a language with neither emits nothing;
 * no overlay carries these tables, so `chs` and `cht` get no file.
 */
export async function convertGuiObjectHelp(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiObjectHelpResult[]> {
  const done: GuiObjectHelpResult[] = [];
  for (const lang of langs) {
    const help: { -readonly [K in keyof ObjectHelp]: ObjectHelp[K] } = { goods: {}, houses: {} };
    for (const { key, file, scope } of HELP_TABLES) {
      try {
        const byId = await readHelpTable(roots, lang, file);
        help[key] = roots.stringCorrections?.correct(lang, scope, byId) ?? byId;
      } catch (err) {
        console.warn(`[pipeline] gui: skipped help ${lang}/${file}: ${errorMessage(err)}`);
      }
    }
    const strings = Object.keys(help.goods).length + Object.keys(help.houses).length;
    if (strings === 0) continue;
    const path = `${GUI_CONTENT_DIR}/help/${lang}.json`;
    await writeJsonFile(outDir, path, help);
    done.push({ lang, path, strings });
  }
  return done;
}
