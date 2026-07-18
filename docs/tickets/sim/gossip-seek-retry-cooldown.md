# Pace the gossip partner search when no partner exists

**Area:** sim · **Origin:** needs-gossip slice review, 2026-07-18 · **Priority:** P3

A settler over the chat-seek threshold with no reachable partner re-runs its two ring searches
(`planGossipSeek`, `systems/social/gossip.ts` — idle pass + grab pass, radius 32 nodes ≈ ~2k node
probes each) every planner tick until a partner frees up. (The idle-chat rung is no longer the
concern: it rings only the adjacent nodes — ring ≤ 2, ~12 probes — per idle settler per tick.)
Bounded, but at RTS scale (hundreds of simultaneously lonely settlers in a soldier-heavy or
partner-starved settlement) that is a few hundred thousand bucket probes per tick of provably-null
work.

## Scope

- Add a retry cooldown for a FAILED partner search, mirroring the stranded-walk pacing
  (`replan.ts` `STRANDED_RETRY_TICKS`): a settler whose search found nobody skips the gossip rungs
  for a few seconds instead of re-ringing every tick. Component or per-settler tick stamp — keep it
  hashed state or derive it deterministically; no hidden caches without `verifyCaches` coverage.
- Keep the pick canonical (the cooldown must only elide provably-null searches, never change a
  winner) so goldens stay byte-identical for worlds where a partner exists.
- `npm run bench:sim` before/after with a lonely-crowd population to show the probe count drops.

## Verify

- Unit test: a settler with no eligible partner searches once, then not again until the cooldown
  elapses; a partner appearing after the cooldown is still found and chatted with.
