# Documentation

Read the root contract first, then only the references needed for the task:

| Task | Start here |
| --- | --- |
| Understand package ownership or runtime flow | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Change simulation state or systems | `packages/sim/AGENTS.md`, then [ECS.md](ECS.md) |
| Change generated content or joins | Package contract, then [DATA-FORMAT.md](DATA-FORMAT.md) |
| Choose checks or reproduce a defect | [TESTING.md](TESTING.md) |
| Run the app, content conversion or diagnostics | Relevant section of [DEVELOPMENT.md](DEVELOPMENT.md) |
| Select backlog work | `npm run tickets:list`, then the selected ticket |

Package trees, manifests and test files are the source of truth for file locations and executable
behavior. Open deeper format references when the task needs their evidence.

Other references:

- [`SCENES.md`](SCENES.md): acceptance scenes for tests and human review
- [`SOURCES.md`](SOURCES.md): acceptable evidence for formats and game behavior
- [`LEGAL.md`](LEGAL.md): game-data, licensing, and trademark rules
- [`GLOSSARY.md`](GLOSSARY.md): project and format terms
- [`formats/`](formats/): notes about decoded file formats

## Work tracker

[`tickets/`](tickets/) contains open tasks. A ticket should explain one concrete problem, its scope,
and how to verify the result. Completed tickets are deleted because Git already keeps the history.
See [`tickets/README.md`](tickets/README.md) for the format.

## Agent instructions

The root [`./AGENTS.md`](../AGENTS.md) is the project-wide contract for coding agents. Package-local
files add rules for `sim`, `render`, `audio`, `app`, `data`, `desktop`,
original-game extraction, and own-art production.

Claude workflow definitions live in `.claude/commands/` and reviewer checklists in
`.claude/agents/`. `CLAUDE.md` only loads the nearest `./AGENTS.md`; Codex reads `./AGENTS.md` directly.

Do not create running history documents or catch-all planning files. Put stable rules in an
`./AGENTS.md`, current work in a ticket, and completed details in Git history.
