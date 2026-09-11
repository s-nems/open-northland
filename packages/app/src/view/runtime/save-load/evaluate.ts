import { parseSaveGame, SAVE_FORMAT_VERSION, SAVE_KIND, type SaveGame } from '@open-northland/sim';

/** The live session identity a candidate save must match before the page reloads into it. */
export interface LiveWorldIdentity {
  /** The entry's world token: the decoded map id, or `scene:<id>`; null for a tokenless world. */
  readonly worldToken: string | null;
  readonly mapFingerprint: string | null;
  readonly irVersion: number;
}

export type SaveRejection = 'corrupt' | 'incompatibleVersion' | 'wrongContent' | 'wrongWorld' | 'wrongMap';

export type EvaluatedSave =
  | { readonly ok: true; readonly save: SaveGame }
  | { readonly ok: false; readonly reason: SaveRejection };

/** Decode save text to its JSON document, tolerating an editor-added BOM. The one parse seam shared
 *  with the staged boot, so a file accepted here cannot fail the reload's parse. */
export function saveDocumentOf(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

export type EvaluatedDocument =
  | { readonly ok: true; readonly save: SaveGame }
  | { readonly ok: false; readonly reason: 'corrupt' | 'incompatibleVersion' };

/** Structure-only classification, for a load launched outside any running world (the main menu). */
export function evaluateSaveDocument(text: string): EvaluatedDocument {
  let raw: unknown;
  try {
    raw = saveDocumentOf(text);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  const header = headerOf(raw);
  if (header === null || header.kind !== SAVE_KIND) return { ok: false, reason: 'corrupt' };
  try {
    return { ok: true, save: parseSaveGame(raw) };
  } catch {
    // A real save from another format version is incompatible, not corrupt.
    const version = header.formatVersion;
    const unsupported = typeof version === 'number' && version !== SAVE_FORMAT_VERSION;
    return { ok: false, reason: unsupported ? 'incompatibleVersion' : 'corrupt' };
  }
}

/**
 * Classify a picked file against the running session, so a rejected file never navigates the page.
 * Every comparison reads the live sim's own identity; the reload boots on the same served content,
 * so a save that matches here restores there.
 */
export function evaluateSaveFile(text: string, live: LiveWorldIdentity): EvaluatedSave {
  const evaluated = evaluateSaveDocument(text);
  if (!evaluated.ok) return evaluated;
  const save = evaluated.save;
  if (save.header.irVersion !== live.irVersion) return { ok: false, reason: 'wrongContent' };
  if (save.header.mapId !== live.worldToken) return { ok: false, reason: 'wrongWorld' };
  if (save.header.mapFingerprint !== live.mapFingerprint) return { ok: false, reason: 'wrongMap' };
  return { ok: true, save };
}

function headerOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const header = (raw as Record<string, unknown>).header;
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return null;
  return header as Record<string, unknown>;
}
