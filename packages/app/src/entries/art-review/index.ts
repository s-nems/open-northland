import {
  createWindowPixiApp,
  halfCellToScreen,
  makeElevationField,
  TerrainLayer,
} from '@open-northland/render';
import { Container, Sprite } from 'pixi.js';
import {
  contactShadow,
  loadReviewAssets,
  reviewCharacter,
  reviewHouse,
  reviewWalk,
  reviewWalkTextures,
} from './assets.js';
import { loadReviewGround } from './load-ground.js';

export async function renderArtReview(canvas: HTMLCanvasElement): Promise<void> {
  const app = await createWindowPixiApp(canvas);
  const assets = await loadReviewAssets();
  const world = new Container();
  const actors = new Container();
  actors.sortableChildren = true;
  const terrain = new TerrainLayer();
  let ground: Awaited<ReturnType<typeof loadReviewGround>>;
  try {
    ground = await loadReviewGround(app.renderer, assets.grass, assets.soil);
  } catch (error) {
    const message = document.createElement('p');
    message.style.cssText =
      'position:fixed;inset:24px;color:white;background:#20271e;padding:24px;z-index:10';
    message.textContent = `Nie można wyświetlić fragmentu mapy: ${error instanceof Error ? error.message : String(error)} `;
    const link = document.createElement('a');
    link.href = '?art';
    link.textContent = 'Otwórz scenę syntetyczną';
    message.append(link);
    document.body.append(message);
    app.destroy();
    return;
  }
  terrain.set(ground.terrain, ground.textures);
  const elevation = makeElevationField(ground.terrain.elevation, ground.terrain.width, ground.terrain.height);
  world.addChild(terrain.container, actors);
  app.stage.addChild(world);
  const house = reviewHouse(assets.house);
  house.position.set(440, 330);
  house.zIndex = house.y;
  const houseShadow = contactShadow(85, 22);
  houseShadow.position.copyFrom(house.position);
  world.addChildAt(houseShadow, 1);
  actors.addChild(house);
  house.visible = !ground.realMap;
  const frames = reviewWalkTextures(assets.walk);
  const people = [0, 150].map((offset) => {
    const sprite = new Sprite(frames[0]);
    sprite.anchor.set(
      reviewCharacter.anchorX / reviewCharacter.cellWidth,
      reviewCharacter.anchorY / reviewCharacter.cellHeight,
    );
    sprite.scale.set(reviewCharacter.scale);
    actors.addChild(sprite);
    const shadow = contactShadow(8, 2.5);
    world.addChildAt(shadow, 1);
    return { sprite, shadow, offset };
  });
  const panel = document.createElement('section');
  panel.style.cssText =
    'position:fixed;top:12px;left:12px;max-width:620px;padding:14px;background:#20271eef;color:#eee8d8;font:14px system-ui;z-index:10;border:1px solid #637052';
  panel.innerHTML = `<strong>J · Przegląd grafiki w rendererze</strong>
    <p id="art-ground-status"></p>
    <p><a style="color:#ead2a0" href="?art">Dom i ścieżka</a> · <a style="color:#ead2a0" href="?art&artMap=tutorial_005">Fragment starej mapy</a></p>
    <label>Zoom <select id="art-zoom"><option>1</option><option>1.5</option><option selected>2</option><option>3</option></select></label>
    <label>Postacie <select id="art-filter"><option value="nearest">Ostre próbkowanie</option><option value="linear" selected>Wygładzanie</option></select></label>
    <label><input type="checkbox" id="art-shadow" checked> Cienie kontaktowe</label>
    <label><input type="checkbox" id="art-pause"> Pauza</label>
    <p>Przeciągnij teren. Obie postacie mają tę samą skalę. Sprawdź czytelność postaci na podłożu.</p>
    <small>Ruch testowy bez symulacji. W trybie mapy pomijane są jej budynki i roślinność; oceniasz podłoże z bieżącymi postaciami.</small>`;
  const status = panel.querySelector('#art-ground-status');
  if (status) status.textContent = ground.label;
  document.body.append(panel);
  const zoomControl = panel.querySelector<HTMLSelectElement>('#art-zoom');
  const filterControl = panel.querySelector<HTMLSelectElement>('#art-filter');
  const shadowControl = panel.querySelector<HTMLInputElement>('#art-shadow');
  const pauseControl = panel.querySelector<HTMLInputElement>('#art-pause');
  if (!zoomControl || !filterControl || !shadowControl || !pauseControl)
    throw new Error('Art controls missing');
  let panX = 0;
  let panY = 0;
  let dragging = false;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    panX += event.movementX;
    panY += event.movementY;
  });
  filterControl.addEventListener('change', () => {
    assets.walk.source.scaleMode = filterControl.value === 'nearest' ? 'nearest' : 'linear';
  });
  assets.walk.source.scaleMode = 'linear';
  let time = 0;
  app.ticker.add((ticker) => {
    if (!pauseControl.checked) time += Math.min(ticker.deltaMS, 100) / 1000;
    const zoom = Number(zoomControl.value);
    world.scale.set(zoom);
    world.position.set(app.screen.width / 2 - 450 * zoom + panX, app.screen.height / 2 - 340 * zoom + panY);
    const t = (time / 18) % 1;
    const point = halfCellToScreen(18 - 10 * t, 9 + 19 * t);
    for (const person of people) {
      const frame = frames[Math.floor((time / reviewWalk.duration) * frames.length) % frames.length];
      if (frame !== undefined) person.sprite.texture = frame;
      const lift = elevation.liftAtNode(18 - 10 * t + person.offset / 34, 9 + 19 * t);
      person.sprite.position.set(point.x + person.offset, point.y - lift);
      person.sprite.zIndex = point.y;
      person.shadow.position.copyFrom(person.sprite.position);
      person.shadow.visible = shadowControl.checked;
    }
    houseShadow.visible = shadowControl.checked && !ground.realMap;
    terrain.cull({
      minX: -world.x / zoom,
      minY: -world.y / zoom,
      maxX: (app.screen.width - world.x) / zoom,
      maxY: (app.screen.height - world.y) / zoom,
    });
  });
  app.start();
}
