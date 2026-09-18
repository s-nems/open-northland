# Integrate permits and other documents into construction

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/extras-papers.ts` and `view/assistant-grants.ts` implement papers under Extras, with some document types still display-only according to the reference.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design the Documents view inside the construction flow: applicable permits, remaining quantity, effects, unavailable reasons and navigation back to the catalog.
- Support particular-building and any-building permits with the correct prepaid placement context. Cancel must not consume a paper; successful use must not double-consume it.
- Retain access to completed/supplied building and learning/production documents; verify existing command capabilities before enabling actions. Split a concrete missing simulation capability into its own bounded prerequisite if necessary.
- Remove the redundant Extras/Osada document entry. Do not repurpose permits as ordinary paid construction.

## Verify

Test each supported paper type, cancellation/retry, repeated clicks, wrong owner, depleted stock and save/load. Review the complete catalog-to-paper-to-placement interaction.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
