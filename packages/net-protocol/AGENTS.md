# Net-protocol package contract

`packages/net-protocol` is the lockstep wire protocol: the message catalogue, the limits, the parser
for each direction, and the client-side transport that turns relay frames into the session driver's
input. The root [`AGENTS.md`](../../AGENTS.md) applies in full; the contract itself is
[`docs/NETWORK.md`](../../docs/NETWORK.md).

## Boundary

- No runtime dependency at all. Imports from `@open-northland/lockstep` and `@open-northland/sim` are
  types only, so the relay server can load this package without loading the sim.
- The session descriptor and the command payload are owned elsewhere. The protocol carries them as
  opaque JSON: `parseServerMessage` takes the descriptor's parser as an argument, and
  `RelayTransport` takes the sim's envelope parser. What this package validates is the wire's own
  shape and the authority half of an envelope.
- Every string that reaches another person is one printable line with a length cap.

## Changing the protocol

A change a client of the current `PROTOCOL_VERSION` could not parse bumps the version. Add a message
to the catalogue, to both parsers' kind lists, and to `docs/NETWORK.md` in one commit.
