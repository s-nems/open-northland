# Vfs package contract

`packages/vfs` is the file-system seam the asset pipeline writes through. The root
[`AGENTS.md`](../../AGENTS.md) applies.

- Paths are `/`-separated; each adapter defines its root form (`node` takes native absolute paths,
  `memory` takes root-relative ones).
- The main entry stays platform-free. Node-only code lives under the `./node` subpath, the test
  adapter under `./memory`; never import those from shared logic.
- `ReadableVfs` is the read-only half of the interface. Take it wherever a consumer only reads, so a
  read-only adapter fits by type instead of rejecting at call time.
- Keep the interface minimal: a new method must have a caller and every adapter must implement it. A
  method one caller needs is that caller's job.
- Adapters must not diverge where a caller can see it: the same call answers the same way, and a
  refusal is reported rather than swallowed. `stat` is the exception that has to be total, returning
  `undefined` for anything it cannot address, because callers branch on it instead of guarding it.
- Adapter behavior is pinned by the shared contract suite in `test/adapters.test.ts`; every adapter
  joins it, the read-only ones through its read half.
