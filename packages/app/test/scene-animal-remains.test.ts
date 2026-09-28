import { parseContentSet } from '@open-northland/data';
import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { ANIMAL_TRIBE_WOLVES } from '../src/catalog/animal-tribes.js';
import { grassTerrain } from '../src/catalog/buildings.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { createSceneWorld } from '../src/scenes/runtime.js';
import type { SceneWorld } from '../src/scenes/types.js';

/** The `meat` logic landscape (type 44) and its `meat pile 01` record (index 215), as decoded. */
const MEAT_LANDSCAPE_TYPE = 44;
const MEAT_PILE_GFX = 215;
/** The sandbox wolf's `maximumcadaversize` of 4 leaves a pile of 4 / 3. */
const WOLF_PILE = 1;

const wolfScene: SceneWorld = {
  seed: 1,
  terrain: grassTerrain(12, 12),
  build: (sim) => {
    const node = cellAnchorNode(5, 5);
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: ANIMAL_TRIBE_WOLVES,
      x: node.hx,
      y: node.hy,
      count: 1,
    });
  },
};

function killWolf(sim: Simulation): void {
  sim.step();
  for (const e of sim.world.query(components.Settler, components.Health)) {
    if (sim.world.get(e, components.Settler).tribe === ANIMAL_TRIBE_WOLVES) {
      sim.world.mut(e, components.Health).hitpoints = 0;
    }
  }
  sim.step();
}

it("lays a dead wolf's meat pile as a decor object over the sandbox catalog", () => {
  const sim = createSceneWorld(wolfScene);
  killWolf(sim);
  const added = sim.landscapeEdits().added;
  expect(added).toMatchObject([{ typeId: MEAT_PILE_GFX, level: WOLF_PILE }]);
  expect(added[0]).not.toHaveProperty('resourceBacked');
});

it('lays it as a meat heap where the content names the meat landscape as the good on the ground', () => {
  const base = sandboxContent();
  const content = parseContentSet({
    ...base,
    goods: base.goods.map((g) => (g.id === 'meat' ? { ...g, landscapeType: MEAT_LANDSCAPE_TYPE } : g)),
  });
  const meat = content.goods.find((g) => g.id === 'meat')?.typeId;
  const sim = createSceneWorld(wolfScene, { content });
  killWolf(sim);
  expect(sim.landscapeEdits().added).toMatchObject([
    { typeId: MEAT_PILE_GFX, level: WOLF_PILE, resourceBacked: true },
  ]);
  const heaps = [...sim.world.query(components.Stockpile)].map((e) => [
    ...sim.world.get(e, components.Stockpile).amounts,
  ]);
  expect(heaps).toEqual([[[meat, WOLF_PILE]]]);
});
