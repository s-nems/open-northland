# Time the remaining action SFX to their authored PLAY_SOUND_FX frames

**Area:** audio (+ sim event emit) · **Origin:** construction-feedback round, 2026-07-14 · **Priority:** P2

The builder's hammer now sounds on its authored PLAY_SOUND_FX cue (`atomicSound` event, emitted at
`ATOMIC_EVENT_TYPE_PLAY_SOUND_FX = 34`; audio's `byAtomicSound` map — see `fix: Sound the builder's
hammer on its authored strike frame`). The mechanism is in place; the remaining action SFX still fire
on `atomicCompleted` (swing END) rather than their authored mid-swing frames:

- The woodcutter chop / miner still sound on completion (`byAtomic`). Their animations carry their own
  `event <at> 34` cues in the real IR — move them to `atomicSound` so the axe/pick land on the visual
  strike, the same way the hammer does.
- The `atomicSound` emission is currently gated to the `construct` effect in the AtomicSystem loop.
  Generalize it to any atomic whose animation carries a PLAY_SOUND_FX event, so a single path serves
  every action SFX. Keep it cheap — the per-tick cost must stay O(active atomics) (the frame resolves
  through the memoized `contentIndex` maps).
- The gossip talk/listen clips (atomics 14/15, `systems/social/gossip.ts`) carry SOCIALTALK voice cues
  in the real IR (`viking_civilist_talk` `event 0 34 61`, `viking_woman_talk` `event 0 34 62`,
  `logicdefines.inc` SOUND_FX_TYPE_SOCIALTALK_MALE/FEMALE 61/62) — wire them through the same
  generalized path (+ a `byAtomicSound` mapping onto the sex-matched voice pools) so chatting pairs
  audibly murmur, the original's settlement chatter.

## Scope

- Generalize the AtomicSystem's `atomicSound` emission beyond `construct` (any atomic with a
  PLAY_SOUND_FX frame); confirm walks/idles/harvest without the cue add no measurable per-tick cost.
- For each SFX moved to `atomicSound`, add its atomic id to audio's `byAtomicSound` and REMOVE it from
  `byAtomic` (so it never double-fires at completion), mirroring the hammer.
- Sandbox parity: the sandbox chop/mining animations (`atomic-animations.ts`) carry no events — add
  their transcribed `event <at> 34` (scaled by each clip's render cadence, like BUILD_HOUSE_STRIKE_FRAME)
  so `?scene=sandbox` sounds on-beat, not just real-map mode.
- Keep completion-fired sounds for atomics with no authored PLAY_SOUND_FX event.

## Verify

- Unit tests on the generalized event-offset emission (a cued atomic sounds mid-swing, an uncued one
  stays silent mid-swing); human ear on `?scene=sandbox` (chop lands on the visual strike).
