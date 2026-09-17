// Approved-foundation review page: local review controls, mock interactions and original-art previews.
// Nothing here reads game state; original decoded art is served only from the local review directory.
const viewport = document.querySelector('#viewport');
const hud = document.querySelector('#hud');
const build = document.querySelector('.build');
const buildNav = document.querySelector('.nav > button');
const resource = document.querySelector('.resource');
const materials = document.querySelector('#materials');
const resourceTip = document.querySelector('#resource-tip');
const placementName = document.querySelector('[data-picked]');
const status = document.querySelector('#asset-status');

const copy = {
  pl: {
    buildTitle: 'Budowanie',
    buildSubtitle: 'Wybierz budynek, następnie wskaż miejsce na mapie',
    buildNav: 'Buduj',
    peopleNav: 'Mieszkańcy',
  },
  en: {
    buildTitle: 'Construction',
    buildSubtitle: 'Choose a building, then select its position in the world',
    buildNav: 'Construction',
    peopleNav: 'Population overview',
  },
};

function press(key, value) {
  for (const button of document.querySelectorAll(`[data-${key}]`))
    button.setAttribute('aria-pressed', String(button.dataset[key] === value));
}
function showResource(show) {
  resourceTip.hidden = !show;
  materials.setAttribute('aria-expanded', String(show));
}
function showBuild(show) {
  build.hidden = !show;
  buildNav.setAttribute('aria-pressed', String(show));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.terrain) {
    viewport.classList.toggle('night', button.dataset.terrain === 'night');
    press('terrain', button.dataset.terrain);
  }
  if (button.dataset.scale) {
    hud.classList.toggle('small', button.dataset.scale === '90');
    hud.classList.toggle('scaled', button.dataset.scale === '125');
    press('scale', button.dataset.scale);
  }
  if (button.dataset.lang) {
    for (const [id, value] of Object.entries(copy[button.dataset.lang]))
      document.querySelector(`[data-copy="${id}"]`).textContent = value;
    document.documentElement.lang = button.dataset.lang;
    press('lang', button.dataset.lang);
  }
  if (button.dataset.priority) {
    press('priority', button.dataset.priority);
    document.querySelector('.priority em').textContent = button.dataset.priority;
  }
  if (button.closest('.speed')) {
    for (const item of button.closest('.speed').querySelectorAll('button'))
      item.setAttribute('aria-pressed', String(item === button));
  }
  if (button === materials) showResource(resourceTip.hidden);
  if (button.matches('.build .icon-button')) showBuild(false);
  if (button === buildNav) showBuild(true);
  if (button.matches('.building-card:not(:disabled)')) {
    for (const card of document.querySelectorAll('.building-card'))
      card.setAttribute('aria-pressed', String(card === button));
    placementName.textContent = button.querySelector('strong').textContent;
  }
});
resource.addEventListener('mouseenter', () => showResource(true));
resource.addEventListener('mouseleave', () => showResource(false));
resource.addEventListener('focusin', () => showResource(true));
resource.addEventListener('focusout', (event) => {
  if (!resource.contains(event.relatedTarget)) showResource(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  showResource(false);
  showBuild(false);
  buildNav.focus();
});

// Original decoded art is local review evidence, never a repository asset.
const characterRoot = new URL('/review-characters/', location.href);
const originalContent = fetch(new URL('ir.json', characterRoot)).then((response) => {
  if (!response.ok) throw new Error('Brak lokalnych danych oryginalnych postaci');
  return response.json();
});
const TRIBE = 1;
const UNLOADED = 0;
const SOUTH_EAST = 3;
const REVIEW_FPS = 12;
const CANVAS = 192;
const characters = new Map();
async function character(job) {
  if (!characters.has(job))
    characters.set(
      job,
      (async () => {
        const content = await originalContent;
        const look = content.jobGraphics.find((row) => row.tribe === TRIBE && row.job === job);
        const walk = content.gfxWalkAtomics.find(
          (row) => row.tribe === TRIBE && row.job === job && row.goodType === UNLOADED,
        );
        const sequence = content.bobSequences
          .flatMap((row) => row.sequences)
          .find((row) => row.name === walk.bodySeq);
        const layers = await Promise.all(
          [look.body, look.heads[0]].map(async (path, index) => {
            const name = path.split('/').at(-1).replace('.bmd', '');
            const palette = index === 0 ? look.bodyPalette : look.headPalette;
            const base = `${name}.${palette}`;
            const response = await fetch(new URL(`${base}.atlas.json`, characterRoot));
            if (!response.ok) throw new Error(`Brak atlasu postaci: ${base}`);
            const atlas = await response.json();
            const image = new Image();
            image.src = new URL(`${base}.png`, characterRoot).href;
            await image.decode();
            return { frames: new Map(atlas.frames.map((frame) => [frame.bobId, frame])), image };
          }),
        );
        return { layers, frames: walk.dirFrames[SOUTH_EAST].map((frame) => sequence.start + frame) };
      })(),
    );
  return characters.get(job);
}
const animations = [];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function canvasFor(element, kind) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  canvas.className = kind;
  canvas.setAttribute('aria-hidden', 'true');
  element.replaceWith(canvas);
  return canvas;
}
async function mountCharacter(slot) {
  const canvas = canvasFor(slot, 'settler-preview');
  const { layers, frames } = await character(Number(slot.dataset.settler));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const scale = 3.2;
  const paint = (time) => {
    // Review-only walk loop; not the subject's live simulation activity or timing.
    const index = reduced.matches ? 0 : Math.floor(time / (1000 / REVIEW_FPS)) % frames.length;
    context.clearRect(0, 0, CANVAS, CANVAS);
    for (const layer of layers) {
      const frame = layer.frames.get(frames[index]);
      if (!frame) continue;
      const r = frame.rect;
      context.drawImage(
        layer.image,
        r.x,
        r.y,
        r.width,
        r.height,
        CANVAS / 2 + frame.offsetX * scale,
        150 + frame.offsetY * scale,
        r.width * scale,
        r.height * scale,
      );
    }
  };
  paint(0);
  animations.push(paint);
}
async function mountGoods() {
  const response = await fetch('/review-goods/manifest.json');
  if (!response.ok) throw new Error('Ikony towarów gry dostępne tylko w lokalnym podglądzie.');
  const manifest = await response.json();
  await Promise.all(
    [...document.querySelectorAll('[data-good]')].map(async (slot) => {
      const entry = manifest.icons[slot.dataset.good];
      const base = `/review-goods/ls_goods.${entry.palette}`;
      const atlas = await (await fetch(`${base}.atlas.json`)).json();
      const rect = atlas.frames.find((frame) => frame.bobId === entry.frame).rect;
      const image = new Image();
      image.src = `${base}.png`;
      await image.decode();
      const canvas = canvasFor(slot, 'game-good');
      const scale = 160 / Math.max(rect.width, rect.height);
      canvas
        .getContext('2d')
        .drawImage(
          image,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          (CANVAS - rect.width * scale) / 2,
          (CANVAS - rect.height * scale) / 2,
          rect.width * scale,
          rect.height * scale,
        );
    }),
  );
}
const pending = [...document.querySelectorAll('[data-settler]')].map(mountCharacter);
pending.push(mountGoods());
Promise.allSettled(pending).then((results) => {
  const failures = results.filter((result) => result.status === 'rejected').length;
  if (failures)
    status.textContent += ` Nie załadowano ${failures} podglądów; uruchom lokalny serwer makiety z materiałami przeglądu.`;
});
function animate(time) {
  if (!document.hidden) for (const paint of animations) paint(time);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
