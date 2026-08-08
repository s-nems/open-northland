import type { ConstructionLayerRef } from '@open-northland/render';
import type { ConstructionLayerRow } from '../ir/rows.js';
import {
  type BuildingFamily,
  CANONICAL_EDIT_NAME,
  familyLayerFor,
  preferredPalettePool,
  rowsByType,
} from './families.js';

/**
 * Reduce the decoded `constructionLayers` IR's from-scratch rows (`upgrade === false`) to the render's
 * per-type construction-stage binding for one tribe. A typeId whose chosen stage group has any stage in an
 * unloaded family is omitted entirely, so it keeps its normal body draw.
 *
 * A typeId's stages must all come from one source record at one size level - several records can carry the
 * same typeId, and merging their per-record `stackIdx` streams would interleave two different stage stacks.
 * Stages keep the source stacking order (`stackIdx`) within the group one record contributes.
 */
export function constructionRefsByType(
  rows: readonly ConstructionLayerRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): Record<number, ConstructionLayerRef[]> {
  return stageRefsByType(rows, tribeId, defaultFamily, families, (r) => !r.upgrade);
}

/**
 * The upgrade-pass twin of {@link constructionRefsByType}: the `upgrade === true` rows - each keyed by the
 * tier being upgraded, its bob the next tier's finished body - under the same family and one-source-record
 * rules. An upgrading building draws its old finished body with these layers revealing over it.
 */
export function upgradeRefsByType(
  rows: readonly ConstructionLayerRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): Record<number, ConstructionLayerRef[]> {
  return stageRefsByType(rows, tribeId, defaultFamily, families, (r) => r.upgrade);
}

/** The shared reduction behind the from-scratch and upgrade passes - see {@link constructionRefsByType}. */
function stageRefsByType(
  rows: readonly ConstructionLayerRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
  pass: (r: ConstructionLayerRow) => boolean,
): Record<number, ConstructionLayerRef[]> {
  const byType = rowsByType(rows, tribeId, pass);
  const out: Record<number, ConstructionLayerRef[]> = {};
  for (const [typeId, list] of byType) {
    const pool = preferredPalettePool(list, defaultFamily.paletteName);
    const groups = new Map<string, ConstructionLayerRow[]>();
    for (const r of pool) {
      const key = `${r.editName ?? ''}|${r.level}`;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [r]);
      else group.push(r);
    }
    const canonName = CANONICAL_EDIT_NAME[typeId];
    let chosen: ConstructionLayerRow[] | undefined;
    for (const group of groups.values()) {
      const first = group[0];
      if (first === undefined) continue;
      const current = chosen?.[0];
      if (
        chosen === undefined ||
        current === undefined ||
        // The canonical editName wins outright; otherwise lowest level (the base build stage), then
        // smallest editName.
        (canonName !== undefined && first.editName === canonName && current.editName !== canonName) ||
        (!(canonName !== undefined && current.editName === canonName) &&
          (first.level < current.level ||
            (first.level === current.level && (first.editName ?? '') < (current.editName ?? ''))))
      ) {
        chosen = group;
      }
    }
    if (chosen === undefined) continue;

    const candidates = chosen.slice().sort((a, b) => a.stackIdx - b.stackIdx);
    const refs: ConstructionLayerRef[] = [];
    let dropped = false;
    for (const r of candidates) {
      const layer = familyLayerFor(r.bmd, r.paletteName, defaultFamily, families);
      if (layer === null) {
        dropped = true; // a stage in an unloaded family - the whole type keeps its body draw
        break;
      }
      refs.push(
        layer.layer === undefined
          ? { bob: r.bobId, fromPct: r.fromPct, toPct: r.toPct }
          : { layer: layer.layer, bob: r.bobId, fromPct: r.fromPct, toPct: r.toPct },
      );
    }
    if (!dropped && refs.length > 0) out[typeId] = refs;
  }
  return out;
}
