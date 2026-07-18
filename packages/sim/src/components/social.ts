import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A gossip chat in progress: the pair walks together, then alternates the paired talk/listen atomics
 * (14/15) on adjacent cells, each animation pulse restoring `enjoyment` (the company need). Both partners
 * carry the mirrored component; the GossipSystem drives the pair from its `seeker` half — the settler
 * whose company need started the chat — and ends it once that half's need is spent. `talking` flips while
 * a talk/listen round is in flight; `speaks` is which role this half plays next round (the pair
 * alternates, so both bodies animate over a long chat).
 */
export const Chat = defineComponent<{
  partner: Entity;
  seeker: boolean;
  talking: boolean;
  speaks: boolean;
}>('Chat');
