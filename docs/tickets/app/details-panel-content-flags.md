# Replace hardcoded content slugs in the details panel model with content flags

**Area:** app (hud/details-panel), data · **Priority:** P3

The generic panel model special-cases content slugs, violating the "content is data" rule:

- `model/index.ts` sets `showDefense: catalog?.id === HEADQUARTERS_ID || category === 'tower'`
  with `HEADQUARTERS_ID = 'headquarters'`, and reads the flag through the viking fallback catalog
  while the rest of the branch reads the live def from `ctx`.
- `model/settler-work.ts` and `model/settler.ts` each independently compare a job's id to
  `'carrier'`.

With decoded content whose headquarters or carrier rows carry different ids, the defence section
and the carrier-specific behavior silently disappear, no error, no test failure.

## Scope

- Add `hasDefence` on the building content row and an `isCarrier` role flag on the job row (or
  reuse the sim's carrier-job derivation if one is exposed through readviews), defaulted in the
  committed fallback catalog; the panel model reads the flags and the slug comparisons are
  deleted.
- Follow the job-role seam the sim already uses for fighter/scout/hunter (`core/content-index/jobs.ts`
  derives the sets, `systems/readviews/jobs.ts` exposes the predicates) for the carrier flag; the
  building flag is independent.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local content exists.
A model unit test proving `showDefense` follows the flag, not the slug.
