# Knowledge window wireframe

A clickable design review of the Knowledge window, on the game's own `foundation.css`. It holds no game
data: names, numbers and sprites come from a local review directory that never enters the repository.
Delete this folder when the window is built.

```bash
node docs/design/knowledge-window/build-data.mjs content <mod>/Data/text/pol/strings/help <review-dir>
node docs/design/knowledge-window/serve.mjs 5186 <review-dir>
```

The review directory also takes `icons/<good-id>.png`, `thumbs/<building-id>.png` and `menu.png`, cut from
the running game. A missing picture shows as a dashed placeholder.
