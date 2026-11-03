import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPersonalNames } from '../../../src/content/gui/personal-names.js';

afterEach(() => vi.unstubAllGlobals());

describe('loadPersonalNames', () => {
  it('asks for no file in a source language, whose pools already spell its names', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return Promise.resolve(new Response(JSON.stringify({ 'viking-male': { Harald: '哈拉尔德' } })));
    });
    expect((await loadPersonalNames('eng')).size).toBe(0);
    const chs = await loadPersonalNames('chs');
    expect(chs.get('viking-male')?.get('Harald')).toBe('哈拉尔德');
    expect(fetched).toEqual([expect.stringMatching(/\/gui\/names\/chs\.json$/)]);
  });

  it('reads a malformed file as no names', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ 'viking-male': { Harald: '' } }))),
    );
    expect((await loadPersonalNames('cht')).size).toBe(0);
  });
});
