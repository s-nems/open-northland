import {
  indexAtlasFrames,
  type SpriteAtlas,
  type SpriteLayer,
  type TextureSource,
} from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { OPEN_CHEST_ATOMIC } from '../src/catalog/atomics.js';
import {
  JOB_CIVILIST,
  JOB_HERO_SWORD,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import type { BobSeqRow, ContentIr, JobGraphicsRow } from '../src/content/ir/rows.js';
import { tribeLooks } from '../src/content/settler-gfx/index.js';
import type { LoadedLook, ResolvedLook } from '../src/content/sprite-sheet/character-looks.js';
import { tribeCharacters } from '../src/content/sprite-sheet/tribe-characters.js';

/**
 * One civilization's character table: which body each spec ends on, and what it borrows from the base
 * tribe. A tribe authors only part of the roster - the weresnake and the werewolf author a soldier and
 * nothing else - so the merge decides what the other jobs wear.
 */

const VIKING = 1;
const FRANK = 2;
const WERESNAKE = 5;
const BOBS = 'data/engine2d/bin/bobs';

const CIVILIAN_SEQS = ['human_man_generic_walk', 'human_man_generic_wait'];
const WARRIOR_SEQS = ['human_man_warrior_empty_walk', 'human_man_warrior_empty_wait'];

function row(tribe: number, job: number, body: string): JobGraphicsRow {
  return { tribe, job, body: `${BOBS}/${body}.bmd`, heads: [] };
}

const ir: ContentIr = {
  jobGraphics: [
    row(VIKING, JOB_CIVILIST, 'cr_hum_body_00'),
    row(VIKING, JOB_SOLDIER_UNARMED, 'cr_hum_body_05'),
    row(VIKING, JOB_HERO_SWORD, 'cr_hum_body_60'),
    row(FRANK, JOB_CIVILIST, 'cr_hum_body_30'),
    row(FRANK, JOB_SOLDIER_UNARMED, 'cr_hum_body_32'),
    // The weresnake authors a soldier and no civilian at all.
    row(WERESNAKE, JOB_SOLDIER_UNARMED, 'cr_hum_body_70'),
  ],
};

const source = {} as TextureSource;
function layer(): SpriteLayer {
  const atlas: SpriteAtlas = indexAtlasFrames(64, 64, [
    { bobId: 0, rect: { x: 0, y: 0, width: 8, height: 8 }, offsetX: 0, offsetY: 0 },
  ]);
  return { source, atlas };
}
function seqs(names: readonly string[]): Map<string, BobSeqRow> {
  return new Map(names.map((name, i) => [name, { name, start: i * 8, length: 8 }]));
}

/** Every look the tribe resolves, with the bodies named in `decoded` loaded and the rest missing. */
function inputsFor(tribe: number, decoded: readonly string[], names = [...CIVILIAN_SEQS, ...WARRIOR_SEQS]) {
  const looks = new Map<string, ResolvedLook[]>();
  for (const [specId, chain] of tribeLooks(ir, tribe)) {
    looks.set(
      specId,
      chain.map((look) => ({ ...look, bodyStem: look.bodyBmd, headStems: [] })),
    );
  }
  const layersByBody = new Map<string, LoadedLook>(
    decoded.map((stem) => [stem, { body: layer(), headsByStem: new Map() }]),
  );
  const sequencesByBody = new Map(decoded.map((stem) => [stem, seqs(names)]));
  return { looks: looks as never, layersByBody, sequencesByBody };
}

describe('tribeCharacters', () => {
  it('builds each spec on the body its own tribe names', () => {
    const vikingIn = inputsFor(VIKING, ['cr_hum_body_00', 'cr_hum_body_05']);
    const frankIn = inputsFor(FRANK, ['cr_hum_body_30', 'cr_hum_body_32']);
    const viking = tribeCharacters(ir, [], VIKING, vikingIn);
    const frank = tribeCharacters(ir, [], FRANK, frankIn);
    // The civilist record's body backs the default look, and the soldier record's the soldier jobs.
    expect(viking?.default.body).toBe(vikingIn.layersByBody.get('cr_hum_body_00')?.body);
    expect(viking?.byJob[JOB_SOLDIER_UNARMED]?.body).toBe(vikingIn.layersByBody.get('cr_hum_body_05')?.body);
    expect(frank?.default.body).toBe(frankIn.layersByBody.get('cr_hum_body_30')?.body);
    expect(frank?.byJob[JOB_SOLDIER_UNARMED]?.body).toBe(frankIn.layersByBody.get('cr_hum_body_32')?.body);
  });

  it('pins a hero job to its unique decoded body ahead of equipped weapon looks', () => {
    const inputs = inputsFor(VIKING, ['cr_hum_body_00', 'cr_hum_body_05', 'cr_hum_body_60']);
    const sequencesByBody = new Map(inputs.sequencesByBody);
    sequencesByBody.set('cr_hum_body_60', seqs(['hero_walk', 'hero_wait']));
    const heroIr: ContentIr = {
      ...ir,
      gfxWalkAtomics: [
        {
          tribe: VIKING,
          job: JOB_HERO_SWORD,
          goodType: 0,
          bodySeq: 'hero_walk',
          dirFrames: Array.from({ length: 8 }, () => [0]),
        },
      ],
      gfxAtomics: [
        {
          tribe: VIKING,
          job: JOB_HERO_SWORD,
          action: 2,
          bodySeq: 'hero_wait',
          mode: 1,
          dirFrames: [[0]],
        },
      ],
    };
    const table = tribeCharacters(heroIr, [], VIKING, { ...inputs, sequencesByBody });
    const uniqueBody = inputs.layersByBody.get('cr_hum_body_60')?.body;

    expect(table?.byJob[JOB_HERO_SWORD]?.body).toBe(uniqueBody);
    expect(table?.fixedByJob?.[JOB_HERO_SWORD]?.body).toBe(uniqueBody);
  });

  it('resolves a hero that authors no action rows through its baseJob chain, on its own body', () => {
    const inputs = inputsFor(VIKING, ['cr_hum_body_00', 'cr_hum_body_05', 'cr_hum_body_60']);
    const sequencesByBody = new Map(inputs.sequencesByBody);
    sequencesByBody.set('cr_hum_body_60', seqs(['hero_walk', 'hero_wait', 'civilist_pick_up']));
    // The chest bend sits on the civilist, which the hero's `gfxJobs` never name: only the
    // `baseJob` chain 44 -> 34 -> 31 -> 6 reaches it, and the hero's own body draws that clip.
    const jobs = [
      { typeId: JOB_HERO_SWORD, baseJob: JOB_SOLDIER_SWORD },
      { typeId: JOB_SOLDIER_SWORD, baseJob: JOB_SOLDIER_UNARMED },
      { typeId: JOB_SOLDIER_UNARMED, baseJob: JOB_CIVILIST },
      { typeId: JOB_CIVILIST },
    ];
    const chainIr: ContentIr = {
      ...ir,
      jobs,
      gfxWalkAtomics: [{ tribe: VIKING, job: JOB_HERO_SWORD, goodType: 0, bodySeq: 'hero_walk' }],
      gfxAtomics: [
        { tribe: VIKING, job: JOB_HERO_SWORD, action: 2, bodySeq: 'hero_wait', mode: 1, dirFrames: [[0]] },
        {
          tribe: VIKING,
          job: JOB_CIVILIST,
          action: OPEN_CHEST_ATOMIC,
          bodySeq: 'civilist_pick_up',
          dirFrames: [[0, 1]],
        },
      ],
    };
    const chest = (content: ContentIr) =>
      tribeCharacters(content, [], VIKING, { ...inputs, sequencesByBody })?.byJob[JOB_HERO_SWORD]?.binding
        .byAtomic?.[OPEN_CHEST_ATOMIC];
    expect(chest(chainIr)).toEqual({ start: 16, frameLists: [[0, 1]] });
    // Cut the chain below the unarmed soldier and the civilist's record is out of reach.
    const cut = jobs.map((job) => (job.typeId === JOB_SOLDIER_UNARMED ? { typeId: job.typeId } : job));
    expect(chest({ ...chainIr, jobs: cut })).toBeUndefined();
  });

  it('fills a job the tribe authors no record for from the base table', () => {
    const base = tribeCharacters(ir, [], VIKING, inputsFor(VIKING, ['cr_hum_body_00', 'cr_hum_body_05']));
    // The weresnake has a soldier and nothing else: its soldier is its own, its woman is the base's.
    const snake = tribeCharacters(ir, [], WERESNAKE, inputsFor(WERESNAKE, ['cr_hum_body_70']), base);
    expect(snake).toBeDefined();
    expect(snake?.byJob[JOB_SOLDIER_UNARMED]).not.toBe(base?.byJob[JOB_SOLDIER_UNARMED]);
    expect(snake?.byJob[JOB_WOMAN]).toBe(base?.byJob[JOB_WOMAN]);
    expect(snake?.default).toBe(base?.default);
  });

  it('is undefined for a tribe with no bodies and no base to borrow from', () => {
    expect(tribeCharacters(ir, [], WERESNAKE, inputsFor(WERESNAKE, []))).toBeUndefined();
    expect(tribeCharacters(null, [], VIKING, inputsFor(VIKING, []))).toBeUndefined();
  });

  it('advances the look chain past a body that decoded but binds nothing', () => {
    // The frank spearman chain is [own body, plain soldier]; a first body whose pool draws no walk and no
    // wait must fall through to the next entry rather than dropping the spec to the civilian.
    const inputs = inputsFor(FRANK, ['cr_hum_body_30', 'cr_hum_body_32']);
    const unbindable = new Map(inputs.sequencesByBody);
    unbindable.set('cr_hum_body_32', seqs(['unrelated_clip']));
    const table = tribeCharacters(ir, [], FRANK, { ...inputs, sequencesByBody: unbindable });
    // Job 31's own body binds nothing, so the spec takes the civilian body behind it in the chain.
    expect(table?.byJob[JOB_SOLDIER_UNARMED]).toBeUndefined();
    expect(table?.default).toBeDefined();
  });
});
