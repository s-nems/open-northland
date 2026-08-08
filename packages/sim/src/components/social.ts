import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A gossip chat in progress: the pair walks together, then alternates the paired talk/listen atomics
 * (14/15) on adjacent cells, each animation pulse restoring `enjoyment`. Mirrored on both partners and
 * driven from the `seeker` half - the settler whose company need started the chat. `speaks` marks the half
 * that talks next round and flips each round, so both bodies animate over a long chat.
 */
export const Chat = defineComponent<{
  partner: Entity;
  seeker: boolean;
  talking: boolean;
  speaks: boolean;
}>('Chat');

/**
 * A short post-chat breather stamped on both halves when a chat ends: until tick `until` the settler
 * neither starts a chat nor may be pulled into one, so a freed settler beside an idle neighbour is not
 * re-grabbed in the very planner pass that freed it. The stamp expires in place, overwritten by the next
 * chat rather than removed.
 */
export const ChatCooldown = defineComponent<{ until: number }>('ChatCooldown');
