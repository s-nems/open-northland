# Decide whether band transpose applies to rendered notes

**Area:** audio · **Priority:** P2

Band instruments in the owned corpus author `DMUS_IO_INSTRUMENT.nTranspose` values of -12, +12,
and +24 semitones (for example `Mission_AddOn_Franken2_Standard`, `Attack_Byzanz`,
`Mission_Franken2_Wealthy`, `Theme_Franken_Friendly`). The performance interpreter ignores the
field, matching the renderer the current sound was validated against. Whether the retail engine
applies it is unverified: the recording-based validation used octave-invariant chroma, which
cannot see a one-octave shift on a single instrument.

## Scope

- Establish retail behavior from allowed sources: targeted listening against an in-game recording
  (does the transposed instrument sound an octave apart from our render?), or documented dmband
  semantics.
- If transpose is real, apply it when scheduling pattern and sequence notes, and re-render.
- If retail ignores it too, record that finding here and close.

## Verify

- A synthetic segment test pins the chosen semantics.
- Human listening on one affected track decides fidelity.
