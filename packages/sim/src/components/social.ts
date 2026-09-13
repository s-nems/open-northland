import { defineComponent, type Entity, type World } from '../ecs/world.js';
import { CurrentAtomic } from './settler.js';

/**
 * A gossip chat in progress: the pair walks together, then alternates the paired talk/listen atomics
 * (14/15) on adjacent cells, each animation pulse restoring `enjoyment`. Mirrored on both partners and
 * driven from the `seeker` half - the settler whose company need started the chat. `speaks` marks the half
 * that talks next round and flips each round, so both bodies animate over a long chat. A `pastime` chat is
 * idle chatter, which yields to work the moment a drive finds either half some; a `company` chat holds
 * both halves, since the seeker left its work for it or was ordered to talk.
 */
export const Chat = defineComponent<{
  partner: Entity;
  seeker: boolean;
  talking: boolean;
  speaks: boolean;
  kind: ChatKind;
}>('Chat', 'settlers');

export type ChatKind = 'pastime' | 'company';

export function inPastimeChat(world: World, e: Entity): boolean {
  return world.tryGet(e, Chat)?.kind === 'pastime';
}

export function chatHoldsSettler(world: World, e: Entity): boolean {
  return world.tryGet(e, Chat)?.kind === 'company';
}

/** The paired talk/listen atomic ids - `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_TALK = 14` /
 *  `LISTEN = 15`, bound per tribe in `tribetypes.ini` (`setatomic 5/6 14 "..._talk"`, `... 15 "..._listen"`). */
export const TALK_ATOMIC_ID = 14;
export const LISTEN_ATOMIC_ID = 15;

/** Whether `e` is currently playing its half of a chat round (a talk or listen atomic in flight). */
export function chatAtomicRunning(world: World, e: Entity): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  return atomic !== undefined && (atomic.atomicId === TALK_ATOMIC_ID || atomic.atomicId === LISTEN_ATOMIC_ID);
}

/**
 * A short post-chat breather stamped on both halves when a chat ends: until tick `until` the settler
 * neither starts a chat nor may be pulled into one, so a freed settler beside an idle neighbour is not
 * re-grabbed in the very planner pass that freed it. The stamp expires in place, overwritten by the next
 * chat rather than removed.
 */
export const ChatCooldown = defineComponent<{ until: number }>('ChatCooldown', 'settlers');
