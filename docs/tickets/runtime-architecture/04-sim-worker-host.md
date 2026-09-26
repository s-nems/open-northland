# Host the relayed session and the desktop build on the sim worker

**Area:** app, desktop · **Focus:** view/runtime · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md)

The `?map=` entry runs its `Simulation`, `LockstepDriver` and `FixedTimestep` in a worker
(`packages/app/src/session/worker/`, entry `entries/map/sim-worker.ts`) behind `SessionHost` and a
worker-side `SessionDriver`; the relayed entry and the desktop shell do not yet.

## Scope

- The `?relay=` entry and the menu's network game (`entries/relay.ts`, `entries/relay/network-game.ts`)
  still build their world through `inlineMapWorld`, because `RelayClient` is the session driver on the
  main thread and holds the sim (`OpenedWorld.sim`, `networkSaveSession`). Replace the seams that need
  the sim's identity so the relayed world boots through the worker too; the relay client itself moves
  into the worker in 05.
- The desktop build loads the worker under `app://` (`packages/desktop/src/protocol.ts`;
  `protocol-routing.ts` records a Pixi worker URL quirk there), and `npm run test:desktop` passes over
  it.
- `packages/app/AGENTS.md` still says the app runs the frame loop over the session driver and owns the
  live simulation: rewrite it so the worker host owns both and the app owns the mirror and the renderer.

## Verify

- A relayed room of two clients plays through the worker: `npm run test:content` with
  `relay-map-parity.test.ts` and the relay entry in a browser.
- The desktop build boots the worker under `app://`; save, relaunch and load keep the tick and hash.
- Closing numbers on the 00 checkpoint for the relayed session: frame p95, per-tick receive cost beside
  sim time, boot time and memory before and after.
- `npm test`, `npm run check`, `npm run build`.
