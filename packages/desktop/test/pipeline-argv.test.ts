import { describe, expect, it } from 'vitest';
import { decodePipelineArgv, encodePipelineArgv } from '../src/pipeline-argv.js';

describe('pipeline child argv', () => {
  it('round-trips the out dir and mod root', () => {
    const argv = encodePipelineArgv('/data/content', '/data/mods/CnMod 1.3.2');
    expect(argv).toHaveLength(2);
    expect(decodePipelineArgv(argv)).toEqual({ outDir: '/data/content', modRoot: '/data/mods/CnMod 1.3.2' });
  });

  it('rejects an argv no host would encode', () => {
    expect(decodePipelineArgv([])).toBeUndefined();
    expect(decodePipelineArgv(['', '/mod'])).toBeUndefined();
    expect(decodePipelineArgv(['/data/content', ''])).toBeUndefined();
    expect(decodePipelineArgv(['/data/content'])).toBeUndefined();
  });
});
