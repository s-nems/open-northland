# Time action SFX to the authored atomicanimation sound events (not swing completion)

**Area:** audio (+ sim event emit) · **Origin:** construction-feedback round, 2026-07-14 · **Priority:** P2

Action sounds fire on `atomicCompleted` — the END of a swing. The builder's hammer knock therefore
trails the visual strike by ~1.1 s (swing 30 ticks, impact mid-clip), which players read as "no
hammer sound" (reported). The extracted `atomicAnimations` events carry the original's cue timing:
`viking_builder_build_house` has `{at: 4, type: 34, value: 1}` (and `{at: 1, type: 35, value: 1}`) —
`at` is the tick offset within the animation's transcribed length, and `type 34 value 1` plausibly
maps to `logicSoundType 1`, which is exactly the `Hammer Wood` static group. The chop/mining swings
carry similar events. Types 34/35 are captured in the IR but unread
(`packages/data/src/schema/actors/tribes.ts` AtomicEvent doc).

## Scope

- Verify the type-34/35 → sound mapping against more animations (cross-check each animation's event
  `value` with the sound group `logicSoundType` its action plainly uses; OpenVikings may name the
  event vocabulary).
- Emit a sim event at the authored offset (the `hitAt` combat mechanism generalized — scale `at` by
  the same factor the swing length was scaled by, e.g. the hammer's ×2 cadence) and bind it in the
  audio director alongside/instead of the `atomicCompleted` one-shots.
- Keep completion-fired sounds for atomics with no authored event.

## Verify

- Unit tests on the event-offset emission; human ear on `?scene=construction` (hammer knock lands on
  the visual strike) and the sandbox chop.
