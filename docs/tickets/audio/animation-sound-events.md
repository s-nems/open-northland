# Drive action SFX from the animations' authored PLAY_SOUND_FX values

**Area:** audio/sim · **Origin:** needs-gossip slice (chat voices), 2026-07-19 · **Priority:** P3

The original keys nearly every action sound in the animation data itself: `event <frame> 34 <id>` in
`atomicanimations.ini`, where `<id>` is a `SoundFXStatic` group's `logicSoundType` (verified: value 1 =
"Hammer Wood", 61/62 = the SocialTalk voice pair; ~50 distinct ids appear across the mod's clips). The
gossip chat voices already use this faithfully: the sim emits `chatVoice { soundType }` at the clip's
event frame and audio resolves the group via `SoundIndex.groupsByLogicSoundType` — no hand binding.

Everything else still uses hand approximations: `byAtomic` / `byAtomicSound` bindings the app wires by
atomic id (chop → "Woodcutter Axe", build → "Hammer Wood"), and the sim's `atomicSound` event fires
only for `construct` and carries no sound id.

## Scope

- Generalize the sim's `atomicSound` emission: fire for ANY running atomic whose animation carries a
  type-34 event at the current frame, carrying that event's `value` as `soundType` (the `chatVoice`
  shape). Keep per-tick cost bounded by active atomics (the existing memoized content lookups).
- Audio resolves `soundType` via `groupsByLogicSoundType` first; the `byAtomic`/`byAtomicSound` hand
  bindings become the fallback for clips without a cue, and entries the data now covers are deleted.
- Mind repeats: a multi-swing harvest fires its cue once per swing — the engine's per-key debounce
  should keep bursts sane (verify with the woodcutter loop).
- `chatVoice` can then fold into the generalized event (one shape, one emitter) — keep the fog gate.

## Verify

- Unit: a fixture clip with `event <at> 34 <id>` fires the event at that frame with the id; audio
  resolves it to the group and positions it at the emitter.
- `?scene=sandbox` by ear: hammer/chop/saw sounds still land on the visual strike, no doubled sounds
  from a binding + cue firing together.
