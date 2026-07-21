# Make a bound carrier service a blocked workshop first

**Area:** sim · **Priority:** P3

A carrier bound to a recipe workshop reaches `planWorkshopSupplier` only occasionally because general
porter work wins most replans: a measured bakery run reached its own supplier drive 73 times in 20,000
ticks and not once in the final 500. When the drive does run, it fills inputs before hauling a full
output shelf. Craftsmen currently mask most stalls by hauling their own output, but a workshop whose
craftsmen are absent or seated can remain blocked while its assigned carrier works elsewhere or makes
an input trip that cannot unblock production.

## Scope

- Instrument which drive claims the bound carrier before changing priority.
- When its own workshop has a shelf-blocking output, let the supplier drive win over general porter
  work and call the existing `shelfBlockedOutput`/`startOutputHaul` path before the input scan.
- Keep a carrier available to the wider settlement when its workshop has no blocking work. The
  priority is an approximation because trip scheduling is not decoded.

## Verify

- Planner test: a blocked workshop with no craftsman and an under-capacity input makes its bound
  carrier pick up output before fetching or taking a general haul.
- Re-run the measured bakery soak and report supplier-drive frequency and shelf levels.
- `npm test`, `npm run check`, and `npm run build`; existing goldens stay unchanged.
