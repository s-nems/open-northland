# Remove the unused standalone CPalette codec

**Area:** pipeline · **Priority:** P3

`decoders/palette.ts` implements and tests the standalone `CPalette` storable, but no pipeline stage or
other decoder imports it. Live palette paths use PCX trailers and player-palette data. No scheduled
`.hlt` or standalone-palette consumer justifies keeping a speculative codec.

## Scope

Remove the codec, its isolated tests, and exports. Keep shared palette/image helpers that have live
callers. If a future stage needs the format, recover the proven implementation from Git with a concrete
consumer.

## Verify

`npm test`, `npm run check`, and `npm run build` pass; no source import references the deleted module.
