import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  type BobSequenceSet,
  type GfxAnimAtomic,
  type GfxWalkAtomic,
  VehicleGraphics,
  type VehicleType,
} from '@open-northland/data';
import {
  cifBytesToSections,
  extractVehicleGraphicsBindings,
  iniBytesToSections,
  makeSource,
  type PaletteAlias,
  type RawFrameAtomic,
  type RawFrameGait,
  type SourceRef,
  type VehicleGraphicsBinding,
} from '../../decoders/ini.js';
import { CULTURESNATION_MOD } from '../../mod-root.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

const MOD_FILE = `${CULTURESNATION_MOD}/types/vehiclestype/jobgraphics.ini`;
const BASE_FILE = 'Data/engine2d/inis/vehicles/jobgraphics.cif';

/** A vehicle body binding with the file it was read from. */
export interface SourcedVehicleBinding {
  readonly binding: VehicleGraphicsBinding;
  readonly src: SourceRef;
}

/** Folds the layers highest precedence first: the first binding per `(tribe, vehicleType)` wins. */
export function mergeVehicleBindings(
  layers: readonly (readonly SourcedVehicleBinding[])[],
): SourcedVehicleBinding[] {
  const seen = new Set<string>();
  const out: SourcedVehicleBinding[] = [];
  for (const layer of layers) {
    for (const row of layer) {
      const key = `${row.binding.tribeId}:${row.binding.vehicleType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/** The vehicle `[jobgraphics]` table, mod `.ini` over base `.cif`; an absent source contributes nothing. */
export async function loadVehicleGraphicsBindings(roots: SourceRoots): Promise<SourcedVehicleBinding[]> {
  const layers: SourcedVehicleBinding[][] = [];
  const modPath = await resolveSourceFile(roots, MOD_FILE);
  if (modPath !== undefined) {
    const src: SourceRef = { file: MOD_FILE, layer: 'mod' };
    layers.push(
      extractVehicleGraphicsBindings(iniBytesToSections(await readFile(modPath))).map((binding) => ({
        binding,
        src,
      })),
    );
  }
  const basePath = await resolveSourceFile(roots, BASE_FILE);
  if (basePath !== undefined) {
    const src: SourceRef = { file: BASE_FILE, layer: 'base' };
    layers.push(
      extractVehicleGraphicsBindings(cifBytesToSections(await readFile(basePath))).map((binding) => ({
        binding,
        src,
      })),
    );
  }
  return mergeVehicleBindings(layers);
}

/** The tables one vehicle graphics row joins over. */
export interface VehicleGraphicsInput {
  readonly bindings: readonly SourcedVehicleBinding[];
  readonly vehicles: readonly VehicleType[];
  readonly bobSequences: readonly BobSequenceSet[];
  readonly gfxAtomics: readonly GfxAnimAtomic[];
  readonly gfxWalkAtomics: readonly GfxWalkAtomic[];
  readonly rawAtomics: readonly RawFrameAtomic[];
  readonly rawGaits: readonly RawFrameGait[];
  readonly palettes: readonly PaletteAlias[];
}

/** A `[bobseq]` run's first bob id, keyed by sequence name, for the sequences of one bob set. */
function sequenceStarts(sets: readonly BobSequenceSet[], body: string): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  const stem = basename(body);
  for (const set of sets) {
    if (basename(set.imagelib) !== stem) continue;
    for (const seq of set.sequences) if (!starts.has(seq.name)) starts.set(seq.name, seq.start);
  }
  return starts;
}

function offsetFrames(dirFrames: readonly (readonly number[])[], start: number): number[][] {
  return dirFrames.map((list) => list.map((idx) => start + idx));
}

function copyFrames(dirFrames: readonly (readonly number[])[]): number[][] {
  return dirFrames.map((list) => [...list]);
}

const FIRST_FAMILY_MEMBER = 1;

/**
 * The numbered palette family a body palette starts (`human_ship01` .. `human_ship10`): every alias
 * `<stem><n>` with the same zero padding, from 1 up to the first gap. One member is no family.
 */
export function paletteFamily(bodyPalette: string, palettes: readonly PaletteAlias[]): string[] | undefined {
  const match = /^(.*?)(\d+)$/.exec(bodyPalette);
  if (match === null) return undefined;
  const [, stem = '', digits = ''] = match;
  if (Number.parseInt(digits, 10) !== FIRST_FAMILY_MEMBER) return undefined;
  const names = new Set(palettes.map((p) => p.name));
  const family: string[] = [];
  for (let n = FIRST_FAMILY_MEMBER; ; n++) {
    const name = `${stem}${String(n).padStart(digits.length, '0')}`;
    if (!names.has(name)) break;
    family.push(name);
  }
  return family.length > 1 ? family : undefined;
}

/**
 * Joins each vehicle body binding with its type's animation records. A `[bobseq]`-relative record is
 * resolved to bob ids through the sequence table of the binding's own bob set; a record naming a
 * sequence that set lacks is dropped with a warning. A binding whose vehicle type is not in the table
 * yields no row.
 */
export function buildVehicleGraphics(input: VehicleGraphicsInput): VehicleGraphics[] {
  const vehicleByType = new Map(input.vehicles.map((v) => [v.typeId, v]));
  const rows: VehicleGraphics[] = [];
  for (const { binding, src } of input.bindings) {
    const vehicle = vehicleByType.get(binding.vehicleType);
    if (vehicle === undefined) continue;
    const { tribeId: tribe } = binding;
    const job = vehicle.jobId;
    const starts = sequenceStarts(input.bobSequences, binding.bmd);
    const resolve = (bodySeq: string, dirFrames: readonly (readonly number[])[]): number[][] | undefined => {
      const start = starts.get(bodySeq);
      if (start === undefined) {
        console.warn(
          `[pipeline] vehicle ${vehicle.id} tribe ${tribe}: ${binding.bmd} has no sequence ${bodySeq}`,
        );
        return undefined;
      }
      return offsetFrames(dirFrames, start);
    };
    const clips: VehicleGraphics['clips'] = [];
    for (const row of input.gfxAtomics) {
      // A row without a body sequence carries raw bob ids; the raw-frame rows below own those.
      if (row.tribe !== tribe || row.job !== job || row.bodySeq === undefined) continue;
      const dirFrames = resolve(row.bodySeq, row.dirFrames);
      if (dirFrames !== undefined) clips.push({ action: row.action, dirFrames });
    }
    for (const row of input.rawAtomics) {
      if (row.tribe !== tribe || row.job !== job) continue;
      clips.push({ action: row.action, dirFrames: copyFrames(row.dirFrames) });
    }
    const gaits: VehicleGraphics['gaits'] = [];
    for (const row of input.gfxWalkAtomics) {
      if (row.tribe !== tribe || row.job !== job || row.dirFrames === undefined) continue;
      const dirFrames = resolve(row.bodySeq, row.dirFrames);
      if (dirFrames !== undefined) gaits.push({ goodType: row.goodType, dirFrames });
    }
    for (const row of input.rawGaits) {
      if (row.tribe !== tribe || row.job !== job) continue;
      gaits.push({
        goodType: row.goodType,
        dirFrames: copyFrames(row.dirFrames),
        ...(row.turnFrames !== undefined ? { turnFrames: copyFrames(row.turnFrames) } : {}),
      });
    }
    clips.sort((a, b) => a.action - b.action);
    gaits.sort((a, b) => a.goodType - b.goodType);
    const playerPalettes = paletteFamily(binding.paletteName, input.palettes);
    rows.push(
      VehicleGraphics.parse({
        tribe,
        vehicleType: binding.vehicleType,
        job,
        body: binding.bmd,
        ...(binding.shadowBmd !== undefined ? { shadowBody: binding.shadowBmd } : {}),
        bodyPalette: binding.paletteName,
        ...(playerPalettes !== undefined ? { playerPalettes } : {}),
        clips,
        gaits,
        source: makeSource(src, 'jobgraphics'),
      }),
    );
  }
  return rows;
}
