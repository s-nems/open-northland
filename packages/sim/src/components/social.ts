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

/**
 * A short post-chat breather stamped on both halves when a chat ends: until tick `until` the settler
 * neither starts a chat nor may be pulled into one. Without it a freed settler standing beside an idle
 * neighbour is re-grabbed in the very planner pass that freed it — its own work rungs never run (a farm
 * crew could capture its farmer forever). The stamp is left to expire in place (overwritten by the next
 * chat), never removed.
 */
export const ChatCooldown = defineComponent<{ until: number }>('ChatCooldown');
