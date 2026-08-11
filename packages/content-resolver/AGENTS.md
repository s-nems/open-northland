# Content resolver package contract

`packages/content-resolver` maps generated content onto the same public routes for its three hosts:
Vite in development, the Electron protocol handler, and the browser service worker. The root
[`AGENTS.md`](../../AGENTS.md) applies in full.

## Boundaries

- Route resolution stays host-neutral. Each host supplies a content root and a
  `@open-northland/vfs` `ReadableVfs`; that seam is this package's only dependency, and a second one
  needs a reason as good.
- Resolve files under the configured content root; reject traversal and do not expose arbitrary paths.
- Treat sidecars and request paths as untrusted input even though the pipeline emitted them. Narrow
  unknown JSON at the route boundary.
- Missing optional content degrades per route. Malformed authored content warns or fails explicitly;
  it must not become a plausible default roster or map entry.
- Wire payloads are plain serializable data and do not import app, sim, render, or Electron types.

## Verification

Cover route parity, root containment, malformed sidecars, and missing optional files with Node tests.
Changes to generated map or IR consumers also run `npm run test:content` when local content exists.
