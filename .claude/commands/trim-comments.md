---
description: Audit explanatory comments in an explicit scope, trim only redundant prose, and escalate comments that are compensating for unclear code.
argument-hint: <scope: package|path|files>
---

Audit comments in the explicit `$ARGUMENTS` scope against the "Comments are budgeted prose" and
"Structure before commentary" rules in `AGENTS.md`. If no scope is supplied, ask for one; never
default to a repository-wide sweep. This remains a **comment-only pass**: do not change code, names,
types, imports, or formatting outside comment text.

The purpose is to distinguish redundant prose from structural debt, not to maximize deleted lines.
If a comment is carrying structure the code fails to express, leave it intact and file a bounded
refactor ticket instead of making the code harder to understand.

## 1. Select a bounded pass

Read the `.ts` source files in scope (skip `dist/`, `node_modules/`, generated files, and tests) and
look for prose that obscures the declaration or branch it explains. Declarative schemas and protocol
types may legitimately need denser field contracts than orchestration code.

Inspect at most three related offenders in one run. Prefer files in one feature so cross-file facts
can be deduplicated without producing a broad style-churn diff.

## 2. Classify before editing

Classify each explanatory comment or distinct sentence:

- **delete** — narration, restatement, history, praise, repetition, or a fact the code already says;
- **retain** — a unit, precondition, invariant, source basis, named approximation, or
  why-not-the-obvious-way that the code cannot express;
- **refactor** — prose naming control-flow phases, branch purpose, ownership, valid state
  combinations, or an entity-state transition that should live in code structure.

Delete `delete` prose sentence by sentence. Tighten a `retain` sentence only while preserving its
entire fact and source basis. Leave `refactor` prose byte-identical in this comment-only pass, then
dedupe and file one self-contained cleanup ticket per coherent structural problem under
`docs/tickets/`.

The usual `delete` offenders are narration of the next line, change history, praise of the design,
analogies repeated per function, quotes from the producing conversation, and a second sentence
restating the first. A typical retained doc comment remains 1–3 sentences; a longer one is acceptable
only when every sentence carries a distinct irreducible fact.

Do not replace removed prose with shorter synonyms, use comment deletion to push a file under a line
budget, or remove a section-heading comment while leaving an unnamed wall of branches behind.

## 3. Verify and report

Run `npm run check` and `npm test`. Goldens must not move — comments cannot change behavior, so a
moved golden means code changed and the offending hunk must be reverted.

Report each inspected file with its classifications:

- deleted or merged comments and the code facts that now stand on their own;
- retained long comments and the irreducible facts they carry;
- structural comments left intact, linked to the ticket filed for the code repair;
- files inspected and left byte-identical.

Success may be a small comment diff plus a precise structural ticket. Leave changes uncommitted for
review.
