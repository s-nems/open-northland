export const meta = {
  name: 'iterate-supervisor',
  description:
    'Run /iterate repeatedly, one disposable subagent per iteration, until the token budget is (nearly) spent or the loop is blocked. Each iteration appends its closeout to a gitignored Markdown report on disk (progress is readable live and survives an interrupt); the orchestrator also returns an aggregated report on a natural stop. The supervisor context only ever holds the closeouts, never the iteration transcripts. Render/visual iterations cannot be self-certified — they still commit (tests green, git-reversible) but are flagged "pending your visual confirmation", and the loop PAUSES once a few have accumulated so you can quickly walk the scenes and sign off.',
  whenToUse:
    'Long unattended Vinland work session: keep taking the smallest next roadmap step and committing to main, then report. Launch with a token-budget directive (e.g. "+1.5m") so it self-stops before the subscription window throttles.',
  phases: [
    { title: 'Iterate', detail: 'one disposable subagent per roadmap iteration (sequential — each commits to main)' },
    { title: 'Report', detail: 'aggregate closeouts into a final report' },
  ],
}

// ---- knobs (all optional, via Workflow `args`) -----------------------------
// `args` is accepted as an OBJECT (preferred) or a bare STRING, defensively:
//   { unbounded: true, focus, maxIterations, reserveTokens, nextStepHint, reflectFirst }
//   "unbounded" | "unlimited" | "infinite" | "forever" | "w nieskończoność" | "bez limitu"
//   "pathfinding"  (a non-keyword string is treated as `focus`)
// The footgun this guards against: a string arg used to fall silently through to
// the 3-iteration default cap, which looks like "it didn't run in unbounded mode".
// PREFER passing an OBJECT (e.g. { unbounded: true }) — the string keyword match is a
// best-effort convenience and DOES NOT cover every synonym a human might type.
//
// args.unbounded     : run forever — ignore the token budget and the default cap.
//                      Only stops on: blocked / red tests / roadmap-empty / throttle
//                      / manual interrupt / the runtime's 1000-iteration backstop.
// args.maxIterations : hard cap on iterations (use a small value for a smoke test)
// args.focus         : bias step selection toward a roadmap item / subsystem
// args.reserveTokens : tokens to keep in reserve for the final report + the
//                      in-flight iteration, so we stop BEFORE the window is hard-capped
// args.nextStepHint  : seed the first iteration with a known next step
// args.reflectFirst  : force the first K iterations to be REFLECTION/RETHINK passes
//                      (reflect.md) regardless of the git-history cadence — for when a
//                      human wants to "start with a few reflect sessions".
// args.maxVisualPending : how many render/visual iterations (each flagged "pending your
//                      visual confirmation") may accumulate before the loop PAUSES so you
//                      can quickly eyeball the scenes and say good / not-good. Default 3.
//                      Set to 1 to stop on the very first visual step. The work is always
//                      committed first, so a pause never loses progress.
const argObj = args && typeof args === 'object' ? args : {}
const argStr = typeof args === 'string' ? args : ''
const UNBOUNDED =
  argObj.unbounded === true || /unbounded|unlimited|unbound|infinit|niesko|forever|bez\s*limit/i.test(argStr)
const RESERVE = argObj.reserveTokens || 80_000
const MAX = argObj.maxIterations || null
const FOCUS = argObj.focus || (argStr && !UNBOUNDED ? argStr : '')
const DEFAULT_CAP = 3 // safety net: never run away when no token budget AND no maxIterations is set
const REFLECT_FIRST = Number(argObj.reflectFirst) || 0 // first K iterations are forced reflection/rethink passes
const MAX_VISUAL_PENDING = Number(argObj.maxVisualPending) || 3 // pause after this many "pending visual confirmation" iterations pile up

const ITERATE_PLAYBOOK = '/Users/snems/Projects/vikings/vinland/.claude/commands/iterate.md'
// Workflow scripts have no filesystem access, so the running report is appended on
// disk by each iteration's subagent (which does). Lives under .claude/ (gitignored),
// so it never enters git history and never makes the working tree look dirty.
const REPORT_PATH =
  (argObj && argObj.reportPath) || '/Users/snems/Projects/vikings/vinland/.claude/reports/iterate-supervisor.md'

const CLOSEOUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['done', 'blocked', 'roadmap-empty'] },
    step: { type: 'string', description: 'one line: what step was done this iteration' },
    testsGreen: { type: 'boolean', description: 'were npm test / check / build all green at the end?' },
    handsOnEvidence: {
      type: 'string',
      description:
        'the exact step-3b hands-on command run + what it actually produced (file counts / sample / record numbers / state hash), or "not hands-on verified: <why>" — the verification gate made visible in structured output, not buried in notes.',
    },
    fidelityBasis: {
      type: 'string',
      description:
        'step-3c fidelity gate: for a mechanic/data step, what ORIGINAL-game behavior this matches and how it is pinned — the extracted data param / the mod\'s .ini semantics / the OpenVikings format-oracle — OR "approximated: <what + why, recorded in docs/FIDELITY.md>". Use "fidelity n/a: <why>" for pure infra/refactor/docs steps. Faithfulness is the project goal and has no automatic mechanics oracle, so this makes drift visible per-commit (handsOnEvidence proves it RUNS; this proves it is FAITHFUL).',
    },
    commits: {
      type: 'array',
      items: { type: 'string' },
      description: 'commit subjects that landed this iteration (empty if none)',
    },
    reviewFindings: { type: 'string', description: 'what /code-review raised, or "none"' },
    addressed: { type: 'string', description: 'how findings were addressed, or what was deliberately skipped and why' },
    needsVisualConfirmation: {
      type: 'boolean',
      description:
        'true if this was a RENDER/VISUAL step (anything under render / the app draw path, an animation, sprite/bob/atlas/palette work, a decoded visual asset, camera or UI layout) whose correctness can only be judged BY EYE. Per iterate.md §3b the visual-confirmation gate fired: tests/oracle prove it is structurally right but NOT that it looks right, so the work was committed yet is NOT verified — it is pending the user\'s final visual sign-off. false for non-visual steps.',
    },
    visualCheckHint: {
      type: 'string',
      description:
        'ONLY when needsVisualConfirmation=true: the fast scene check for the user — the exact command to see it (e.g. "npm run dev"), the one scene/screen to open, and the one or two things to look at (e.g. "settler walk cycle loops smoothly facing all 8 directions; feet don\'t slide"). Keep it to a glance. Empty string otherwise.',
    },
    nextStep: { type: 'string', description: 'the next-smallest step the following iteration should take' },
    notes: { type: 'string', description: 'blockers / anything a human must know (or "")' },
    lesson: {
      type: 'string',
      description:
        'a non-obvious, generalizable lesson appended to docs/lessons/<area>.md this iteration (one grounded line, `[<sha>] <lesson>`), or "" if none.',
    },
    kind: {
      type: 'string',
      enum: ['iterate', 'reflect'],
      description:
        'iterate = a normal roadmap feature step; reflect = iterate.md diverted to a reflection/rethink pass (health/architecture/docs/roadmap). Default iterate.',
    },
  },
  required: ['status', 'step', 'testsGreen', 'handsOnEvidence', 'fidelityBasis', 'needsVisualConfirmation', 'nextStep'],
}

const prompt = (n, prevNext) =>
  `You are iteration #${n} of an autonomous Vinland work loop, running in your OWN fresh, isolated context.

Execute EXACTLY ONE iteration by reading and following the playbook at:
  ${ITERATE_PLAYBOOK}
Follow every step in it (working-tree check -> reflection check -> pick smallest step -> implement -> test -> first commit -> review -> address -> second commit). Obey CLAUDE.md golden rules: the \`sim\` package is deterministic and pure, sim state is fixed-point ints, content-is-data, prefer the mod's .ini sources. This project commits DIRECTLY to main — do not create a branch.

The playbook's reflection check (step 0.5) may, when git history says the project is overdue for one, divert you to a REFLECTION pass (.claude/commands/reflect.md) instead of a roadmap step — a deliberate "stop and rethink" on health/architecture/docs/roadmap. That is expected and good; follow reflect.md fully, set kind="reflect" in your closeout, describe the health improvement in \`step\`, and set \`nextStep\` to the roadmap step the next feature iteration should resume with. A normal feature step is kind="iterate".
${n <= REFLECT_FIRST ? `\nREFLECT-FIRST DIRECTIVE (user-requested): For THIS iteration do a REFLECTION/RETHINK pass (.claude/commands/reflect.md) instead of a roadmap feature step, regardless of the git-history cadence in step 0.5. Follow reflect.md fully, set kind="reflect", describe the health/architecture/docs/roadmap improvement in \`step\`, and set \`nextStep\` to the roadmap step the next feature iteration should resume with.` : ''}${FOCUS ? `\nFocus bias for step selection: ${FOCUS}` : ''}${prevNext ? `\nThe previous iteration suggested the next step would be: "${prevNext}". Treat it as a hint, but re-derive the smallest next step yourself from docs/ROADMAP.md.` : ''}

Autonomous-mode control rules (important — you are unattended):
- The working tree MUST be clean before you start, apart from your own step. If there are UNRELATED pre-existing uncommitted changes, do NOT sweep them into your commit — set status="blocked", explain in notes, and stop.
- Never leave the tree red. If npm test / check / build go red and you cannot fix it, revert the review fixes to keep the green first commit, set testsGreen=false, and report.
- If docs/ROADMAP.md has no unchecked items left, set status="roadmap-empty" and stop.
- Review step: if you cannot spawn review subagents from this context, do the review yourself in-context with a determinism/purity-of-\`sim\` lens — do not skip it.
- VISUAL-CONFIRMATION GATE (iterate.md §3b): if your step is render/visual — anything under render / the app draw path, an animation, sprite/bob/atlas/palette work, a decoded visual asset, camera or UI layout — its correctness can only be judged BY EYE. Tests and the OpenVikings oracle prove it is structurally right, NOT that it looks right; only the user can make that call. So STILL do the work, get tests/check/build green, validate decoded assets against the oracle, and COMMIT normally (status="done", testsGreen=true — the work is saved and git-reversible) — but you are NOT the final authority on whether it looks correct. Set needsVisualConfirmation=true and fill visualCheckHint with a fast scene check (exact command + the one scene to open + the one or two things to look at). For a non-visual step set needsVisualConfirmation=false and visualCheckHint="". Do NOT block on it (do not set status="blocked") — the orchestrator collects these and pauses the loop after a few accumulate so the user can eyeball them.

Live report — do this as your LAST action before returning, whether the iteration succeeded, was blocked, or went red:
- Append (NEVER overwrite) a Markdown section to ${REPORT_PATH}, creating the file and its parent directory if missing. That path is under .claude/ which is gitignored — it is NOT part of your commit, so do not stage it (and it won't make the tree look dirty for the next iteration).
- Section format:
    ## <short commit SHA(s), or "no-commit"> — <one-line step>
    - status: <done|blocked|roadmap-empty>   tests: <green|red>
    - commits: <subjects>
    - hands-on: <the 3b command + what it produced, or "not hands-on verified: <why>">
    - fidelity: <3c basis: original behavior matched + how pinned, or "fidelity n/a: <why>">
    - visual: <if render/visual: "PENDING YOUR CONFIRMATION — <command> -> open <scene> -> check <what to look at>"; else "n/a">
    - review: <findings> -> <how addressed / what was skipped and why>
    - next: <next-smallest step>
    - lesson: <one grounded line appended to docs/lessons/<area>.md, or "none">
    - notes: <blockers / anything a human must know>
This append is what builds the report incrementally and keeps it durable even if the loop is interrupted before the orchestrator writes its final summary.

Your final output IS structured data consumed by an orchestrator, NOT a message to a human. Return ONLY the closeout object.`

phase('Iterate')
log(`Live report appended per-iteration to ${REPORT_PATH}`)

const iterations = []
const pendingVisual = [] // render/visual iterations awaiting the user's eyeball sign-off
let prevNext = argObj.nextStepHint || ''
let stopReason = 'budget-reached'
let n = 0

function canContinue() {
  if (MAX !== null && n >= MAX) {
    stopReason = `max-iterations (${MAX}) reached`
    return false
  }
  // Unbounded mode: run until a per-iteration break condition fires (blocked /
  // red tests / roadmap-empty / throttle), the runtime's 1000-iteration backstop,
  // or a manual interrupt. No token budget or default cap applies.
  if (UNBOUNDED) {
    stopReason = 'interrupted / runtime backstop (unbounded mode)'
    return true
  }
  if (budget.total) {
    if (budget.remaining() <= RESERVE) {
      stopReason = `token budget reached (reserve ${Math.round(RESERVE / 1000)}k kept for the report)`
      return false
    }
    return true
  }
  // No "+Nm" budget directive on the launching turn and no maxIterations:
  // fall back to a conservative cap so we never silently burn the whole window.
  if (n >= DEFAULT_CAP) {
    stopReason = `default cap (${DEFAULT_CAP}) — no token budget set; relaunch with a "+Nm" directive for a long run`
    return false
  }
  return true
}

while (canContinue()) {
  n += 1
  log(
    `Iteration #${n} starting — ${
      budget.total ? `${Math.round(budget.remaining() / 1000)}k tokens left of budget` : 'no token budget set'
    }`,
  )

  const r = await agent(prompt(n, prevNext), {
    label: `iterate #${n}`,
    phase: 'Iterate',
    schema: CLOSEOUT,
    agentType: 'general-purpose',
  })

  // null => the subagent died after retries. The most likely cause in a long run
  // is the subscription's rolling window throttling us, or a terminal API error.
  // Stop gracefully and report what already landed (every iteration is its own commit).
  if (r === null) {
    stopReason = 'subagent stopped (likely rate limit / usage window hit, or a terminal error) — stopping gracefully'
    break
  }

  iterations.push({ n, ...r })
  log(`Iteration #${n} [${r.kind || 'iterate'}]: ${r.status} — ${r.step}`)

  if (r.status === 'blocked') {
    stopReason = `blocked at iteration #${n}: ${r.notes || r.step}`
    break
  }
  if (r.status === 'roadmap-empty') {
    stopReason = 'roadmap-empty — all milestones done'
    break
  }
  if (r.testsGreen === false) {
    stopReason = `tests not green at iteration #${n} — stopping to avoid building on a red tree`
    break
  }

  // Render/visual step: the work is committed and tests are green, but only the user can
  // confirm it LOOKS right. Collect it and pause once a few pile up, so the user can quickly
  // walk the scenes and sign off rather than reviewing a giant backlog at the end.
  if (r.needsVisualConfirmation) {
    pendingVisual.push({ n, step: r.step, hint: r.visualCheckHint || '', commits: r.commits || [] })
    log(`Iteration #${n} needs your visual confirmation (${pendingVisual.length}/${MAX_VISUAL_PENDING}): ${r.visualCheckHint || r.step}`)
    if (pendingVisual.length >= MAX_VISUAL_PENDING) {
      stopReason = `paused: ${pendingVisual.length} render/visual step(s) need your visual confirmation — walk the scenes and sign off, then relaunch to continue`
      break
    }
  }

  prevNext = r.nextStep || prevNext
}

phase('Report')

return {
  stopReason,
  iterationsCompleted: iterations.length,
  tokensSpent: budget.spent(),
  budgetTotal: budget.total,
  done: iterations.filter((i) => i.status === 'done').map((i) => `#${i.n}: ${i.step}`),
  reflections: iterations.filter((i) => i.kind === 'reflect').map((i) => `#${i.n}: ${i.step}`),
  // The punch-list to walk before trusting the visual work — each is committed but unconfirmed.
  pendingVisualConfirmation: pendingVisual.map((v) => ({
    n: v.n,
    step: v.step,
    check: v.hint || '(no scene hint given — open the app and inspect this step)',
    commits: v.commits,
  })),
  lessons: iterations.filter((i) => i.lesson).map((i) => `#${i.n}: ${i.lesson}`),
  blockers: iterations
    .filter((i) => i.status === 'blocked' || i.testsGreen === false)
    .map((i) => ({ n: i.n, step: i.step, notes: i.notes })),
  nextStep: prevNext,
  iterations,
}
