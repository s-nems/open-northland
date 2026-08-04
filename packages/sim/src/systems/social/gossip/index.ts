/**
 * Gossip, the company need's self-satisfying drive: settlers pair up and talk. The original's SOCIAL bar
 * has no building satisfier and refills through social atomics, primarily the talk/monologuize/listen trio
 * whose animations fire `event <at> 3 <delta>` pulses (`atomicanimations.ini`). Soldiers and heroes cannot
 * join (`jobtypes.ini` soldier `forbidatomic 13/14/15`), while scouts inherit the civilist set.
 * Approximation: the data binds children only `listen`, so the candidate list drops `Age` holders instead
 * of modelling one-sided listeners.
 */
export { CHAT_COOLDOWN_TICKS, gossipSystem, LISTEN_ATOMIC_ID, TALK_ATOMIC_ID } from './drive.js';
export { GossipCandidates, planGossipIdle, planGossipSeek } from './plan.js';
