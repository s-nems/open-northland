# Vfs package contract

`packages/vfs` is the file-system seam the asset pipeline, content routes, and installers share so
one conversion codebase runs over Node and over browser storage. The root
[`AGENTS.md`](../../AGENTS.md) applies.

- Paths are `/`-separated; each adapter defines its root form (`node` takes native absolute paths,
  the browser adapters take root-relative ones).
- The main entry stays platform-free. Node-only code lives under the `./node` subpath, browser-only
  code under `./opfs`; never import either from shared logic.
- Keep the interface minimal: a new method must have two real platform implementations and a caller.
- Adapter behavior is pinned by the shared contract suite in `test/adapters.test.ts`; every adapter
  joins it, the OPFS one through the faked file-system handles in `test/support/fake-opfs.ts`.
