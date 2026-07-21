# Documentation

Start with these pages:

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) explains the package boundaries and runtime flow.
2. [`ECS.md`](ECS.md) describes the simulation model.
3. [`DATA-FORMAT.md`](DATA-FORMAT.md) covers generated content and the validated IR.
4. [`TESTING.md`](TESTING.md) lists the test layers and required gates.
5. [`DEVELOPMENT.md`](DEVELOPMENT.md) is the command and local-development reference.

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

The root [`AGENTS.md`](../AGENTS.md) is the project-wide contract for coding agents. Package-local
files add rules for `sim`, `render`, `audio`, `app`, `desktop`, and the asset pipeline.

Claude workflow definitions live in `.claude/commands/` and reviewer checklists in
`.claude/agents/`. Cursor files are thin links to those workflows. Tool-specific `CLAUDE.md` and
`GEMINI.md` files only load the nearest `AGENTS.md`.

Do not create running history documents or catch-all planning files. Put stable rules in an
`AGENTS.md`, current work in a ticket, and completed details in Git history.
