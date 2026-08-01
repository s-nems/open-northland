# Move AI workforce policy into the content profile

**Area:** sim, data · **Priority:** P3
**Blocked by:** [AI build-order profile](ai-build-order-content-profile.md)

AI staffing counts, collector targets, craft restrictions, and tower-coverage constants are authored
tables in sim code. Once seats select a validated AI profile, these policies should come from the same
profile instead of remaining one global default.

## Scope

- Add staffing, collector-target, craft-restriction, and tower-coverage policy to the AI profile.
- Resolve all four through the seat's selected profile with the current tables as fallback content.
- Keep runtime indexes memoized and free of id-specific branches.

## Verify

- A fixture profile changes each policy without changing the other three.
- The default profile preserves current commands and goldens.
- `npm test`, `npm run check`, and `npm run build`.
