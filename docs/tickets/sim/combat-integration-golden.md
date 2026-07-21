# Add a behavior-sensitive combat integration golden

**Area:** sim · **Priority:** P3

Combat has focused system tests and same-seed hashes, but the only scripted integration golden covers
the economy. The battle scene mainly checks crowd shape, so changes to attack cadence, projectile order,
armor asymmetry, or death events can pass without moving a durable trace.

## Scope

Add a small deterministic battle fixture that records its final state hash and a bounded trace of
attack/projectile/death events. Include one source-backed armor matchup from `weapons.ini`; keep visual
scene assertions out of the sim golden.

## Verify

The test is identical across repeated same-seed runs and fails when attack cadence or the chosen armor
mapping is deliberately perturbed. Run `npm test`, `npm run check`, and `npm run build`.

