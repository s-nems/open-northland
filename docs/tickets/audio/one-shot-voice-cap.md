# Cap concurrent one-shot voices before binding the per-node economy events

**Area:** audio · **Origin:** sim refactor-cleanup review battery (deferred), 2026-07-17 · **Priority:** P3
(latent — no player-visible defect today)

## Context

`playOneShot` (`packages/audio/src/web/engine/audio-engine.ts:130-152`) throttles only by a per-key
cooldown (`ONE_SHOT_COOLDOWN_S = 0.12`): a repeat of the *same* key inside the window is dropped. There is
no cap on how many *distinct* keys may sound in one frame, so concurrent voices are unbounded.

That is fine today only because the events that would fire en masse are unbound. `defaultBindings().byEvent`
(`packages/audio/src/data/bindings.ts:105-116`) has no entry for `berryForaged`, `resourceMined` or
`settlersMarried`, so `resolveBinding` drops them before any sound is made.

The exposure is real the moment one of them is bound: those events key per half-cell node
(`eventKey`, `packages/audio/src/data/director/events.ts`), which is the correct choice — two gatherers at
different bushes are genuinely different sounds. But N distinct on-screen nodes then means N uncapped
concurrent voices in a frame, and an economy map has many. The per-key cooldown cannot help, because the
keys differ.

## Scope

- Add a per-frame / per-group concurrent-voice cap to the one-shot path, so a burst degrades to a bounded
  number of voices instead of scaling with on-screen emitters.
- Decide the drop policy deliberately and state it in the doc comment: nearest-first (loudest wins) is the
  usual RTS answer; arbitrary truncation is not.
- The cap is a mixer concern, not a binding concern — do not solve it by leaving events unbound.

## Done when

- A synthetic frame with many distinct-node one-shots produces a bounded voice count, pinned by a test.
- `berryForaged` / `resourceMined` can be bound without a spam regression (binding them is NOT in scope
  here; this is the prerequisite).
