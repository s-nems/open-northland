# Measure the relayed session in the network worker

**Area:** app · **Focus:** worker host, relay-client · **Priority:** P3

The relayed entry's `RelayClient`, relay link and adopted world run in the network worker
(`entries/relay/net-worker.ts`), and the main thread reads them through a mirror. Parity, the stall
property and the lobby, reconnect, resync and save paths are proven; what the move costs or saves on
a heavy world is not measured. Headless Chromium renders on a software GPU, so its frame timing
cannot answer it.

## Scope

- A relayed room of two clients on the six-AI `magiczny_las` world at tick 40000 (the save-53
  checkpoint `session-worker-checkpoint.test.ts` reads from `bench-out/`), on the desktop build or a
  hardware-accelerated browser, on an idle machine.
- Per client: frame p95, per-tick receive cost beside sim time (`perf().frame.receiveMs` and
  `simMs`), world boot time from start to the first delivered tick, and main-thread and worker memory.
- The same figures before the move: the inline relayed client at the parent of the commit
  "feat: Serve a relay connection and its adopted world from a network worker".

## Verify

- Before and after figures for both clients in the closing report, with the machine and the build
  named.
