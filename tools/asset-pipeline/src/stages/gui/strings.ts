import { decodeCifStringTable } from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import type { SourceRoots } from '../../roots.js';
import { writeJsonFile } from '../content-tree.js';
import { readSourceFile } from '../source-files.js';
import { GUI_CONTENT_DIR, GUI_LANGS } from './paths.js';

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

export interface GuiStringsResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/strings/<lang>.json`). */
  readonly path: string;
  readonly tables: number;
  readonly strings: number;
}

/**
 * Decodes each language's {@link STRING_TABLES} into one `content/gui/strings/<lang>.json` of
 * `{ <table>: { <stringId>: <displayText> } }`. A missing table is absent from that language's JSON, and a
 * language with no tables at all emits nothing.
 */
export async function convertGuiStrings(
  roots: SourceRoots,
  outDir: string,
  langs: readonly string[] = GUI_LANGS,
): Promise<GuiStringsResult[]> {
  const done: GuiStringsResult[] = [];
  for (const lang of langs) {
    const tables: Record<string, Record<number, string>> = {};
    let tableCount = 0;
    let stringCount = 0;
    for (const table of STRING_TABLES) {
      const rel = `Data/text/${lang}/strings/ingamegui/ingamegui${table}.cif`;
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
    if (tableCount === 0) continue;
    const path = `${GUI_CONTENT_DIR}/strings/${lang}.json`;
    await writeJsonFile(outDir, path, tables);
    done.push({ lang, path, tables: tableCount, strings: stringCount });
  }
  return done;
}
