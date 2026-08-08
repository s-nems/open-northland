# Validate imported command payload fields

**Area:** sim · **Focus:** core/commands · **Priority:** P3

`parseCommandEnvelope` validates the envelope contract - version, origin, seat id, and whether that
origin may issue the command kind - but casts the payload straight to `Command` after reading only
`kind`. A hand-edited bug-report log carrying `{"kind":"placeBuilding","x":"a","y":"b"}` therefore
passes import validation and reaches the handler, which mints a `Position` from those values and
writes non-numeric state the hash then walks. The world-aware authority gate does not help: it checks
who may act, not whether a field holds the primitive its handler indexes on.

## Scope

- Give each command kind a field contract the parser checks: required fields present, each of the
  declared primitive type, numbers finite, entity refs and content ids integers, arrays homogeneous.
  Derive it from one table so a new command kind cannot be added without its contract, the way
  `COMMAND_ISSUER` already forces the issuer split to stay complete.
- Reject with the same readable `at`-prefixed message shape the envelope checks already produce.
- Do not widen this into runtime validation of internally-constructed commands: typed producers are
  already held to the contract at compile time, and the queue must stay cheap per enqueue.

## Verify

Tests cover a type-confused payload per field shape (string where a coordinate belongs, fractional
entity ref, non-finite number, wrong array element type) failing with a readable error, and a valid
imported log still replaying to its recorded hash. The randomized stream in
`packages/sim/test/core/fuzz-determinism.test.ts` is all trusted-origin today, so it never exercises
the seat admission path; routing its seat-issuable kinds through `playerCommand` would fuzz both this
validation and the gate's rejection branch in the same pass. Run `npm test`, `npm run check`, and
`npm run build`.
