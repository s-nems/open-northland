# Import authored fortification ownership and palette

**Area:** pipeline, data, app, sim, render · **Priority:** P2

The map stage drops the `lmlp` per-node owner and palette lane for pre-placed stockades and gates. Maps
that author player-owned fortifications therefore import them unowned. This is not cosmetic: combat
intentionally excludes ownerless buildings from siege targets, so an enemy cannot attack a wall whose
authored owner was lost during import.

## Scope

- Confirm the `lmlp` byte layout against the owned corpus, then decode its owner and palette fields.
- Join the decoded values onto imported fortifications and stamp a valid player `Owner` without making
  neutral scenario fixtures attackable by default.
- Preserve the authored palette through the existing map-placement/render binding rather than deriving
  it from the local player.
- Leave unrelated render-only `emmi` and `emvc` lanes unimported.

## Verify

Synthetic chunk fixtures pin owner and palette decoding. A real-content join test proves an authored
player-owned wall imports with that owner and is a legal target for an enemy but not its owner. Run
`npm run test:pipeline`, `npm run test:content` when local content exists, `npm test`, `npm run check`,
and `npm run build`.
