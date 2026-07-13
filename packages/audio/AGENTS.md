# packages/audio — the sound sink

`@open-northland/audio` plays the decoded original sounds for what the player sees: positional action SFX,
terrain ambient beds, non-spatial life-event jingles, and sex/age-matched settler voice chatter. It
consumes the SAME read-only `snapshot()` + one-shot `SimEvent`s that `render` reads and **never feeds
anything back into the sim** — audio is a pure sink on the far side of the determinism boundary, so
floats, wall-clock time and randomness are fine here (and banned in `sim`). The root
[`AGENTS.md`](../../AGENTS.md) carries the project-wide rules; this file is the audio-local contract.

## The split (mirrors `render`'s data/gpu split)

- **`src/data/`** — the PURE decision layer: "what should be audible right now", unit-testable
  headless (no Web Audio, no DOM, no randomness — the engine picks the wav, the driver owns the clock).
- **`src/web/`** — the impure Web Audio sink. Its platform seams (`ContextFactory`, `FetchBytes`,
  `RandomFn` in `platform.ts`) are injectable, so even this layer is unit-tested without a browser
  (`test/helpers/fake-audio.ts`); production code passes nothing and gets the real browser behaviour.

## Package layout

- **`data/bank.ts`** — `buildSoundIndex`: the decoded `SoundBank` IR (schema:
  `packages/data/src/schema/audio/`) reshaped ONCE at load into per-frame `Map` lookups, including the
  terrain `typeId` → ambient-bed join the raw bank can't express.
- **`data/bindings.ts`** — the faithful event→sound map (which sim event triggers which decoded group),
  bound by the names + `MusicType` ids decoded from `soundfx.cif`; plus the `VIKING_VOICE_POOLS` /
  `vikingVoiceClass` sex/age voice classification. Bindings are DATA — a consumer overrides
  `defaultBindings`, not code.
- **`data/spatial.ts`** — pure spatial math: project an emitter through the SAME projections the
  renderer draws with, then cull/attenuate/pan. The "only what's on screen makes sound" contract:
  off-viewport → `null` (silent).
- **`data/director/`** — `directAudio`, the per-frame decision: `events.ts` (sim events → spatialised
  one-shots + jingles), `ambient.ts` (visible-terrain coverage → the loudest few looping beds, strided
  so a zoomed-out view stays bounded), `settlers.ts` (on-screen chatter candidates), `snapshot.ts` (the
  ONE untyped-snapshot `Position` reader).
- **`web/sound-driver.ts`** — `SoundDriver`, the one app-facing façade: `update()` once per rendered
  frame with that frame's events + snapshot + camera (accumulate events across ALL sim steps in the
  frame, not just the last tick).
- **`web/engine/`** — `WebAudioEngine` playback: `ambient-mixer.ts` (bed fade in/out/between gains —
  ramps ride the audio clock `ctx.currentTime`, never `Date.now`), `sample-cache.ts` (fetch+decode each
  wav once; failures memoised so a missing file never spams the network).
- **`web/chatter.ts`** — the stochastic voice emitter: injected randomness picks who speaks; the pure
  candidate list (`onScreenSettlers`) decides who COULD. `web/prune.ts` bounds the cooldown maps.

## Invariants

- **Sink only.** Read `snapshot()` and `ctx.events`; never mutate sim state, never register a callback
  into the sim. The driver's inputs are plain data handed in by the app each frame.
- **Screen-bounded.** Spatial sounds are viewport-culled; the ambient scan strides the visible tile
  band. Per-frame audio cost scales with the screen, never the whole map (root rule 6).
- **Keep the pure/impure line.** New "what plays" policy goes in `data/` (headless-testable); only
  playback mechanics go in `web/`, behind the injectable seams. Randomness enters via `RandomFn` only.
- **Degrade to silence.** A checkout without decoded `content/` (no sound bank) builds no driver and
  plays nothing — it must never throw or block the app booting.
- **Tuning constants are named + sourced.** Gains, fades, rates and cooldowns are exported documented
  constants (source basis: decoded `soundfx.cif` records or a named approximation), never inline magic.

## How to verify

1. `npm test` covers the pure director/spatial/bindings decisions and, via the fake-audio seams, the
   engine/driver/chatter mechanics.
2. **Actual sound needs human ears** (root "Verification" point 5 — an agent cannot self-judge audio).
   The human-oracle seams: `?sounds` — the verification gallery (`app/src/entries/sound.ts`), the audio
   twin of `?anim`; and `?scene=sandbox` for action→sound in play. Live/scene audio starts
   **default-muted** behind the bottom-centre sound toggle (the click satisfies the browser autoplay
   gesture); `?sound=off` (singular — distinct from `?sounds`) skips building the pipeline entirely.
