# Work tracker

Each Markdown file below this directory is one open task. Git history is the archive: completing or
invalidating a task means deleting its ticket, not moving it to a `done` folder.

`features/` is the project owner's curated gameplay backlog. Agents do not add feature ideas, visual
polish, parity surveys, or acceptance scenes there unless the owner explicitly asks. Technical work
discovered while implementing a feature belongs in the owning area (`sim/`, `render/`, `app/`,
`pipeline/`, `audio/`, `data/`, or `tooling/`) only when it passes the admission rules below.

## Admission rules

A technical ticket needs all of the following:

- a current code path, reproducible defect, measured cost, violated project invariant, or concrete
  release blocker;
- a consequence that makes the work worth scheduling;
- one bounded outcome that fits a focused worktree session;
- enough evidence for a new reader to verify the premise without the conversation that found it;
- explicit source basis or an investigate-first step for mechanics, formats, and visual claims;
- a verification path stronger than “the code looks cleaner”.

Do not file:

- feature ideas, optional polish, or “the original might do this” surveys on an agent's initiative;
- style preferences, comment cleanup, import-path churn, or speculative abstractions;
- “decide whether to…” tasks when the repository contract or current evidence already decides;
- a test-only follow-up unless it protects a risky invariant or a currently untested player path;
- hypothetical performance work without a scale violation or a reproducible measurement;
- a second ticket for the same cause and verification path.

If a finding is real but too small to schedule, keep it in the current review report or fix it in the
current task when it is safely in scope. Do not turn every review observation into durable backlog.

## Writing a ticket

Lead with the current problem and its consequence. Prefer stable symbols and paths over line numbers.
Keep investigation history, completed substeps, branch names, rejected alternatives, and review
dialogue in Git history. A ticket describes remaining work only.

Use imperative titles. State the required outcome; do not delegate an avoidable product or ownership
decision to the implementer. Keep scope at the behavior or boundary level unless one implementation
detail is load-bearing.

Every ticket has an area and priority near the top:

- `P1`: a verified legal/release blocker or broken core path that prevents a correct playable game;
- `P2`: a current correctness defect, clear player value, or measured scale problem;
- `P3`: bounded maintenance, hardening, or research worth an explicit session.

Use `Needs user` only when work cannot proceed without a live choice or human observation. Final visual
or audio sign-off alone does not make an otherwise autonomous ticket blocked.

Use `Blocked by` only for an existing prerequisite ticket. Link it with a relative Markdown path and
remove the dependency as soon as the prerequisite is complete.

## Lifecycle

- Re-check the cited code and evidence before starting.
- Delete the ticket in the commit that completes it.
- If only part is complete, rewrite it to the exact remaining work.
- Delete a stale, speculative, duplicate, or disproved ticket instead of preserving its story.
- When recommending work, exclude active worktrees and `Needs user` tasks, then prefer the highest
  priority item with a clear dependency chain.

## Template

```markdown
# <imperative outcome>

**Area:** <package(s)> · **Priority:** <P1|P2|P3>
**Needs user:** <only when execution requires it>
**Blocked by:** [<ticket>](<relative path>)

<Current problem, consequence, and evidence/source basis.>

## Scope

<Bounded outcome and relevant non-goals.>

## Verify

<Specific automated checks, reproduction, measurement, and any human review.>
```

Run `npm run check:docs` after editing tickets.
