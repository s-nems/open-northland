# Keep the app shell out of the sim bundle

**Area:** app · **Focus:** entries · **Priority:** P3

`main.ts` now loads one entry module per URL mode, so the galleries no longer ship on a menu boot. What
every mode still pays before the URL is read is the shell's own static closure: 155.5 kB gzip, of which
133.4 kB is one chunk holding `@open-northland/sim`, `zod`, and `@open-northland/data`.

`main.ts` imports the `diag/index.js` barrel, which re-exports `bundle.ts` → `session.ts` →
`import { HashTrace } from '@open-northland/sim'`. `frame-stats.ts` pulls the same package in for
`TICKS_PER_SECOND`. Both are value imports, so all of sim lands in the first download even for
`?icons`. Stubbing the two edges measured the shell at 25.5 kB gzip.

Route totals do not change, since a playable mode needs sim either way. What improves is how soon the
boot progress card and the crash banner can paint on a cold connection.

## Scope

- Break both value edges without moving hash tracing or frame statistics out of `diag/`. `hashTraceFor`
  has two callers (`entries/map.ts`, `entries/scene.ts`), both of which already own a sim; either they
  construct the trace, or `sim` grows a side-effect-free subpath export for the constants.
- Keep `installCrashCapture` and `logBootHeader` behaving as they do now, including the diagnostics
  bundle a crash offers to download.
- Do not add manual chunk groups. Forcing `sim`, `render`, `data`, and `zod` into named chunks was
  measured and made every mode worse (shell 155.5 → 329.0 kB gzip, menu 341.4 → 382.3 kB).

## Verify

- The size table `npm run build` prints shows a shell row well under 155.5 kB gzip, route rows unchanged.
- `npm test` and `npm run check`.
- Boot `?icons` with the network cache disabled and confirm no sim chunk is requested.
