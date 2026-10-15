import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { byteRange, fileResponse } from '../src/file-response.js';

describe('byteRange', () => {
  const SIZE = 100;

  it('reads a bounded, an open and a suffix range, clamping the end to the file', () => {
    expect(byteRange('bytes=10-19', SIZE)).toEqual({ start: 10, end: 19 });
    expect(byteRange('bytes=90-', SIZE)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=-5', SIZE)).toEqual({ start: 95, end: 99 });
    expect(byteRange('bytes=50-500', SIZE)).toEqual({ start: 50, end: 99 });
  });

  it('serves the whole file without a single byte range', () => {
    expect(byteRange(null, SIZE)).toBeNull();
    expect(byteRange('bytes=0-1,5-6', SIZE)).toBeNull();
    expect(byteRange('items=0-1', SIZE)).toBeNull();
  });

  it('refuses a range past the end', () => {
    expect(byteRange('bytes=100-', SIZE)).toBe('unsatisfiable');
    expect(byteRange('bytes=20-10', SIZE)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
  });
});

describe('fileResponse', () => {
  const FILE_SIZE = 256;
  const bytes = Uint8Array.from({ length: FILE_SIZE }, (_, i) => i);
  const HEADERS = { 'content-type': 'video/webm' };
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-response-'));
    file = join(dir, 'film.webm');
    await writeFile(file, bytes);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  function request(range?: string, method = 'GET'): Request {
    return new Request('app://game/film.webm', { method, headers: range === undefined ? {} : { range } });
  }

  it('serves the whole file without a range and advertises byte ranges', async () => {
    const response = await fileResponse(file, request(), HEADERS);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-type')).toBe('video/webm');
    expect(response.headers.get('content-length')).toBe(String(FILE_SIZE));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('slices a single range into a 206', async () => {
    const response = await fileResponse(file, request('bytes=0-99'), HEADERS);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-99/${FILE_SIZE}`);
    expect(response.headers.get('content-length')).toBe('100');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(0, 100));

    const tail = await fileResponse(file, request('bytes=200-'), HEADERS);
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(200));
  });

  it('answers 416 with the file size for a range past the end', async () => {
    const response = await fileResponse(file, request(`bytes=${FILE_SIZE}-`), HEADERS);
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe(`bytes */${FILE_SIZE}`);
  });

  it('answers HEAD with headers only', async () => {
    const response = await fileResponse(file, request(undefined, 'HEAD'), HEADERS);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe(String(FILE_SIZE));
    expect(response.body).toBeNull();
  });
});
