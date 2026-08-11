# Settle the three open music-render fidelity questions

**Area:** pipeline · **Priority:** P3

Three measured findings on the rendered soundtrack, all still open. They share one verification path
(re-render the corpus and compare against an in-game recording of the owned copy), so they are one
task rather than three.

## Scope

**1. The trim uses a different clock than the events.** `renderMusicStage`
(`tools/asset-pipeline/src/stages/music/index.ts`) trims to `Math.round(totalS * SAMPLE_RATE)`, where
`totalS` comes from `musicTimeToSeconds` integrating the tempo map in doubles. The interpreter stamps
events from `interpret.ts`, which truncates fractional ticks once per render block, so the performance
runs long. Measured across all 64 segments: every file is cut 13.5 ms to 95.2 ms short of the pass it
claims to be, always short, scaling with length and tempo. Inaudible today because playback fades the
last 4 s, but a published loop point would land up to 95 ms early - a 32nd note at 120 bpm. Fix by
stamping the segment-end frame into `SegmentEvents` and trimming on that.

**2. The reverb is much darker than flat.** `DAMPING = 0.95` in `stages/music/reverb.ts` stands in for
an unauthored `fHighFreqRTRatio`. Measured on the wet-only impulse response at the authored
`-6.72 dB / 2000 ms`, octave gains span 4.94 dB, and above 2 kHz the tail is gone within ~150 ms while
below 200 Hz it runs the full RT60. The DMO default the field carries is 0.001, which would be darker
still. The comment now states this honestly, but nobody has judged it against the original.
`test/music-reverb.test.ts` gates dry+wet energy, where the dry dominates, so it cannot see the tilt.

**3. Track loudness spans 15.6 dB RMS**, from -31.74 dBFS (`mission_addon_nordland_standard`) to
-16.17 (`mission_arabs2_standard`). Preserving authored relative level is deliberate
(`MASTER_GAIN` is uniform), but a 15 dB jump between two maps is a listening decision.

Note for whoever takes this: `MASTER_GAIN` is not spare headroom. 12 of 64 segments peak above full
scale before it, and the published worst case is -0.62 dBFS, so any level-raising change here lands
on 0 dBFS.

## Verify

- Re-render the corpus and re-measure the per-segment trim delta against the interpreter's own end
  frame; it should reach zero.
- Human A/B of one affected track against an in-game recording of the same segment, listening for the
  reverb's darkness and for whether the loudness spread reads as authored or as a bug.
