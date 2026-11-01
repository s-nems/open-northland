import type { ContentSet } from '@open-northland/data';
import type { UnlockKind, UnlockStatus } from '@open-northland/sim';
import { type DiscoveryProgressRead, technologyMissing } from '../../game/technology.js';
import type { KnowledgeSettlement, KnowledgeStatus } from '../dom/knowledge/context.js';

type StatusKind = Parameters<KnowledgeSettlement['status']>[0];

const UNLOCK_KIND: Readonly<Record<StatusKind, UnlockKind>> = {
  building: 'house',
  good: 'good',
  job: 'job',
};
const AVAILABLE: KnowledgeStatus = { kind: 'available' };

/** Only reads: the window holds no way to submit a command. */
export interface KnowledgeSeatDeps {
  readonly content: ContentSet;
  readonly tribe: number;
  readonly seat: () => number | null;
  readonly unlockStatus: (
    kind: UnlockKind,
    typeId: number,
    tribe: number,
    player: number,
  ) => Promise<UnlockStatus>;
  readonly progressOf: (player: number) => DiscoveryProgressRead;
}

/** The seat's statuses as of the last `refresh`, which the window runs before it renders. */
export interface LiveKnowledgeSettlement extends KnowledgeSettlement {
  refresh(): Promise<void>;
}

export function knowledgeStatusOf(
  content: ContentSet,
  status: UnlockStatus,
  progressOf?: DiscoveryProgressRead,
): KnowledgeStatus {
  if (!status.allowed) return { kind: 'mapForbidden' };
  if (status.enabled) return AVAILABLE;
  return { kind: 'locked', missing: technologyMissing(content, status, progressOf) };
}

export function createKnowledgeSettlement(deps: KnowledgeSeatDeps): LiveKnowledgeSettlement {
  const { content, tribe } = deps;
  let statuses: ReadonlyMap<string, KnowledgeStatus> = new Map();
  return {
    tribe,
    status: (kind, typeId) => statuses.get(`${kind}:${typeId}`) ?? AVAILABLE,
    refresh: async () => {
      const player = deps.seat();
      if (player === null) {
        statuses = new Map();
        return;
      }
      const progress = deps.progressOf(player);
      const ask = async (kind: StatusKind, typeId: number): Promise<[string, KnowledgeStatus]> => {
        const status = await deps.unlockStatus(UNLOCK_KIND[kind], typeId, tribe, player);
        return [`${kind}:${typeId}`, knowledgeStatusOf(content, status, progress)];
      };
      statuses = new Map(
        await Promise.all([
          ...content.buildings.map((b) => ask('building', b.typeId)),
          ...content.goods.map((g) => ask('good', g.typeId)),
          ...content.jobs.map((j) => ask('job', j.typeId)),
        ]),
      );
    },
  };
}
