import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { settlerName } from '../../game/character-names/index.js';
import {
  isSettler,
  isWildlife,
  progressionGatesSettler,
  type SnapshotEntity,
  settlerJobType,
} from '../../game/snapshot/index.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { jobDisplayName, type UnitPanelModelContext } from '../details-panel/model/context.js';
import { experienceRows } from '../details-panel/model/settler.js';
import { settlerRole } from '../details-panel/model/settler-household.js';
import { unlockProgress } from '../details-panel/model/settler-unlocks.js';
import { productSelectionLabel, settlerProductSelection } from '../details-panel/model/settler-work.js';
import type { HoverCardFact, SettlerHoverModel } from './model.js';
import { foreignOwner, type HoverOwnerContext } from './owner.js';

/**
 * What the cursor card over a settler says: who it is and what it does, on one line. Short on purpose -
 * the details panel owns the rest, and the card has to stay readable over a
 * crowded settlement. Owner rules: another seat's person adds a line naming its owner; the viewer's own
 * worker names the goods it is set to make after its trade, or "everything" while every open one runs,
 * and adds its trained tracks and the one profession it is nearest to unlocking.
 */

/** The details panel's reads, which the own worker's products come through, and whose the person is. */
export type SettlerHoverContext = UnitPanelModelContext & HoverOwnerContext;

/** The card's model for the settler under the cursor, or null when `entityId` is not a person. Wildlife
 *  and livestock draw as settlers too, and neither carries a name or a trade. */
export function settlerHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: SettlerHoverContext,
): SettlerHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !isSettler(ent) || isWildlife(ent)) return null;
  const owner = foreignOwner(ent, ctx);
  return {
    kind: 'settler',
    entityId,
    title: settlerName(ctx, ent),
    profession: jobDisplayName(ctx, settlerJobType(ent)),
    products: owner === null ? selectedProducts(ctx, snapshot, ent) : null,
    owner,
    facts: owner === null ? trainingFacts(ctx, snapshot, ent) : [],
  };
}

/** Experience lines the card lists before it counts the rest, so a veteran of many trades keeps a card
 *  that fits beside the cursor. */
const EXPERIENCE_FACTS_MAX = 5;

/** The own person's training, one line each: its trained tracks, the panel's Experience rows with the
 *  current trade's first, and the profession nearest to unlocking, the panel's first job unlock. A woman
 *  and a child train in nothing. */
function trainingFacts(
  ctx: SettlerHoverContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): HoverCardFact[] {
  const role = settlerRole(ctx, ent);
  if (role === 'woman' || role === 'child') return [];
  const facts: HoverCardFact[] = [];
  const trainedRows = experienceRows(ctx, ent.components);
  const copy = messages().hud.settlerPanel;
  for (const trained of trainedRows.slice(0, EXPERIENCE_FACTS_MAX)) {
    facts.push({
      label: trained.label,
      // The bonus alone keeps the card narrow; a track that buys none (a carrier's) counts its repeats,
      // and the fight counter names its two bonuses.
      value:
        trained.bonusPct === null
          ? formatMessage(copy.repeats, { count: trained.repeats })
          : trained.takenCutPct === null
            ? `+${trained.bonusPct}%`
            : `${formatMessage(copy.fightDealt, { pct: trained.bonusPct })}, ${formatMessage(copy.fightTaken, { pct: trained.takenCutPct })}`,
    });
  }
  const hidden = trainedRows.length - EXPERIENCE_FACTS_MAX;
  if (hidden > 0)
    facts.push({ label: formatMessage(messages().hud.settlerPanel.moreRows, { count: hidden }), value: '' });
  const nextJob = unlockProgress(ctx, ent.components, progressionGatesSettler(snapshot, ent)).find(
    (row) => row.target === 'job',
  );
  if (nextJob !== undefined) {
    facts.push({
      label: formatMessage(messages().hud.hoverCard.discovery, { job: nextJob.unlocks }),
      value: `${nextJob.current} / ${nextJob.required}`,
    });
  }
  return facts;
}

/** The products the worker is set to make, named; every open one running reads as one word. */
function selectedProducts(
  ctx: SettlerHoverContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): string | null {
  const selection = settlerProductSelection(ctx, snapshot, ent);
  return selection === null ? null : productSelectionLabel(selection);
}
