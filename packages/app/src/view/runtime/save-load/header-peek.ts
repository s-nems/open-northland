import { SAVE_KIND } from '@open-northland/sim';
import { isGzipSave, type SaveBytes } from './codec.js';

/** The header provenance a save list shows, read from a file prefix without inflating the document. */
export interface PeekedSaveHeader {
  readonly mapId: string | null;
  readonly tick: number;
  readonly entry: string | null;
}

/** Decoded-text budget for finding the header; a real header sits in the first kilobyte. */
const PEEK_DECODED_LIMIT = 256 * 1024;

/** Read the save header from a file's leading bytes; null when the prefix is not a save. */
export async function peekSaveHeader(prefix: SaveBytes): Promise<PeekedSaveHeader | null> {
  const text = isGzipSave(prefix) ? await inflatedPrefix(prefix) : new TextDecoder().decode(prefix);
  return text === null ? null : headerFromText(text);
}

/** Inflate as much of a (possibly truncated) gzip prefix as the budget allows. A truncated stream
 *  errors at its cut; everything decoded before the cut still holds the header. */
async function inflatedPrefix(prefix: SaveBytes): Promise<string | null> {
  const reader = new Blob([prefix]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= PEEK_DECODED_LIMIT) break;
    }
  } catch {
    // The expected end of a truncated prefix; fall through with what decoded.
  }
  await reader.cancel().catch(() => undefined);
  return text.length > 0 ? text : null;
}

function headerFromText(text: string): PeekedSaveHeader | null {
  const label = text.indexOf('"header":');
  if (label === -1) return null;
  const start = text.indexOf('{', label);
  if (start === -1) return null;
  const end = balancedObjectEnd(text, start);
  if (end === -1) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const header = raw as Record<string, unknown>;
  if (header.kind !== SAVE_KIND) return null;
  const tick = header.tick;
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) return null;
  return {
    mapId: typeof header.mapId === 'string' ? header.mapId : null,
    tick,
    entry: typeof header.entry === 'string' ? header.entry : null,
  };
}

/** Index of the `}` closing the object opened at `start`, or -1 when the text ends first. */
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}
