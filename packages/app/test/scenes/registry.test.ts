import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { SCENES } from '../../src/scenes/index.js';
import { SCENE_TEST_SUFFIX } from './scene-case.js';

/** Each scene owns a test file so Vitest can spread the runs over workers, which means a newly
 *  registered scene silently loses its headless run until someone adds one. */
const SELF = fileURLToPath(import.meta.url);

it('registers one test file per acceptance scene', () => {
  const covered = readdirSync(dirname(SELF))
    .filter((name) => name.endsWith(SCENE_TEST_SUFFIX) && name !== basename(SELF))
    .map((name) => basename(name, SCENE_TEST_SUFFIX))
    .sort();
  expect(covered).toEqual(SCENES.map((scene) => scene.id).sort());
});
