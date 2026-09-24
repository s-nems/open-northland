import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildingBinding,
  candidateFamilies,
  DEFAULT_BUILDING_FAMILY,
  preferredPaletteFor,
  referencedFamilyLayers,
} from '../../src/content/building-gfx/index.js';
import { humanSequences, playableSequences, servedShadowStem } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  HERO_JOBS,
  tribeLooks,
} from '../../src/content/settler-gfx/index.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * Pins that every civilization the content describes can actually be drawn: each one resolves a body and
 * heads for every character look, and every building page its bobs name is decoded on disk. Without this
 * a tribe silently falls back to the viking art it was supposed to replace.
 */

/** The `TRIBE_TYPE_HUMAN_*` civilizations of `logicdefines.inc`: viking, frank, byzantine, saracen,
 *  egypt. Viking leads, as the base tribe of a world fielding them all. */
const CIVILIZATIONS: WorldTribes = [1, 2, 3, 4, 7];

/** The recolourable atlas variant the player-colour LUT is read through - what the game loads. */
const INDEXED = 'indexed';

function bobsDir(): string {
  return resolve(contentDir(), 'bobs');
}

function atlasExists(stem: string): boolean {
  return (
    existsSync(resolve(bobsDir(), `${stem}.atlas.json`)) && existsSync(resolve(bobsDir(), `${stem}.png`))
  );
}

describe.runIf(hasRealIr())('every civilization is drawable', () => {
  it('extracts a [jobbasegraphics] record for each civilization', () => {
    const ir = rawIrUnderTest() as ContentIr;
    for (const tribe of CIVILIZATIONS) {
      const rows = (ir.jobGraphics ?? []).filter((r) => r.tribe === tribe);
      expect(rows.length, `tribe ${tribe} has no jobGraphics rows`).toBeGreaterThan(0);
    }
  });

  it('resolves a decoded body for every character look of every civilization', () => {
    const ir = rawIrUnderTest() as ContentIr;
    if (!existsSync(bobsDir())) return;
    for (const tribe of CIVILIZATIONS) {
      const looks = tribeLooks(ir, tribe);
      for (const [specId] of CHARACTER_SPEC_ENTRIES) {
        const chain = looks.get(specId) ?? [];
        expect(chain.length, `tribe ${tribe} look '${specId}' resolves no record`).toBeGreaterThan(0);
        // The loader takes the first look whose body decoded; at least one of the chain must exist,
        // else that job draws the base tribe's body instead of this civilization's.
        const drawn = chain.find((look) => atlasExists(`${look.bodyBmd}.${INDEXED}`));
        expect(drawn, `tribe ${tribe} look '${specId}' has no decoded body`).toBeDefined();
        for (const head of drawn?.headBmds ?? []) {
          expect(atlasExists(`${head}.${INDEXED}`), `tribe ${tribe} '${specId}' head ${head}`).toBe(true);
        }
      }
    }
  });

  it('keeps every explicitly authored hero on its own decoded body', () => {
    const ir = rawIrUnderTest() as ContentIr;
    if (!existsSync(bobsDir())) return;
    const rows = (ir.jobGraphics ?? []).filter((row) => HERO_JOBS.includes(row.job));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const specId = ADULT_CHARACTER_BY_JOB[row.job];
      const exact = specId === undefined ? undefined : tribeLooks(ir, row.tribe).get(specId)?.[0];
      expect(exact?.job, `tribe ${row.tribe} hero ${row.job} did not win its look chain`).toBe(row.job);
      expect(atlasExists(`${exact?.bodyBmd}.${INDEXED}`), `hero body ${exact?.bodyBmd} is not decoded`).toBe(
        true,
      );
    }
  });

  it('names and decodes a cast-shadow twin for every character body', () => {
    // The render side looks a character's silhouette up by the body's own bob id, and an id the twin
    // leaves empty draws no shadow at all - which is how the data reads: the santa body ships an empty
    // twin, and the bodies that borrow another body's set (77 borrows the woman's) see ids outside
    // their own pool. What must hold is that the set each record names is actually decoded, else that
    // civilization's settlers silently draw shadow-less.
    const ir = rawIrUnderTest() as ContentIr;
    if (!existsSync(bobsDir())) return;
    const rows = ir.jobGraphics ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The stem comes from the app's own join, so a renamed shadow atlas fails here too.
      const stem = servedShadowStem(row.shadowBody);
      expect(stem, `tribe ${row.tribe} job ${row.job} names no shadow set`).toBeDefined();
      if (stem === undefined) continue;
      expect(atlasExists(stem), `shadow set ${stem} is not decoded`).toBe(true);
    }
  });

  it('defines no human sequence name twice with a different range', () => {
    // The cross-body fallback rests on this: a body plays a clip by name out of the shared table, so a
    // second definition would let one body play another's frames.
    const ir = rawIrUnderTest() as ContentIr;
    const seen = new Map<string, { start: number; length: number }>();
    const conflicts: string[] = [];
    for (const set of ir.bobSequences ?? []) {
      if (!set.imagelib.startsWith('cr_hum_')) continue;
      for (const seq of set.sequences ?? []) {
        const held = seen.get(seq.name);
        if (held === undefined) seen.set(seq.name, seq);
        else if (held.start !== seq.start || held.length !== seq.length) conflicts.push(seq.name);
      }
    }
    expect(conflicts).toEqual([]);
    expect(seen.size).toBe(humanSequences(ir).size);
  });

  it('resolves every human animation a civilization names out of the shared sequence table', () => {
    // A tribe's `[gfxanimatomic]` records name sequences that live in another body's `[bobseq]` table -
    // every soldier body but the viking one ships none of its own - so the name space is global and a
    // body plays whatever its own bob pool covers. The vehicle rows key the cart bob set instead.
    const ir = rawIrUnderTest() as ContentIr;
    const all = humanSequences(ir);
    expect(all.size).toBeGreaterThan(100);
    for (const tribe of CIVILIZATIONS) {
      const named = new Set(
        (ir.gfxAtomics ?? []).flatMap((a) =>
          a.tribe === tribe && a.bodySeq?.startsWith('human_') === true ? [a.bodySeq] : [],
        ),
      );
      expect(named.size, `tribe ${tribe} names no human animation`).toBeGreaterThan(0);
      const unresolved = [...named].filter((name) => !all.has(name));
      expect(unresolved, `tribe ${tribe} names sequences no human [bobseq] table carries`).toEqual([]);
    }
  });

  it('keeps a body playing only the sequences its own bob pool covers', () => {
    // The shorter tribe bodies are truncated tails of the longest one, so a name the global table
    // carries can still fall outside a given body's pool.
    const ir = rawIrUnderTest() as ContentIr;
    const all = humanSequences(ir);
    const full = { width: 0, height: 0, frames: new Map([...Array(6000).keys()].map((i) => [i, EMPTY])) };
    const short = { width: 0, height: 0, frames: new Map([...Array(400).keys()].map((i) => [i, EMPTY])) };
    expect(playableSequences(all, full).size).toBe(all.size);
    expect(playableSequences(all, short).size).toBeLessThan(all.size);
  });

  it('decodes every building page the fielded civilizations draw from', () => {
    const ir = rawIrUnderTest() as ContentIr;
    if (!existsSync(bobsDir())) return;
    const families = candidateFamilies(ir, CIVILIZATIONS);
    const layers = referencedFamilyLayers(buildingBinding(ir, CIVILIZATIONS, families));
    expect(layers.size).toBeGreaterThan(0);
    for (const layer of layers) expect(atlasExists(layer), `building page ${layer}`).toBe(true);
  });

  it('keeps the base tribe on the skin its transcribed constants were built from', () => {
    // The viking rows split near-evenly between two skins, so a majority rule there would be one
    // extraction away from reskinning half the settlement.
    const ir = rawIrUnderTest() as ContentIr;
    expect(preferredPaletteFor(ir.buildingBobs ?? [], 1)).toBe(DEFAULT_BUILDING_FAMILY.paletteName);
    // Every other civilization takes its own most common skin. The palette name repeats across `.bmd`s -
    // the frank houses are `ls_houses_frank.bmd` recoloured `house01` - so only the pair names a family.
    const expected: Readonly<Record<number, string>> = {
      2: 'house01',
      3: 'house_byzantine01',
      4: 'house_saracen01',
      7: 'caves',
    };
    for (const [tribe, palette] of Object.entries(expected)) {
      expect(preferredPaletteFor(ir.buildingBobs ?? [], Number(tribe)), `tribe ${tribe}`).toBe(palette);
    }
  });

  it('binds each civilization its own body for the types it skins', () => {
    const ir = rawIrUnderTest() as ContentIr;
    const binding = buildingBinding(ir, CIVILIZATIONS, candidateFamilies(ir, CIVILIZATIONS));
    for (const tribe of CIVILIZATIONS) {
      const own = binding.byTribe?.[tribe]?.byType ?? {};
      expect(Object.keys(own).length, `tribe ${tribe} binds no building`).toBeGreaterThan(20);
    }
    // The same typeId must not resolve to the same bob for two civilizations that both skin it: a
    // saracen mill and a viking mill share the type and would otherwise draw one Norse body.
    const viking = binding.byTribe?.[1]?.byType ?? {};
    const saracen = binding.byTribe?.[4]?.byType ?? {};
    const shared = Object.keys(viking).filter((t) => saracen[Number(t)] !== undefined);
    const distinct = shared.filter(
      (t) => JSON.stringify(viking[Number(t)]) !== JSON.stringify(saracen[Number(t)]),
    );
    expect(distinct.length, 'no shared type draws a different body per tribe').toBeGreaterThan(
      shared.length / 2,
    );
  });
});

const EMPTY = { x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 };
