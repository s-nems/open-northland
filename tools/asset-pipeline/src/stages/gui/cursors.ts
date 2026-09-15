import { join } from 'node:path';
import { type DecodedCursor, decodeCursor } from '../../decoders/cur.js';
import { encodePng } from '../../decoders/png.js';
import { errorMessage } from '../../errors.js';
import { writeFileWithParents } from '../../files.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile } from '../source-files.js';
import { GUI_CONTENT_DIR } from './paths.js';

/** The three mouse cursors under `DataX/Mouse/`, in a stable order. */
const CURSORS = ['MouseNormal', 'MousePressed', 'MouseRight'] as const;
const MOUSE_DIR = 'DataX/Mouse';

export interface GuiCursorResult {
  readonly name: string;
  /** URL path relative to `/gui/` of the verbatim `.cur`, for CSS `cursor: url(/gui/<cur>)`. */
  readonly cur: string;
  /** URL path relative to `/gui/` of the decoded RGBA PNG fallback. */
  readonly png: string;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes each `DataX/Mouse/*.cur` to a PNG with its hotspot and copies the raw `.cur` through, both under
 * `content/gui/cursors/`.
 */
export async function convertCursors(roots: SourceRoots, outDir: string): Promise<GuiCursorResult[]> {
  const done: GuiCursorResult[] = [];
  for (const name of CURSORS) {
    const rel = `${MOUSE_DIR}/${name}.cur`;
    let bytes: Uint8Array;
    try {
      bytes = await readSourceFile(roots, rel);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped cursor ${name}: ${errorMessage(err)}`);
      continue;
    }
    let cursor: DecodedCursor;
    try {
      cursor = decodeCursor(bytes);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped cursor ${name}: ${errorMessage(err)}`);
      continue;
    }
    await writeFileWithParents(join(outDir, GUI_CONTENT_DIR, 'cursors', `${name}.cur`), bytes);
    await writeFileWithParents(
      join(outDir, GUI_CONTENT_DIR, 'cursors', `${name}.png`),
      await encodePng(cursor.image),
    );
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
