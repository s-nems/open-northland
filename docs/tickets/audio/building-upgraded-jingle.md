# Audio cue for a completed building upgrade

**Area:** audio · **Origin:** building-upgrades branch, 2026-07-17 · **Priority:** P3

A finished from-scratch construction plays the house-built jingle (`packages/audio/src/data/bindings.ts`
binds `buildingFinished → JINGLE_HOUSE_BUILT`), but a completed upgrade emits `buildingUpgraded`
instead — which has no audio binding, so an upgrade completes silently. Bind `buildingUpgraded` to a
jingle (the same house-built jingle is the obvious candidate) and add the event to the sound
gallery's event list (`packages/app/src/entries/sound.ts`) with its i18n label rows
(`en-surfaces`/`pl-surfaces`, new strings in English). Source basis: whether the original plays the
same or a distinct cue on an upgrade is unobserved — listen in the running original first if
convenient; otherwise name the reuse as an approximation. Verify by ear via `?sounds` (human).

While binding, note `cancelUpgrade` currently emits NO event (unlike every sibling state transition),
so a cancel can never get a cue or renderer reaction — add an `upgradeCancelled` sim event in the same
change if the cancel should be audible.
