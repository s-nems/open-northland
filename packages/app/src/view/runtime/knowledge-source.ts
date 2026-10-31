import type { ContentSet } from '@open-northland/data';
import type { UnlockKind, UnlockStatus, WorldSnapshot } from '@open-northland/sim';
import { loadObjectHelp } from '../../content/gui/gfx.js';
import { discoveryProgressOf } from '../../game/technology.js';
import type { GoodIconPainter } from '../../hud/dom/good-art.js';
import { createKnowledgeSettlement } from '../../hud/knowledge/settlement.js';
import type { KnowledgeSource } from '../../hud/tool-panel/index.js';
import { currentLocale } from '../../i18n/index.js';

export interface KnowledgeSourceDeps {
  readonly content: ContentSet;
  readonly tribe: number;
  readonly seat: () => number | null;
  readonly unlockStatus: (
    kind: UnlockKind,
    typeId: number,
    tribe: number,
    player: number,
  ) => Promise<UnlockStatus>;
  readonly snapshot: () => WorldSnapshot;
  readonly goodIcon: GoodIconPainter;
}

/** Knowledge as a running game feeds it. The reference and its view load on the first open. */
export function createKnowledgeSource(deps: KnowledgeSourceDeps): KnowledgeSource {
  const { content, tribe } = deps;
  const settlement = createKnowledgeSettlement({
    content,
    tribe,
    seat: deps.seat,
    unlockStatus: deps.unlockStatus,
    progressOf: (player) => discoveryProgressOf(content, deps.snapshot(), player, tribe),
  });
  return {
    createView: async (thumbs) => {
      const [{ createKnowledgeBase }, { createKnowledgeView }, { createKnowledgeArt }, { loadIr }] =
        await Promise.all([
          import('../../hud/knowledge/base.js'),
          import('../../hud/dom/knowledge/view.js'),
          import('../../hud/dom/knowledge/art.js'),
          import('../../content/ir/load.js'),
        ]);
      const [help, ir] = await Promise.all([loadObjectHelp(currentLocale()), loadIr()]);
      return createKnowledgeView({
        base: createKnowledgeBase(content, help),
        art: createKnowledgeArt({ ir, goodIcon: deps.goodIcon, thumbs }),
        settlement,
      });
    },
    refresh: (stocks) => settlement.refresh(stocks),
    buildingId: (typeId) => content.buildings.find((b) => b.typeId === typeId)?.id,
  };
}
