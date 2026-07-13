---
description: Trim overgrown comments in a scope to their load-bearing facts — comment-only pass, no code changes.
argument-hint: [scope: package|path|files; default: all packages/*/src]
---

Trim overgrown comments in the scope supplied in `$ARGUMENTS` (default: every `packages/*/src`)
down to the "Comments are budgeted prose" rule in `AGENTS.md`. This is a **comment-only pass**:
do not change code, names, types, imports, or formatting outside comment text.

## 1. Find offenders

Rank `.ts` source files in scope (skip `dist/`, `node_modules/`, generated files) by comment-line
density and by doc comments visibly dwarfing the code they explain. Work the ~10 worst files this
run; list the runners-up at the end so the next run has a starting point.

## 2. Trim

For each offending comment, rewrite it keeping only the load-bearing facts:

- **Keep:** units, invariants, non-obvious source basis (as a short parenthetical, e.g.
  `(observed original behaviour)`), named approximations, and why-not-the-obvious-way.
- **Delete:** rhetorical emphasis (CAPS/bold mid-sentence, superlatives), history of how the code
  got here or what design it replaced, quotes from the conversations/reviews that produced the
  code, restated invariants, and narration of what the next line does.
- A comment that is already lean — or long because every sentence carries a distinct needed
  fact — stays untouched. When unsure whether a fact is load-bearing, keep the fact and cut the
  prose around it.

## 3. Verify and report

Run `npm run check` and `npm test`. Goldens must not move — comments cannot change behavior, so a
moved golden means you touched code: revert that hunk. Report per file: comment lines before →
after, plus anything deliberately kept long and why. Leave the changes uncommitted for review.
