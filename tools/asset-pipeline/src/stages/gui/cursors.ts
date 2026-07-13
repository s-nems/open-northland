import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeCursor } from '../../decoders/cursor.js';
import { encodePng } from '../../decoders/png.js';
import { readGameFile } from '../game-file.js';
import { GUI_CONTENT_DIR } from './paths.js';

/** The three mouse cursors under `DataX/Mouse/`, in a stable order. */
const CURSORS = ['MouseNormal', 'MousePressed', 'MouseRight'] as const;
const MOUSE_DIR = join('DataX', 'Mouse');

/** One converted cursor: the copied `.cur`, the decoded `.png`, the hotspot, and the pixel size. */
export interface GuiCursorResult {
  readonly name: string;
  /** URL path relative to `/gui/` (forward slashes) of the verbatim `.cur` — for CSS `cursor: url(/gui/<cur>)`. */
  readonly cur: string;
  /** URL path relative to `/gui/` (forward slashes) of the decoded RGBA PNG fallback/preview. */
  readonly png: string;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes each `DataX/Mouse/*.cur` to a PNG (with its hotspot) and copies the raw `.cur` through, both
 * under `content/gui/cursors/`. A missing/malformed cursor warns-and-skips. Returns one result per cursor.
 */
export async function convertCursors(gameDir: string, outDir: string): Promise<GuiCursorResult[]> {
  const done: GuiCursorResult[] = [];
  await mkdir(join(outDir, GUI_CONTENT_DIR, 'cursors'), { recursive: true });
  for (const name of CURSORS) {
    const rel = join(MOUSE_DIR, `${name}.cur`);
    let bytes: Uint8Array;
    try {
      bytes = await readGameFile(gameDir, rel);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped cursor ${name}: ${(err as Error).message}`);
      continue;
    }
    let cursor: ReturnType<typeof decodeCursor>;
    try {
      cursor = decodeCursor(bytes);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped cursor ${name}: ${(err as Error).message}`);
      continue;
    }
    // Disk write uses a native path; the manifest records a forward-slash URL path relative to `/gui/`
    // (a browser consumer fetches `/gui/<cur>`), so it must not carry OS separators or a `gui/` prefix.
    await writeFile(join(outDir, GUI_CONTENT_DIR, 'cursors', `${name}.cur`), bytes); // verbatim, for CSS cursor: url()
    await writeFile(join(outDir, GUI_CONTENT_DIR, 'cursors', `${name}.png`), encodePng(cursor.image));
    done.push({
      name,
      cur: `cursors/${name}.cur`,
      png: `cursors/${name}.png`,
      hotspotX: cursor.hotspotX,
      hotspotY: cursor.hotspotY,
      width: cursor.width,
      height: cursor.height,
    });
  }
  return done;
}
