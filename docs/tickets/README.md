# Work tracker

Each Markdown file in this directory is one open task. Git history is the archive, so completed
tickets are deleted instead of moved to a `done` folder.

Use `features/` for player-visible slices. Use area folders such as `sim/`, `render/`, `app/`,
`pipeline/`, and `tooling/` for technical work owned by that area.

## Ticket quality

A ticket must be:

- small enough for one focused worktree session, or split into ordered dependencies;
- understandable without the conversation that discovered it;
- verified against current code before filing and again before implementation;
- concrete about scope and checks;
- explicit about source evidence or an investigate-first step for mechanics, formats, and visuals;
- different from every existing ticket.

Do not file style preferences, speculative abstractions, or every minor observation from a review.
Tracker entries should represent work valuable enough to schedule. Group findings that share one
cause and one verification path.

## Metadata

Every ticket has an area and priority near the top:

- `P1`: blocks a playable or correct core path;
- `P2`: clear player value, correctness, or measured performance work;
- `P3`: polish, test hardening, maintenance, or bounded research.

Use `Needs user` when execution requires a live choice or human eyes/ears before completion. Final
visual sign-off alone does not make a ticket non-autonomous.

Use `Blocked by` only for an existing prerequisite ticket. Link to the file with a relative Markdown
link or a repository path. Remove the dependency as soon as its prerequisite is complete.

## Lifecycle

- Re-check the cited code and evidence before starting.
- Delete the ticket in the commit that completes it.
- If only part is complete, rewrite the ticket to exactly the remaining work.
- If research proves the premise wrong, correct or delete the ticket instead of preserving the stale
  claim.
- Dedupe before filing related follow-up work.

When recommending the next ticket, check active worktrees and branches, exclude `Needs user` tasks
from autonomous picks, then prefer the highest priority item with a clear dependency chain.

## Template

```markdown
# <imperative title>

**Area:** <package(s)> · **Priority:** <P1|P2|P3>
**Needs user:** <only when needed, with the required decision>
**Blocked by:** [<ticket>](<relative-or-repository-path>)

<Why the task matters, what was observed, and the source basis when relevant.>

## Scope

<Concrete changes and boundaries.>

## Verify

<Automated gates and any specific human check.>
```

Run `npm run check:docs` after editing tickets. It validates required metadata and dependency paths.
