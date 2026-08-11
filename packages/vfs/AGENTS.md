# Vfs package contract

`packages/vfs` is the file-system seam the asset pipeline, content routes, and installers share so
one conversion codebase runs over Node and over browser storage. The root
[`AGENTS.md`](../../AGENTS.md) applies.

- Paths are `/`-separated; each adapter defines its root form (`node` takes native absolute paths,
  the browser adapters take root-relative ones).
- The main entry stays platform-free. Node-only code lives under the `./node` subpath, browser-only
  code under `./opfs`, the test adapter under `./memory`; never import those from shared logic.
- `ReadableVfs` is the whole interface a picked game folder can satisfy. Take it wherever a consumer
  only reads, so a read-only adapter fits by type instead of rejecting at call time.
- Keep the interface minimal: a new method must have two real platform implementations and a caller.
  A method one caller needs is that caller's job, and a method the browser can only emulate by
  copying a whole tree belongs nowhere near this seam.
- Adapters must not diverge where a caller can see it: the same call answers the same way, and a
  refusal is reported rather than swallowed. `stat` is the exception that has to be total, returning
  `undefined` for anything it cannot address, because callers branch on it instead of guarding it.
- Adapter behavior is pinned by the shared contract suite in `test/adapters.test.ts`; every adapter
  joins it, the read-only ones through its read half, the OPFS one through the faked file-system
  handles in `test/support/fake-opfs.ts`.
