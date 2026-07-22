# Skip dish-goods cleanly on a checkout without generated content

**Area:** app (test) · **Priority:** P3

`packages/app/test/content/dish-goods.test.ts` gates on `describe.runIf(hasRealIr())` but calls
`rawIrUnderTest()` in the describe body. Vitest runs the describe callback at collection time even
when `runIf` is false, so on a checkout without `content/ir.json` (fresh clone or worktree) the file
fails with ENOENT instead of skipping, and plain `npm test` reports a failed suite. Every sibling in
`packages/app/test/content/` reads the IR inside `it` bodies; this is the only collection-time call.

## Scope

- Move the `rawIrUnderTest()` read (and the `typeOf`/`capacityOf` helpers that close over it) out of
  collection time, matching the sibling suites: inside the `it` bodies or a `beforeAll`.
- No behavior change when content exists.

## Verify

On a checkout without `content/`, `npm test` shows the suite skipped with no failed files. With
content present, `npm run test:content` stays green.
