import { join } from 'node:path';
import { decodeCifStringTable } from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile, writeJsonFile } from '../game-file.js';
import { GUI_CONTENT_DIR } from './paths.js';

/** The nine in-game GUI string tables (files are `ingamegui<table>.cif` under `Data/text/<lang>/strings/ingamegui/`). */
export const STRING_TABLES = [
  'main',
  'misc',
  'miscwindow',
  'misclogic',
  'messages',
  'humanwindow',
  'humanlistwindow',
  'housewindow',
  'vehiclewindow',
] as const;

/** Languages whose GUI strings are extracted (the deliverable's "at least eng and pol"). */
const STRING_LANGS = ['eng', 'pol'] as const;

/** One converted language's GUI strings: the served path + how many tables it carried. */
export interface GuiStringsResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/strings/<lang>.json`). */
  readonly path: string;
  readonly tables: number;
  readonly strings: number;
}

/**
 * Decodes the nine `ingamegui*.cif` UI string tables for each language into one `content/gui/strings/<lang>.json`
 * of `{ <table>: { <stringId>: <displayText> } }` — the display id is not the container slot id but the
 * running string id, and the text is CP1250 display text ({@link decodeCifStringTable}, shared with the
 * map folders' `strings.cif`). A missing table warns-and-skips (that table is simply absent from the
 * language's JSON); a language with no tables at all is skipped entirely.
 */
export async function convertGuiStrings(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = STRING_LANGS,
): Promise<GuiStringsResult[]> {
  const done: GuiStringsResult[] = [];
  for (const lang of langs) {
    const tables: Record<string, Record<number, string>> = {};
    let tableCount = 0;
    let stringCount = 0;
    for (const table of STRING_TABLES) {
      const rel = join('Data', 'text', lang, 'strings', 'ingamegui', `ingamegui${table}.cif`);
      let byId: Record<number, string>;
      try {
        byId = decodeCifStringTable(await readSourceFile(roots, rel));
      } catch (err) {
        console.warn(`[pipeline] gui: skipped strings ${lang}/${table}: ${errorMessage(err)}`);
        continue;
      }
      tables[table] = byId;
      tableCount++;
      stringCount += Object.keys(byId).length;
    }
    if (tableCount === 0) continue; // no tables for this language — emit nothing
    const path = join(GUI_CONTENT_DIR, 'strings', `${lang}.json`);
    await writeJsonFile(outDir, path, tables);
    done.push({ lang, path, tables: tableCount, strings: stringCount });
  }
  return done;
}
