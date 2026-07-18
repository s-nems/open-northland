import { systems, type WorldSnapshot } from '@open-northland/sim';
import { JOB_SCOUT } from '../../../game/sandbox/index.js';
import {
  childOrderOf,
  entityById,
  hasEligiblePartner,
  isAdult,
  isBoundByMarriage,
  isFemale,
  isMarrying,
  isSettler,
  marriageOf,
  settlerJobType,
} from '../../../game/snapshot.js';
import { DEFAULT_MENU_STATE, type SettlerMenuState } from '../../../hud/action-ring-menu.js';

/**
 * The menu state of the single selected settler — which per-state buttons (marry / assign home /
 * make son+daughter) its ring shows. A multi-selection (or a missing entity) shows none: the family
 * orders are per-settler, so they only surface when exactly one settler anchors the ring. The scout
 * swap (erect-signpost replaces alert/query) keys on the selection's UNIFORM jobType, so a multi-scout
 * selection keeps the button (the erect order takes several scouts).
 */
export const menuStateFor = (
  snapshot: WorldSnapshot,
  ids: readonly number[],
  uniformJobType: number | undefined,
): SettlerMenuState => {
  const erectSignpost = uniformJobType === JOB_SCOUT;
  if (ids.length !== 1 || ids[0] === undefined) return { ...DEFAULT_MENU_STATE, erectSignpost };
  const e = entityById(snapshot, ids[0]);
  if (e === undefined || !isSettler(e)) return { ...DEFAULT_MENU_STATE, erectSignpost };
  // A single selected child shows no change-profession button (its stage is the GrowthSystem's) and
  // no family buttons.
  if (!isAdult(e)) return { ...DEFAULT_MENU_STATE, canChangeJob: false, erectSignpost };
  const married = marriageOf(e);
  const spouseAlive = married !== undefined && entityById(snapshot, married.spouse) !== undefined;
  const onMission = systems.isOnMission(settlerJobType(e) ?? null);
  // The one-child limit: a living, still-growing child blocks a fresh order (a grown or dead child
  // frees it — the sim command re-validates either way; this only decides button visibility).
  const child = married?.child ?? null;
  const childEntity = child !== null ? entityById(snapshot, child) : undefined;
  const raisingChild = childEntity !== undefined && !isAdult(childEntity);
  return {
    canChangeJob: !isFemale(e), // women keep the woman role for life (the sim guards setJob too)
    // Marry only lights up when somebody eligible exists — otherwise the click would silently cancel.
    // isBoundByMarriage mirrors the widowing rule: a widow is free again once her child grows up.
    canMarry:
      !isBoundByMarriage(snapshot, e) && !isMarrying(e) && !onMission && hasEligiblePartner(snapshot, e),
    canAssignHouse: true,
    // Ordering a child needs a LIVING spouse (a widow's stale marriage doesn't light the button).
    canOrderChild: spouseAlive && isFemale(e) && !raisingChild && childOrderOf(e) === undefined,
    erectSignpost,
  };
};
