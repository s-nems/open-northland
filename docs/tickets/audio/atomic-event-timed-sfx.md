# Drive the remaining action SFX from their authored PLAY_SOUND_FX cues

**Area:** audio (+ sim event emit) · **Origin:** construction-feedback round, 2026-07-14; updated
needs-gossip merge, 2026-07-19 · **Priority:** P2

The original keys nearly every action sound in the animation data itself: `event <frame> 34 <id>`
(`ATOMIC_EVENT_TYPE_PLAY_SOUND_FX`), where `<id>` is a `SoundFXStatic` group's `logicSoundType`
(verified: 1 = "Hammer Wood", 61/62 = the SocialTalk voice pair; ~50 distinct ids across the mod's
clips). Two consumers of that data exist today:

- The builder's hammer sounds on its cue frame via the `atomicSound` event + audio's hand-keyed
  `byAtomicSound` map (id → group chosen in code, not from the event's value).
- Gossip chat voices (`systems/social/gossip/`) ship the fully faithful shape: the sim emits
  `chatVoice { soundType }` at the clip's cue frame and audio resolves the group through
  `SoundIndex.groupsByLogicSoundType` — no hand binding.

The remaining action SFX (woodcutter chop, miner pick, …) still fire on `atomicCompleted` (swing END)
through hand `byAtomic` bindings, and the `atomicSound` emission is still gated to the `construct`
effect and carries no sound id.

## Scope

- Generalize the AtomicSystem's `atomicSound` emission: fire for ANY running atomic whose animation
  carries a type-34 event at the current frame, carrying that event's `value` as `soundType` (the
  `chatVoice` shape). Keep per-tick cost O(active atomics) (the frame resolves through the memoized
  `contentIndex` maps).
- Audio resolves `soundType` via `groupsByLogicSoundType` first; the `byAtomic`/`byAtomicSound` hand
  bindings become the fallback for clips without a cue, and entries the data now covers are deleted
  (so nothing double-fires at completion).
- `chatVoice` then folds into the generalized event (one shape, one emitter) — keep its fog gate.
- Mind repeats: a multi-swing harvest fires its cue once per swing — the engine's per-key debounce
  should keep bursts sane (verify with the woodcutter loop).
- Sandbox parity: the sandbox chop/mining animations (`atomic-animations.ts`) carry no events — add
  their transcribed `event <at> 34` (scaled by each clip's render cadence, like BUILD_HOUSE_STRIKE_FRAME)
  so `?scene=sandbox` sounds on-beat, not just real-map mode.

## Verify

- Unit: a fixture clip with `event <at> 34 <id>` fires the event at that frame with the id; audio
  resolves it to the group and positions it at the emitter; an uncued clip stays silent mid-swing.
- Human ear on `?scene=sandbox`: chop/hammer land on the visual strike, no doubled sounds from a
  binding + cue firing together.
