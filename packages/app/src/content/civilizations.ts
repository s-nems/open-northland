import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { loadIr } from './ir/load.js';

/**
 * The civilizations a page's content offers. The authored five (`CIVILIZATION_TRIBES`) are the floor
 * every build serves; a content pack adds more with a `tribes` row flagged `civilization`
 * (`docs/MODS.md`, "New civilizations"). Every reader of the floor that has content access reads this
 * module instead, so a modded people shows up in the lobby, the emblems and the seat switches without
 * an app change.
 */

/** One content-declared civilization: the flagged `tribes` row, narrowed to what the UI reads. */
export interface CivilizationRow {
  readonly typeId: number;
  readonly name?: string;
}

/** The narrow `tribes` row view the derivation reads, shared by the IR and the authored joins. */
export type CivilizationTribeRow = {
  readonly typeId?: number;
  readonly name?: string;
  readonly civilization?: boolean;
};

/** The original's highest human tribe id: above it the base content's ids name animal species, which
 *  the wildlife join owns, so a flagged row must clear that range before it counts as a people. */
const LAST_AUTHORED_TRIBE = Math.max(...CIVILIZATION_TRIBES);

/** The content's own civilizations: the flagged `tribes` rows above the authored ids, in id order. */
export function modCivilizations(
  tribes: readonly CivilizationTribeRow[] | undefined,
): readonly CivilizationRow[] {
  const rows: CivilizationRow[] = [];
  for (const row of tribes ?? []) {
    if (row.civilization !== true) continue;
    const { typeId } = row;
    if (typeId === undefined || typeId <= LAST_AUTHORED_TRIBE) continue;
    if (rows.some((other) => other.typeId === typeId)) continue;
    rows.push({ typeId, ...(row.name !== undefined ? { name: row.name } : {}) });
  }
  return rows.sort((a, b) => a.typeId - b.typeId);
}

/** Every civilization the content offers: the authored five, then the content's additions. */
export function civilizationTribes(tribes: readonly CivilizationTribeRow[] | undefined): readonly number[] {
  return [...CIVILIZATION_TRIBES, ...modCivilizations(tribes).map((row) => row.typeId)];
}

/** Every civilization's rows, for the pickers that label them from the content's names. */
export function civilizationRows(
  tribes: readonly CivilizationTribeRow[] | undefined,
): readonly CivilizationRow[] {
  const authored: CivilizationRow[] = [];
  for (const typeId of CIVILIZATION_TRIBES) {
    const name = tribes?.find((row) => row.typeId === typeId)?.name;
    authored.push(name === undefined ? { typeId } : { typeId, name });
  }
  return [...authored, ...modCivilizations(tribes)];
}

let contentCivilizations: Promise<readonly CivilizationRow[]> | null = null;
/** The latest known civilization list for the synchronous UI readers that render before the IR has
 *  answered; the floor until {@link loadCivilizations} resolves. */
let liveTribes: readonly number[] = CIVILIZATION_TRIBES;

/** The civilization list as last loaded: the authored five until the served IR adds a pack's people. */
export function liveCivilizationTribes(): readonly number[] {
  return liveTribes;
}

/** The content's civilization rows, loaded once per page off the served IR. Absent content resolves
 *  empty and is retried by the next caller, like the IR it reads. */
export function loadCivilizations(): Promise<readonly CivilizationRow[]> {
  contentCivilizations ??= loadIr().then((ir) => {
    const rows = civilizationRows(ir?.tribes);
    if (ir === null) contentCivilizations = null;
    else liveTribes = civilizationTribes(ir.tribes);
    return rows;
  });
  return contentCivilizations;
}
