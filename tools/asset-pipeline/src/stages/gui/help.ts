import { isSourceLanguage, type ObjectHelp } from '@open-northland/data';
import { extractStringTable } from '@open-northland/formats/ini';
import { errorMessage } from '../../errors.js';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';
import {
  type GameObjectNames,
  normalizeName,
  OBJECT_HELP_FILES,
  type ObjectHelpTable,
  readTextTable,
  withObjectEdit,
} from './strings.js';

/** Each table's key in `gui/help/<lang>.json`. */
const HELP_TABLES = [
  { key: 'goods', table: 'goodsHelp' },
  { key: 'houses', table: 'housesHelp' },
] as const;

type HelpBuilder = { -readonly [K in keyof ObjectHelp]: ObjectHelp[K] };

/** The line-break mark inside a help string. */
const NEWLINE_MARK = '{newline}';

export interface GuiObjectHelpResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/help/<lang>.json`). */
  readonly path: string;
  readonly strings: number;
}

/** A source value as display text: a marked line break as `\n`, each line trimmed to single spaces. */
export const helpText = (text: string): string => text.split(NEWLINE_MARK).map(normalizeName).join('\n');

/** One description table as `lang` ships it, in the shape of a game-object table, which has no plurals. */
export async function readObjectHelp(
  roots: SourceRoots,
  lang: string,
  table: ObjectHelpTable,
): Promise<GameObjectNames> {
  const stem = `Data/text/${lang}/strings/help/${OBJECT_HELP_FILES[table]}`;
  const { sections, decode } = await readTextTable(roots, lang, stem);
  return {
    names: Object.fromEntries(
      Object.entries(extractStringTable(sections)).map(([id, text]) => [Number(id), helpText(decode(text))]),
    ),
    plurals: {},
  };
}

async function writeHelp(
  outDir: string,
  lang: string,
  help: ObjectHelp,
  done: GuiObjectHelpResult[],
): Promise<void> {
  const strings = Object.keys(help.goods).length + Object.keys(help.houses).length;
  if (strings === 0) return;
  const path = `${GUI_CONTENT_DIR}/help/${lang}.json`;
  await writeJsonFile(outDir, path, help);
  done.push({ lang, path, strings });
}

/**
 * Decodes each language's goods and houses descriptions into `content/gui/help/<lang>.json`, with the
 * string corrections applied, and writes an overlay language's file from its description overlays. A
 * missing table stays empty and a language with neither emits nothing. A source language's overlay is
 * refused, as `convertGuiStrings` reports for its object tables.
 */
export async function convertGuiObjectHelp(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiObjectHelpResult[]> {
  const done: GuiObjectHelpResult[] = [];
  for (const lang of langs) {
    const help: HelpBuilder = { goods: {}, houses: {} };
    for (const { key, table } of HELP_TABLES) {
      try {
        const { names } = await readObjectHelp(roots, lang, table);
        help[key] = roots.stringCorrections?.correct(lang, table, names) ?? names;
      } catch (err) {
        console.warn(`[pipeline] gui: skipped help ${lang}/${table}: ${errorMessage(err)}`);
      }
    }
    await writeHelp(outDir, lang, help, done);
  }
  for (const [lang, overlays] of roots.overlays?.objects ?? []) {
    if (isSourceLanguage(lang)) continue;
    const help: HelpBuilder = { goods: {}, houses: {} };
    for (const { key, table } of HELP_TABLES) {
      const filed = overlays.get(table);
      if (filed === undefined) continue;
      const overlay = await withObjectEdit(lang, table, filed, (basis) =>
        readObjectHelp({ data: roots.data }, basis, table),
      );
      help[key] = overlay.names;
    }
    await writeHelp(outDir, lang, help, done);
  }
  return done;
}
