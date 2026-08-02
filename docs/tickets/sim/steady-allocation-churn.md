# Measure the remaining snapshot allocation floor on a late-game map

**Area:** sim · **Priority:** P3

Synthetic sampling attributes roughly 2 MiB of a 2.9 MiB per-tick allocation rate to snapshot cloning.
The late-game browser measurement predates the latest allocation cuts, so it no longer proves that a
wider clone cache is worth its mutation-coverage risk.

## Scope

- Re-measure `?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal` after a fixed warm-up and
  tick horizon.
- Record the heap range, collection cadence, snapshot construction share, serialized snapshot size,
  machine trust verdict, and final state hash. Treat a plain snapshot as structured-cloneable, not as
  zero-copy transferable data.
- Correct the snapshot API comments and clone test name/assertions that currently describe structured
  cloning as free transfer; this is documentation/test accuracy, not a worker implementation.
- Compare against the current synthetic proxy. Do not implement a clone cache in this ticket.
- File implementation work only if the current measurement still shows a material snapshot floor. A
  worker follow-up must define a packed typed-array/delta protocol and transfer ownership of its buffers;
  sending the current object graph through `postMessage` is not a zero-copy fix.

## Verify

- Take two interleaved runs on an idle machine and reject any run marked untrustworthy.
- A snapshot still survives `structuredClone`, and its documentation no longer claims ownership transfer.
- Run `npm run bench:map`, `npm test`, `npm run check`, and `npm run build`.
