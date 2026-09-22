import type { SettlerCharacter } from '@open-northland/render';
import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { JOB_CHILD_FEMALE, JOB_CHILD_MALE, JOB_SCOUT, JOB_WOMAN } from '../../src/catalog/jobs.js';
import {
  requestedCustomAppearance,
  selectCustomCharacters,
} from '../../src/custom/content/character-selection.js';

function look(): SettlerCharacter {
  return {
    body: { source: new TextureSource(), atlas: { width: 1, height: 1, frames: new Map() } },
    binding: { idle: 0 },
  };
}

describe('custom character selection', () => {
  const man = look(),
    woman = look(),
    boy = look(),
    fallback = look();
  const loaded = new Map([
    ['man-silver', man],
    ['woman-blonde', woman],
    ['boy-straw', boy],
  ]);

  it('loads the adult woman with her own animation binding', () => {
    expect(requestedCustomAppearance('woman-blonde', null)).toBe(true);
    const selected = selectCustomCharacters(loaded, fallback, null);
    expect(selected?.byJob[JOB_WOMAN]).toBe(woman);
    expect(selected?.default.variants).toEqual([man]);
    expect(selected?.byJob[JOB_SCOUT]).toBe(fallback);
  });

  it('routes the boy job to his own body and leaves the girl on the placeholder', () => {
    const selected = selectCustomCharacters(loaded, fallback, null);
    expect(selected?.youngByJob[JOB_CHILD_MALE]).toBe(boy);
    expect(selected?.youngByJob[JOB_CHILD_FEMALE]).toBe(fallback);
    expect(selected?.default.variants).toEqual([man]);
  });

  it('retains the original woman when its atlas is unavailable', () => {
    expect(selectCustomCharacters(new Map([['man-silver', man]]), fallback, null)?.byJob[JOB_WOMAN]).toBe(
      fallback,
    );
  });

  it('keeps variant assignment in selection order regardless of renamed asset loading order', () => {
    const forkbeard = look();
    const selected = selectCustomCharacters(
      new Map([
        ['man-forkbeard', forkbeard],
        ['man-silver', man],
        ['woman-blonde', woman],
      ]),
      fallback,
      null,
    );
    expect(selected?.default.body).toBe(man.body);
    expect(selected?.default.variants).toEqual([man, forkbeard]);
  });

  it('keeps explicit appearance previews isolated from default job selection', () => {
    expect(requestedCustomAppearance('woman-blonde', 'man-silver')).toBe(false);
    const preview = selectCustomCharacters(new Map([['woman-blonde', woman]]), fallback, 'woman-blonde');
    expect(preview?.default.body).toBe(woman.body);
    expect(preview?.byJob[JOB_WOMAN]).toBe(fallback);
    expect(preview?.youngByJob[JOB_CHILD_MALE]).toBe(fallback);
  });
});
