# Establish the SaveGame migration seam with a committed v1 fixture

**Area:** sim · **Priority:** P1

Without a frozen fixture and a migration registry from day one, the first schema change silently
breaks every existing save. 0 A.D. demonstrates the failure: a first-class serializer but no
version handling, so saves break between releases.

## Scope

- Commit a v1 fixture: the exact save bytes of a small populated world. A golden test asserts the
  current parser and restore accept it, and that exporting the same constructed world reproduces
  the fixture byte for byte. Any schema change now fails this test until a fixture and migration
  are added.
- Migration registry keyed by `formatVersion`: a chain of pure vN to vN+1 payload transforms
  applied before validation. The registry starts empty; this ticket lands the seam and its policy,
  not a real migration. The single monotonic version is the applied-set record; a single-producer
  format needs no per-section versions.
- Policy tests: a future version is rejected with a specific "written by a newer build" error; a
  version below the oldest supported one is rejected, never silently parsed.
- Non-goals: no v2, no cross-version compatibility window beyond the registry mechanism.

## Verify

- Fixture golden test, future-version and too-old rejection tests.
- `npm test`, `npm run check`, `npm run build`.
