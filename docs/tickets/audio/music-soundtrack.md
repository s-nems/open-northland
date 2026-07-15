# Add a music layer: offline .sgt/.dls transcode path + a music channel

**Area:** audio (+ offline tooling) · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P2

The game is silent of music. A local inventory found **49+ `.sgt`/`.dls` DirectMusic
segments/instruments** (Windows-only format) with the stated plan "transcode offline to ogg; do not
depend on DirectMusic". `packages/audio` handles positional SFX + ambient terrain beds + life-event
jingles + settler voice only (`packages/audio/src/index.ts` module doc, verified 2026-07-13) — no
music channel exists.

**Legal guardrail (`docs/LEGAL.md`):** transcoded music is copyrighted original content — the
transcode is an offline tool whose *output stays in the gitignored `content/` tree* like every other
decoded asset; never commit rendered audio or the originals.

**Investigate first — the transcode path is unknown.** `.sgt` (DirectMusic segment) + `.dls`
(instrument bank) need a renderer; candidates to evaluate: a DAW/fluidsynth-style route if segments
reduce to MIDI + DLS soundfont (there are `.sgt`→MIDI extractors in the wild; DLS→SF2 conversion is
well-trodden), Wine + DirectMusic capture as a fallback, or an existing open DirectMusic
implementation. Inspect readable configuration and observe the running original to establish how
segments are selected and looped. Which track plays
when (per-map? mood/combat-driven? shuffled?) is an investigate item; if no evidence is found, a
named approximation (simple per-map or shuffled playlist) is acceptable.

## Scope

1. Investigate + pick the transcode route; implement it as an offline step (pipeline stage or a
   documented one-shot script under `tools/`), emitting `content/music/*.ogg` + a small manifest.
   If the route turns out to be genuinely hard (DirectMusic runtime behavior), the legitimate
   deliverable is the investigation's findings + a sharpened follow-up ticket.
2. A music channel in `@open-northland/audio`: non-spatial looping/crossfading track playback beside the
   existing SFX/ambient/jingle/voice split, honoring the existing default-muted / sound-toggle
   gesture seam, with track selection per the evidence found (or the named approximation).
3. Keep the pure decision layer headless-testable like the rest of the package (track-selection
   logic separate from Web Audio playback).

## Verify

- Offline tool run against the owned game copy produces playable oggs (spot-check locally; nothing
  committed).
- Headless test for the selection/crossfade decision layer on synthetic manifests.
- In the browser: music plays after the sound-toggle gesture, loops/transitions sanely — **human
  ears sign-off**.
- `npm test`, `npm run check`, `npm run build`.
