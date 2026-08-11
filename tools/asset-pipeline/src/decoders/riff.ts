import { viewOf } from './byte-cursor.js';

/**
 * One chunk inside a RIFF container body. Containers (`RIFF`/`LIST`) carry their form type and
 * their body starts after it; leaves carry `form: undefined`. Offsets are absolute into the
 * walked buffer.
 */
export interface RiffChild {
  readonly id: string;
  readonly form: string | undefined;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

const RIFF_HEADER_BYTES = 8;
const FORM_TYPE_BYTES = 4;

export function fourCc(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off] ?? 0, bytes[off + 1] ?? 0, bytes[off + 2] ?? 0, bytes[off + 3] ?? 0);
}

/** Depth-first visit of every chunk under [start, end), each container before its own children. */
export function walkRiffTree(
  bytes: Uint8Array,
  visit: (child: RiffChild) => void,
  start = 0,
  end = bytes.length,
): void {
  for (const child of riffChildren(bytes, start, end)) {
    visit(child);
    if (child.form !== undefined) walkRiffTree(bytes, visit, child.bodyStart, child.bodyEnd);
  }
}

/** The chunks of one container body [start, end); truncated trailing chunks are dropped. */
export function riffChildren(bytes: Uint8Array, start: number, end: number): RiffChild[] {
  const view = viewOf(bytes);
  const out: RiffChild[] = [];
  let off = start;
  while (off + RIFF_HEADER_BYTES <= end) {
    const id = fourCc(bytes, off);
    const size = view.getUint32(off + 4, true);
    const body = off + RIFF_HEADER_BYTES;
    if (body + size > end) break;
    if (id === 'RIFF' || id === 'LIST') {
      out.push({ id, form: fourCc(bytes, body), bodyStart: body + FORM_TYPE_BYTES, bodyEnd: body + size });
    } else {
      out.push({ id, form: undefined, bodyStart: body, bodyEnd: body + size });
    }
    off = body + size + (size & 1);
  }
  return out;
}
