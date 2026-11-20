import { type ChestKind, nodeOfPosition, systems } from '@open-northland/sim';
import {
  chestContentsOf,
  chestKindOf,
  positionOf,
  type SnapshotEntity,
} from '../../../game/snapshot/index.js';
import { vehicleLabel } from '../../../game/technology.js';
import { jobDisplayName } from '../../../hud/details-panel/model/context.js';
import { paperLabel } from '../../../hud/tool-panel/paper-label.js';
import { tribeName } from '../../../i18n/index.js';
import { type ChestScriptNaming, chestScriptParts } from './chest-script.js';
import { countedLabel, goodLabel } from './counted-label.js';

export interface ChestContentsNaming extends ChestScriptNaming {
  readonly buildingLabel: (typeId: number) => string | undefined;
}

/** What a closed chest hands out when opened, as one line: its chest type's reward, then what the map
 *  script does for it; null for an entity that is no closed chest, or one that hands out nothing. */
export function chestContentsLabel(naming: ChestContentsNaming, chest: SnapshotEntity): string | null {
  const kind = chestKindOf(chest);
  const contents = chestContentsOf(chest);
  const position = positionOf(chest);
  if (kind === undefined || contents === undefined || position === undefined) return null;
  const reward = rewardLabel(naming, kind, contents);
  const parts = [
    ...(reward === null ? [] : [reward]),
    ...chestScriptParts(naming, nodeOfPosition(position.x, position.y)),
  ];
  return parts.length === 0 ? null : parts.join(' · ');
}

/** What chest type `contents` in a `kind` chest hands out, or null when the sim's table names nothing
 *  for it (a campaign chest whose script pays instead). */
function rewardLabel(naming: ChestContentsNaming, kind: ChestKind, contents: number): string | null {
  const { content } = naming;
  const paperNaming = {
    uiString: naming.uiString,
    buildingLabel: naming.buildingLabel,
    jobLabel: (jobType: number) => jobDisplayName(content, jobType),
    goodLabel: (goodType: number) => goodLabel(content, goodType),
  };
  const reward = systems.resolveChestReward(content, kind, contents);
  switch (reward.kind) {
    case 'goods':
      return countedLabel(goodLabel(content, reward.goodType), reward.amount);
    case 'paper':
    case 'workshop':
      return paperLabel(reward.paper, paperNaming);
    case 'settlers':
      return countedLabel(jobDisplayName(content, reward.jobType), reward.count);
    case 'animals': {
      const animal = content.animals.find((row) => row.tribeType === reward.tribe);
      return countedLabel(tribeName(reward.tribe, animal?.name ?? animal?.id), reward.count);
    }
    case 'vehicle':
      return vehicleLabel(content, reward.vehicleType) ?? `#${reward.vehicleType}`;
    case 'nothing':
      return null;
  }
}
