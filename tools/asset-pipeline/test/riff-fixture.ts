/** Byte builders for synthetic RIFF fixtures shared by the decoder tests. */

export function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

export function utf16z(s: string): number[] {
  return [...`${s}\0`].flatMap((c) => u16(c.charCodeAt(0)));
}

export function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

export function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function f64(v: number): number[] {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, v, true);
  return [...bytes];
}

export function chunk(id: string, body: readonly number[]): number[] {
  const padded = body.length & 1 ? [...body, 0] : [...body];
  return [...ascii(id), ...u32(body.length), ...padded];
}

export function list(listId: string, body: readonly number[]): number[] {
  return chunk('LIST', [...ascii(listId), ...body]);
}

export function riffChunk(formId: string, body: readonly number[]): number[] {
  return chunk('RIFF', [...ascii(formId), ...body]);
}

export function riff(formId: string, body: readonly number[]): Uint8Array {
  return new Uint8Array(riffChunk(formId, body));
}
