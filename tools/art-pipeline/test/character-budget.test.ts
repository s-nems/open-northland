import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { characterInputs, packCharacter } from '../src/character.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each([17, 144])('rejects %i-frame clips before rendering or reading sprites', async (frames) => {
  const root = await mkdtemp(join(tmpdir(), 'character-budget-'));
  roots.push(root);
  await writeFile(
    join(root, 'recipe.json'),
    JSON.stringify({
      frames: 12,
      post: 'soft-separation',
      clips: [{ name: 'idle', frames, duration: 6 }],
    }),
  );
  await expect(characterInputs(root, 'recipe.json')).rejects.toThrow('<=16');
  await expect(packCharacter(root, 'recipe.json', 'test', 'Test')).rejects.toThrow('<=16');
  await expect(
    promisify(execFile)('python3', [
      'tools/art-pipeline/authoring/characters/run-character.py',
      root,
      root,
      'render',
    ]),
  ).rejects.toThrow('at most 16 stored frames');
});

it('accepts a six-second clip with 16 stored poses independently of playback rate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'character-budget-'));
  roots.push(root);
  await writeFile(
    join(root, 'recipe.json'),
    JSON.stringify({ frames: 16, post: 'soft-separation', clips: [{ name: 'idle', duration: 6 }] }),
  );
  expect(await characterInputs(root, 'recipe.json')).toHaveLength(9);
});
