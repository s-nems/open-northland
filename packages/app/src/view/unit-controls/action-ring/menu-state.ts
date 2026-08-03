import type { ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  childOrderOf,
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
 * Which per-state buttons the ring shows. Family orders are per-settler, so they surface only when
 * exactly one settler anchors the ring; the scout swap keys on the selection's uniform jobType and
 * survives a multi-scout selection, though only `ids[0]` erects.
 */
export const menuStateFor = (
  content: ContentSet,
  snapshot: WorldSnapshot,
  ids: readonly number[],
  uniformJobType: number | undefined,
): SettlerMenuState => {
  const erectSignpost = systems.isScoutJob(content, uniformJobType ?? null);
  if (ids.length !== 1 || ids[0] === undefined) return { ...DEFAULT_MENU_STATE, erectSignpost };
  const e = entityById(snapshot, ids[0]);
  if (e === undefined || !isSettler(e)) return { ...DEFAULT_MENU_STATE, erectSignpost };
  // A child's stage belongs to the GrowthSystem, so it offers no profession or family buttons.
  if (!isAdult(e)) return { ...DEFAULT_MENU_STATE, canChangeJob: false, erectSignpost };
  const married = marriageOf(e);
  const spouseAlive = married !== undefined && entityById(snapshot, married.spouse) !== undefined;
  const onMission = systems.isOnMission(content, settlerJobType(e) ?? null);
  // The one-child limit: a living, still-growing child blocks a fresh order.
  const child = married?.child ?? null;
  const childEntity = child !== null ? entityById(snapshot, child) : undefined;
  const raisingChild = childEntity !== undefined && !isAdult(childEntity);
  return {
    canChangeJob: !isFemale(e), // women keep the woman role for life; the sim guards setJob too
    // isBoundByMarriage mirrors the widowing rule: a widow is free again once her child grows up.
    canMarry:
      !isBoundByMarriage(snapshot, e) &&
      !isMarrying(e) &&
      !onMission &&
      hasEligiblePartner(content, snapshot, e),
    canAssignHouse: true,
    // The spouse must be alive: a widow's stale marriage does not light the button.
    canOrderChild: spouseAlive && isFemale(e) && !raisingChild && childOrderOf(e) === undefined,
    erectSignpost,
  };
};
