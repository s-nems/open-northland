import { subClipKey } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { inHouseProgramLookup, sequencesFor } from '../../src/content/ir/joins.js';
import { BODY_IMAGELIB, type ContentIr } from '../../src/content/ir/rows.js';
import { CHARACTER_SPECS, characterBinding } from '../../src/content/settler-gfx/index.js';
import { rebaseSlotJob } from '../../src/game/sandbox/ids/index.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * The indoor craft join over the REAL generated IR: a trade's production atomic must reach a
 * choreography, and every sub-clip that choreography calls for must be a real frame range on the body
 * the trade draws. A break here is a worker standing motionless in his workshop, which no synthetic
 * fixture can catch, because the programs and the clip pool are both decoded content.
 */

const VIKING = 1;
/** The `[gfxanimatomic]` sub-clip records all sit on the generic man body every civilian trade draws. */
const CIVILIAN_SPEC = CHARACTER_SPECS.civilian;

describe.runIf(hasRealIr())('the indoor craft join over real content', () => {
  const ir = (): ContentIr => rawIrUnderTest() as ContentIr;

  /** The running content set's goods as the sheet passes them, plus a sandbox-style offset set, to
   *  exercise the id space the carry-gait table is actually keyed in. */
  const goodsOf = (offset = 0): { typeId: number; id: string }[] =>
    ((ir().goods ?? []) as readonly { typeId: number; id: string }[]).map((g) => ({
      typeId: g.typeId + offset,
      id: g.id,
    }));

  it('choreographs the trades whose programs the source ships', async () => {
    const { real } = await loadContentUnderTest();
    const lookup = inHouseProgramLookup(ir(), goodsOf());
    // Every viking trade the source choreographs must resolve through the scene's own lookup shape.
    const programs = (ir().gfxInHousePrograms ?? []).filter((p) => p.tribe === VIKING);
    expect(programs.length).toBeGreaterThan(0);
    for (const program of programs) {
      const found = lookup(VIKING, program.job, program.action);
      expect(found?.entries.length, `${program.job}/${program.action}`).toBe(program.entries.length);
    }
    // The baker is the worked example: his bread atomic is what a produce clip runs on.
    const bread = real.goods.find((g) => g.id === 'bread');
    expect(bread?.atomics.produce).toBeDefined();
    expect(lookup(VIKING, 20, bread?.atomics.produce ?? -1)).toBeDefined();
  });

  it('binds every sub-clip its programs call for to a real frame range on the body that draws it', () => {
    const seqByName = sequencesFor(ir(), BODY_IMAGELIB);
    const subClips = (ir().gfxAtomics ?? []).filter((r) => r.tribe === VIKING && r.subId !== undefined);
    // No two trades may claim one `(action, subId)`: the binding is keyed on that pair alone, so a
    // collision would silently draw another trade's clip.
    const claims = new Map<string, number>();
    for (const row of subClips) {
      const key = subClipKey(row.action, row.subId ?? 0);
      const held = claims.get(key);
      expect(
        held === undefined || held === row.job,
        `${key} claimed by jobs ${String(held)} and ${row.job}`,
      ).toBe(true);
      claims.set(key, row.job);
    }
    const binding = characterBinding(CIVILIAN_SPEC, seqByName, [], { subClips });
    const bound = binding?.bySubClip ?? {};
    for (const program of (ir().gfxInHousePrograms ?? []).filter((p) => p.tribe === VIKING)) {
      for (const entry of program.entries) {
        // A sub-clip 0 names the job's own record for the action, which falls back to the standing wait.
        if (entry.kind !== 'clip' || entry.subId === 0) continue;
        const key = subClipKey(entry.action, entry.subId);
        expect(bound[key], `${program.job} performs unbound clip ${key}`).toBeDefined();
      }
    }
    expect(Object.keys(bound).length).toBeGreaterThan(0);
  });

  it('hauls its programs’ goods on gaits the performing body actually carries', () => {
    const goods = goodsOf();
    const seqByName = sequencesFor(ir(), BODY_IMAGELIB);
    const carrySeqBySlug = new Map(
      (ir().gfxWalkAtomics ?? [])
        .filter((r) => r.tribe === VIKING && r.job === CIVILIAN_SPEC.logicJob && r.goodType !== 0)
        .map((r) => [goods.find((g) => g.typeId === r.goodType)?.id ?? '', r.bodySeq]),
    );
    const binding = characterBinding(CIVILIAN_SPEC, seqByName, goods, { carrySeqBySlug });
    const byGood = binding?.carrying?.byGood ?? {};
    const lookup = inHouseProgramLookup(ir(), goods);
    for (const program of (ir().gfxInHousePrograms ?? []).filter((p) => p.tribe === VIKING)) {
      for (const entry of lookup(VIKING, program.job, program.action)?.entries ?? []) {
        if (entry.kind !== 'walk' || entry.goodType === 0) continue;
        expect(byGood[entry.goodType], `no carry gait for good ${entry.goodType}`).toBeDefined();
      }
    }
  });

  it('reads a worker’s job back into the source’s id space', () => {
    // A content set built without extracted logic lifts its worker-slot trades clear of the sandbox's
    // own band, so a settler would arrive carrying a rebased job the source's rows never name.
    const lookup = inHouseProgramLookup(ir(), goodsOf());
    for (const program of (ir().gfxInHousePrograms ?? []).filter((p) => p.tribe === VIKING)) {
      const rebased = rebaseSlotJob(program.job);
      if (rebased === program.job) continue; // a trade the rebase leaves alone
      expect(lookup(VIKING, rebased, program.action)?.entries.length).toBe(program.entries.length);
    }
  });

  it('rewrites a program’s carried goods into the running content set’s id space', () => {
    // A sandbox content set offsets every extended good, so the raw `goodtypes.ini` ids the programs
    // carry would miss the carry-gait table entirely and the worker would cross the room empty-handed.
    const OFFSET = 100;
    const shifted = inHouseProgramLookup(ir(), goodsOf(OFFSET));
    const source = inHouseProgramLookup(ir(), goodsOf());
    let compared = 0;
    for (const program of (ir().gfxInHousePrograms ?? []).filter((p) => p.tribe === VIKING)) {
      const raw = source(VIKING, program.job, program.action)?.entries ?? [];
      const moved = shifted(VIKING, program.job, program.action)?.entries ?? [];
      raw.forEach((entry, i) => {
        const other = moved[i];
        if (entry.kind !== 'walk' || other?.kind !== 'walk' || entry.goodType === 0) return;
        expect(other.goodType).toBe(entry.goodType + OFFSET);
        compared++;
      });
    }
    expect(compared).toBeGreaterThan(0);
  });
});
