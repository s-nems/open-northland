# Move AI workforce policy into the content profile

**Area:** sim, data · **Priority:** P3
**Blocked by:** [AI build-order profile](ai-build-order-content-profile.md)

AI staffing counts, builder cap, collector targets, craft restrictions, the soldiers' outfit goods, and
tower-coverage constants are authored tables in sim code. Once seats select a validated AI profile, these policies should come
from the same profile instead of remaining one global default.

## Scope

- Add staffing, builder-cap, collector-target, craft-restriction, outfit, and tower-coverage policy to
  the AI profile.
- Move the current tables into the committed fallback catalog and resolve all six policies through the
  seat's selected profile.
- Keep runtime indexes memoized and free of id-specific branches.

## Verify

- A fixture profile changes each policy without changing the other five.
- The default profile preserves current commands and goldens.
- `npm test`, `npm run check`, and `npm run build`.
