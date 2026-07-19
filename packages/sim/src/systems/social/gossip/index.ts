/**
 * GOSSIP — the company need's self-satisfying drive: settlers pair up and talk. The original's SOCIAL
 * bar has no building satisfier — it refills through social atomics, primarily the talk/monologuize/
 * listen trio (their animations fire `event <at> 3 <delta>` pulses — `atomicanimations.ini`; `enjoy`
 * and `make_love` also restore the channel, handled in the AtomicSystem). Soldiers/heroes cannot join
 * (`jobtypes.ini` soldier `forbidatomic 13/14/15`), while scouts inherit the civilist set and gossip
 * like anyone. Children are approximated out entirely: the data binds them only `listen` (no talk), so
 * rather than model one-sided listeners the candidate list drops `Age` holders. The mechanic's two
 * halves each have a module: `plan.ts` holds the planner rungs that START a chat
 * ({@link planGossipSeek}/{@link planGossipIdle}), `drive.ts` the {@link gossipSystem} that drives every
 * standing {@link import('../../../components/social.js').Chat} pair (walk together, alternate
 * talk/listen on adjacent cells, pulse the bar back down).
 */
export { CHAT_COOLDOWN_TICKS, gossipSystem, LISTEN_ATOMIC_ID, TALK_ATOMIC_ID } from './drive.js';
export { GossipCandidates, planGossipIdle, planGossipSeek } from './plan.js';
