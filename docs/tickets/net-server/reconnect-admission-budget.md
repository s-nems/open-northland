# Bound relay admission across reconnects

**Area:** net-server · **Priority:** P3

`host/ws-host.ts` constructs a new `SocketBudget` and `RecoveryBudget` on every WebSocket connection.
A reconnect therefore receives the full burst again. The simultaneous connection cap does not bound
connection churn, so clients can repeatedly reclaim burst capacity. `docs/NETWORK.md` currently
delegates per-address and upgrade controls to the deployment proxy.

## Scope

Add a configurable process-wide upgrade/admission rate budget before allocating relay client state,
independent of client-provided identity tokens. Reject excess upgrades with bounded HTTP responses
and keep already admitted sessions running. Document sizing for legitimate reconnect bursts and
the continuing requirement for proxy per-address limits. Do not trust arbitrary forwarded headers
or introduce an unbounded address/token registry. Coordinate with shared traffic budgets without
duplicating their byte accounting.

## Verify

With a deterministic clock, repeatedly connect and disconnect within one admission window and
confirm the budget survives socket replacement, refills over time and permits ordinary reconnects.
Verify the real WebSocket upgrade rejection path and continued service to an established client.
