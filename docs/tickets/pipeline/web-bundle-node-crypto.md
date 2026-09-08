# Keep the browser pipeline bundle free of `node:crypto`

**Area:** pipeline, web · **Priority:** P1

`npm run web:site` fails. `packages/web/scripts/bundle.mjs` bundles the pipeline worker with esbuild at
`platform: 'browser'`, and `tools/asset-pipeline/src/stages/hypertext-pictures.ts` imports
`createHash` from `node:crypto`, which esbuild cannot resolve for that platform:

```
✘ [ERROR] Could not resolve "node:crypto"
    ../../tools/asset-pipeline/dist/stages/hypertext-pictures.js:1:27
```

The import arrived with `24ee50d4` and the gate has been red on `main` since. Every other stage keeps
to APIs both hosts have, which is why the worker bundled before.

## Scope

- Hash the picture bytes with something both hosts provide. `crypto.subtle.digest` is async and
  available in Node and the browser; a small synchronous non-cryptographic digest is also enough if
  the hash only names a cache entry rather than proving anything.
- No new dependency, and no Node-only branch inside a stage: the pipeline runs in both hosts by
  design.

## Verify

- `npm run web:site` builds.
- `npm run test:pipeline` against the owned copy still produces the same picture names.
