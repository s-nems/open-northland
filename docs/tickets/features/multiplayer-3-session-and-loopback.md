# Run every game through a session descriptor and a lockstep driver with a loopback transport

**Area:** app · **Focus:** view/runtime, entries/map · **Priority:** P2
**Blocked by:** [multiplayer-2-sim-lockstep-seams.md](multiplayer-2-sim-lockstep-seams.md)

A networked game needs one serializable description of what is being played and a loop that advances
the sim only through ticks whose inputs are complete. Today neither exists:

- The game setup is a URL. `packages/app/src/game/player-session.ts`, `session-rules.ts`, and
  `entries/main-menu/lobby/model.ts` turn the roster, colours, AI seats, fog, progression, and needs
  into `?map=` search params, and `entries/map.ts` parses them back. A server cannot broadcast a URL,
  and a save cannot carry one as its identity.
- `startFrameLoop` in `packages/app/src/view/runtime/frame-loop.ts` steps the sim from wall-clock
  time through `FixedTimestep`, and `control.speed` / `control.paused` are plain fields owned by the
  runtime. In a session, tempo and pause are decided by the server clock, and a tick may only run once
  its command frame has arrived.
- HUD commands go straight into `sim.enqueue` through `issueCommand` in `game-view.ts`. In a session
  they go to a transport that returns them stamped with a tick.

Single-player must go through the same path with an in-process transport, the way Factorio and
OpenTTD play locally against a built-in server. One loop, tested by every scene and every headless
scenario, instead of a network mode exercised only when two people meet.

## Scope

- A `GameSession` descriptor: seed, map id and map fingerprint (or scene id), roster with per-seat
  mode (human, ai, idle, closed), colours, teams or diplomacy rows, rule flags (fog, progression,
  needs), and the starting speed. The lobby produces it, the map entry builds the world from it, and
  the URL becomes one adapter that parses into and serializes from the descriptor. Existing URLs keep
  working and produce byte-identical worlds.
- A lockstep driver between the frame loop and the sim: it owns the session clock (speed, pause), asks
  a transport for the next authorized tick's command frame, enqueues those envelopes with their
  assigned tick and sequence, and steps the sim only through authorized ticks. `FixedTimestep` keeps
  producing the render alpha; the driver decides how many ticks may run this frame.
- A transport interface with one method to submit an envelope and one stream of tick frames, plus the
  loopback implementation: assigns each submitted envelope to the next tick with a delay of one, so
  single-player timing is exactly today's next-tick behavior.
- Tempo and pause become session clock operations routed through the driver; the tool panel, the
  system menu, and `?speed=` call the driver instead of writing the control fields.
- Non-goals: no WebSocket, no server, no lobby UI, no worker. The sixteen runtime modules that read
  the live `Simulation` keep doing so; in lockstep every client owns its sim.

## Verify

- For every registered scene and for `magiczny_las` with six AI seats, the state hash after N ticks
  through the loopback driver equals the hash on the current path, and the replay log carries the same
  `(applyTick, sequence)` pairs.
- A HUD command issued at tick T lands in the log at T + 1 through loopback.
- Pause and speed changes go through the driver and the perf overlay reports the requested speed.
- Descriptor round trip: URL to descriptor to URL is stable for every current parameter, and a
  descriptor serializes to plain JSON.
- `npm run check`, `npm run build`, `npm test`, `npm run test:content` where content exists, plus a
  browser pass over one scene and one map start.
