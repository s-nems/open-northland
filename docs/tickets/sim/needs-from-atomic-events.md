# Drive need changes from atomic-animation events

**Area:** sim + pipeline · **Priority:** P2
**Needs user:** observe the original to pin the reserve span for each need channel.

Need drain and recovery use uniform fixed constants. The readable atomic-animation data instead
attaches signed deltas to clips: work drains energy and condition, food and candy restore different
amounts, candy also restores leisure, and sleep clips contain different numbers of condition pulses.
The current constants even invert the relative raw values for a civilist meal and sleep. Channel ids
are defined by `logicdefines.inc`; the unknown is the reserve span against which each channel's deltas
are measured.

## Scope

- Preserve every relevant event through the pipeline and expose a read view from channel to sim need.
- Observe enough clips in the original to pin each channel's span; record any idle baseline as an
  approximation if no readable source exists.
- Replace uniform per-tick drains and flat eat/sleep/pray/enjoy refills with clip-event changes while
  preserving deliberate job gates such as fighter enjoyment.
- Keep the sim deterministic and fixed-point. This intentionally changes needs goldens.

## Verify

Tests cover different food and sleep clips, positive and negative deltas, and candy's second channel.
Run `npm run test:pipeline`, `npm test`, `npm run check`, and `npm run build`; compare needs pacing in
the original and name intentional golden changes.
