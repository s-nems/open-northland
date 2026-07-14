---
description: Trim overgrown comments in a scope to their load-bearing facts — comment-only pass, no code changes.
argument-hint: [scope: package|path|files; default: all packages/*/src]
---

Trim overgrown comments in the scope supplied in `$ARGUMENTS` (default: every `packages/*/src`)
down to the "Comments are budgeted prose" rule in `AGENTS.md`. This is a **comment-only pass**:
do not change code, names, types, imports, or formatting outside comment text.

The unit of work is the **sentence**, not the word. Success is deleted and merged sentences; a
pass that only downcases emphasis or swaps synonyms has failed. If a comment needs no sentence
removed, leave it byte-identical — do not reword lean comments.

## 1. Find offenders

Rank `.ts` source files in scope (skip `dist/`, `node_modules/`, generated files) by comment-line
density and by doc comments visibly dwarfing the code they explain. Work the ~10 worst files this
run; list the runners-up at the end so the next run has a starting point.

## 2. Trim

Judge each comment sentence by sentence. A sentence earns its place only by carrying one of:

- a unit, precondition, or invariant the code can't show;
- a non-obvious source basis, as a short parenthetical (e.g. `(observed original behaviour)`);
- a named approximation;
- why-not-the-obvious-way.

Delete every sentence that carries none of these. The usual offenders: narration of what the next
line does, history of how the code got here or what design it replaced, praise of the design
("pure + total", "self-verifiable", "faithful") attached to every declaration, an analogy to
another module repeated per function, quotes from the conversation or review that produced the
code, and a second sentence restating what the first already said.

Then dedupe across the file: a fact stated in several comments keeps one home (usually the module
header or the primary declaration); the other sites lose it or keep a short pointer.

Target: a typical doc comment lands at 1–3 sentences (the AGENTS.md budget). One that stays longer
must justify every sentence with a distinct needed fact. When unsure whether a fact is
load-bearing, keep the fact and cut the prose around it. While rewriting a kept sentence, also
drop rhetorical emphasis (mid-sentence CAPS/bold, superlatives) — but emphasis cleanup alone is
never a reason to touch a comment.

## 3. Verify and report

Run `npm run check` and `npm test`. Goldens must not move — comments cannot change behavior, so a
moved golden means you touched code: revert that hunk. Report per file: comment lines before →
after — a worked offender should shrink visibly, and if one didn't, say why rather than padding
the diff. Files inspected and left untouched get one line saying so. Note anything deliberately
kept long and why. Leave the changes uncommitted for review.
