# Split the scene registry from its world builders

**Area:** app · **Focus:** entries · **Priority:** P3

`entries/main-menu/map-picker.ts` imports `SCENES` to read `scene.id` and nothing else, but every
`SceneDefinition` carries a `build(sim)` closure and a `terrain` grid. Listing the scenes in the menu
therefore loads all 26 world builders plus the sandbox content they assemble: 34 kB gzip on a menu boot
that may never open a scene.

## Scope

- Give the menu a listing that carries only what a row needs (the id, which it joins to
  `messages().scene` for the title and summary), and keep the definitions behind the `?scene=` entry.
- Keep `SCENES` the single source of registered ids: a scene reachable at `?scene=<id>` and covered by
  the headless acceptance test must not be able to fall out of the menu listing silently.
- `entries/scene.ts` also reads `SCENES` for the unknown-scene overlay's list of valid ids; that path
  already loads the definitions, so it can keep using either shape.

## Verify

- The size table `npm run build` prints shows the `main-menu` row drop by roughly 34 kB gzip, with the
  `scene` row unchanged.
- Existing scene tests and `npm test`.
- Open the menu's scene list and start one scene in the browser.
