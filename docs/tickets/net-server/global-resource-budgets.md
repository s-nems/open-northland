# Bound aggregate relay memory and traffic

**Area:** net-server · **Priority:** P3

`host/socket-budget.ts` caps traffic and output queues per connection, while
`relay/catch-up.ts` caps retained history per room. These limits multiply with the configured
connection and room counts. There is no shared budget for retained snapshots, history and output
queues, or aggregate traffic. One process can exhaust its container allowance and drop unrelated
matches despite every connection staying within its individual budget.

## Scope

Add configurable process-wide budgets for retained room data, queued output and ingress/egress
traffic, with explicit accounting for broadcast fan-out. Refuse expensive work before retaining or
queuing it and release reservations on replacement, departure, room expiry and transport failure.
Keep accounting bounded and avoid starving healthy rooms when another client exhausts capacity.
Document the distinction between accounted bytes and actual process RSS; retain deployment-level
memory and CPU limits as the final boundary.

## Verify

Exercise several rooms and connections with small shared limits: each individual budget permits the
work, but the aggregate cap refuses it. Verify accounting recovery after disconnects, snapshot
replacement and room retirement, and continued service to an unaffected room. Measure RSS and
throughput under a bounded local workload; never run a flood against a public relay.
