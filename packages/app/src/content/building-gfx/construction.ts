import type { ConstructionLayerRef } from '@open-northland/render';
import type { ConstructionLayerRow } from '../ir.js';
import {
  type BuildingFamily,
  CANONICAL_EDIT_NAME,
  familyLayerFor,
  preferredPalettePool,
  rowsByType,
} from './families.js';

/**
 * Reduce the decoded `constructionLayers` IR (the `extractConstructionLayers` leg) to the render's
 * per-type construction-stage binding for one tribe — the staged-graphics twin of
 * {@link import('./families.js').buildingBobRefsByType}, sharing its family rules: a row's
 * `(bmd, palette)` must be the {@link defaultFamily} (a bare-id stage on the default building layer) or a
 * loaded named family (a layer-qualified stage); a row in an unloaded family is dropped (its frame-id space
 * differs — never borrow), and a typeId whose stages end up all dropped is omitted entirely (it keeps its
 * normal body draw rather than showing a partial stack). This pass consumes the from-scratch rows
 * (`upgrade === false`); {@link upgradeRefsByType} is the `upgrade === true` twin.
 *
 * A typeId's stages must all come from one source record at one size level — several records can carry the
 * same typeId (the HQ's `"viking headquarters"` vs its `"viking headquarters house"` variant; the pottery
 * maps one typeId at two sizeIdx; the two wall orientations share typeId 22), and merging their per-record
 * `stackIdx` streams would interleave two different stage stacks. So the reduction first restricts to the
 * preferred palette (when present), then picks one `(editName, level)` group: the {@link CANONICAL_EDIT_NAME}
 * match when it names this typeId (the same disambiguation the body binding applies), else the lowest
 * `level` (the base build stage — the extractors' lowest-sizeIdx convention), ties to the lexicographically
 * smallest `editName` (deterministic, order-independent). The chosen group's stages keep their source
 * stacking order (`stackIdx`). Pure.
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
 * The upgrade-pass twin of {@link constructionRefsByType}: reduces the `upgrade === true` rows — each
 * keyed by the tier being upgraded, its bob the NEXT tier's finished body — to the render's
 * `upgradeByType` binding, under exactly the same family/one-source-record rules. An UPGRADING
 * building draws its old finished body with these layers revealing over it.
 */
export function upgradeRefsByType(
  rows: readonly ConstructionLayerRow[],
  tribeId: number,
  defaultFamily: { readonly bmdBasename: string; readonly paletteName: string },
  families: readonly BuildingFamily[],
): Record<number, ConstructionLayerRef[]> {
  return stageRefsByType(rows, tribeId, defaultFamily, families, (r) => r.upgrade);
}

/** The shared reduction behind the from-scratch and upgrade passes — see {@link constructionRefsByType}. */
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
    // one record-level group per type (see the JSDoc): group by (editName, level), pick canonically.
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
        // The canonical editName wins outright; otherwise lowest level, then smallest editName.
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
        dropped = true; // a stage in an unloaded family — the whole type keeps its body draw
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
