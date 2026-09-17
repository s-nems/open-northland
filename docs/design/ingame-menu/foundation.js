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
  if (button.dataset.priority) showNotices(notices.dataset.state, button.dataset.priority);
  if (button.dataset.notices) {
    showNotices(button.dataset.notices, button.dataset.notices === 'urgent' ? 'Tylko pilne' : 'Wszystkie');
    press('notices', button.dataset.notices);
  }
  if (button.matches('.notice-dismiss')) dismissNotice(button.closest('.notice'));
  // A card with a target would centre the camera; one without pins its full text instead.
  if (button.matches('.notice-card') && !button.querySelector('.go'))
    pinNoticeFull(button, pinned !== button);
  if (button === noticeMore) noticeList.scrollBy({ top: noticeList.clientHeight - 40, behavior: 'smooth' });
  if (button.closest('.speed')) {
    for (const item of button.closest('.speed').querySelectorAll('button'))
      item.setAttribute('aria-pressed', String(item === button));
    paused = button.getAttribute('aria-label') === 'Pauza';
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
  if (event.key === 'Delete' && event.target.closest('.notice')) {
    if (event.shiftKey)
      for (const item of noticeList.querySelectorAll('.notice:not([hidden])')) dismissNotice(item);
    else dismissNotice(event.target.closest('.notice'));
    return;
  }
  if (event.key !== 'Escape') return;
  showResource(false);
  showBuild(false);
  pinNoticeFull(null, false);
  buildNav.focus();
});

// Notifications: review states, the priority filter, dismissal and the below-the-fold badge.
const notices = document.querySelector('.notices');
const noticeList = notices.querySelector('.notice-list');
const noticeMore = notices.querySelector('.notice-more');
const noticeEmpty = notices.querySelector('.notice-empty');
const noticeCount = notices.querySelector('[data-count]');
const noticeFull = document.querySelector('#notice-full');
/* Below this visible strip per card the fan stops and the list scrolls instead. */
const MIN_CARD_STRIP = 32;
const CARD_GAP = 7;
const LEVEL_OF_FILTER = { Wszystkie: 0, 'Ważne i pilne': 1, 'Tylko pilne': 2 };
const LEVEL_NAMES = ['zwykłe', 'ważne', 'pilne'];
let filterLevel = 0;
function noticeLevel(item) {
  return item.classList.contains('danger') ? 2 : item.classList.contains('warning') ? 1 : 0;
}
/* The filter hides cards; the seals still count every live card of their weight. */
function applyNoticeFilter() {
  const counts = [0, 0, 0];
  for (const item of noticeList.querySelectorAll('.notice')) {
    const live = item.dataset.live === '1';
    if (live) counts[noticeLevel(item)]++;
    item.hidden = !(live && noticeLevel(item) >= filterLevel);
  }
  for (const button of notices.querySelectorAll('.priority button')) {
    const level = Number(button.dataset.level);
    button.querySelector('[data-level-count]').textContent = counts[level];
    const label = `${button.dataset.priority} · ${LEVEL_NAMES[level]}: ${counts[level]}`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  const total = counts[0] + counts[1] + counts[2];
  noticeCount.textContent = `Wiadomości: ${total}`;
  noticeEmpty.hidden = total > 0;
  if (total === 0) notices.dataset.state = 'empty';
  layoutNotices();
}
function showNotices(state, filter) {
  notices.dataset.state = state;
  filterLevel = LEVEL_OF_FILTER[filter];
  press('priority', filter);
  notices.querySelector('.priority em').textContent = filter;
  for (const item of noticeList.querySelectorAll('.notice')) {
    const inState = state === 'overflow' || (state !== 'empty' && !item.classList.contains('more'));
    item.dataset.live = inState ? '1' : '0';
  }
  noticeList.scrollTop = 0;
  pinNoticeFull(null, false);
  applyNoticeFilter();
}
function dismissNotice(item) {
  item.dataset.live = '0';
  if (pinned !== null && item.contains(pinned)) pinNoticeFull(null, false);
  applyNoticeFilter();
}
/* Fan the cards so they all fit: one uniform overlap, weightier cards in front. Fanned cards keep one
   event line, so the heights are measured again once the fan is on. */
function layoutNotices() {
  const shown = [...noticeList.querySelectorAll('.notice:not([hidden])')];
  shown.forEach((item, index) => {
    item.style.setProperty('--z', shown.length - index);
  });
  const styles = getComputedStyle(noticeList);
  const room = noticeList.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
  const natural = () => shown.reduce((sum, item) => sum + item.offsetHeight + CARD_GAP, 0);
  notices.classList.remove('stacked');
  let overlap = 0;
  if (shown.length > 1 && natural() > room) {
    notices.classList.add('stacked');
    const heights = shown.map((item) => item.offsetHeight);
    const maxOverlap = Math.min(...heights) - MIN_CARD_STRIP + CARD_GAP;
    overlap = Math.min(maxOverlap, Math.ceil((natural() - room) / (shown.length - 1)));
  }
  noticeList.style.setProperty('--overlap', `${overlap}px`);
  updateNoticeMore();
}
let pinned = null;
function showNoticeFull(card) {
  noticeFull.textContent = card.dataset.full;
  noticeFull.hidden = false;
  const item = card.closest('.notice');
  noticeFull.style.top = `${noticeList.offsetTop + item.offsetTop - noticeList.scrollTop}px`;
}
function hideNoticeFull() {
  if (pinned === null) noticeFull.hidden = true;
}
function pinNoticeFull(card, pin) {
  pinned = pin ? card : null;
  if (pin) showNoticeFull(card);
  else noticeFull.hidden = true;
  for (const each of noticeList.querySelectorAll('.notice-card'))
    each.setAttribute('aria-expanded', String(each === pinned));
}
noticeList.addEventListener('mouseover', (event) => {
  const card = event.target.closest('.notice-card');
  if (card && pinned === null) showNoticeFull(card);
});
noticeList.addEventListener('mouseout', (event) => {
  if (event.target.closest('.notice-card')) hideNoticeFull();
});
noticeList.addEventListener('focusin', (event) => {
  const card = event.target.closest('.notice-card');
  if (card && pinned === null) showNoticeFull(card);
});
noticeList.addEventListener('focusout', (event) => {
  if (event.target.closest('.notice-card')) hideNoticeFull();
});
function updateNoticeMore() {
  const fold = noticeList.scrollTop + noticeList.clientHeight;
  let below = 0;
  for (const item of noticeList.querySelectorAll('.notice:not([hidden])'))
    if (item.offsetTop + item.offsetHeight - 6 > fold) below++;
  noticeMore.hidden = below === 0;
  noticeMore.querySelector('[data-more]').textContent = below;
  notices.classList.toggle('overflowing', noticeList.scrollHeight > noticeList.clientHeight + 1);
}
noticeList.addEventListener('scroll', updateNoticeMore);
// The fan settles through a margin transition; count the fold again once it has.
noticeList.addEventListener('transitionend', updateNoticeMore);
noticeList.addEventListener('contextmenu', (event) => {
  const item = event.target.closest('.notice');
  if (!item) return;
  event.preventDefault();
  if (event.shiftKey)
    for (const each of noticeList.querySelectorAll('.notice:not([hidden])')) dismissNotice(each);
  else dismissNotice(item);
});
new ResizeObserver(layoutNotices).observe(noticeList);
for (const card of noticeList.querySelectorAll('.notice-card')) card.setAttribute('aria-expanded', 'false');
showNotices('mixed', 'Wszystkie');

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
let paused = false;
// Only a preview on screen paints; a card scrolled under the fold or hidden costs nothing.
const visible = new WeakSet();
const watcher = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) visible.add(entry.target);
    else visible.delete(entry.target);
  }
});
function canvasFor(element, kind) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  canvas.className = kind;
  canvas.setAttribute('aria-hidden', 'true');
  element.replaceWith(canvas);
  return canvas;
}
/* The feet stand at the usual line, or lower on a covered notice card so the figure's middle meets the
   middle of the card's visible strip, stopping short of the bottom edge (canvas px). */
const FEET_LINE = 150;
const FEET_LINE_MAX = CANVAS - 6;
const FIGURE_SCALE = 3.2;
function feetLine(canvas, frames) {
  const notice = canvas.closest('.notice');
  if (notice === null || !notice.closest('.notices').classList.contains('stacked')) return FEET_LINE;
  const covered = parseFloat(getComputedStyle(notice).getPropertyValue('--covered')) || 0;
  const perPx = CANVAS / canvas.clientHeight;
  const visible = (notice.clientHeight - covered) * perPx;
  let top = 0;
  for (const frame of frames) if (frame) top = Math.min(top, frame.offsetY * FIGURE_SCALE);
  return Math.min(Math.max(FEET_LINE, CANVAS - visible / 2 - top / 2), FEET_LINE_MAX);
}
async function mountCharacter(slot) {
  const canvas = canvasFor(slot, 'settler-preview');
  const { layers, frames } = await character(Number(slot.dataset.settler));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  const scale = FIGURE_SCALE;
  const paint = (time) => {
    // Review-only walk loop; not the subject's live simulation activity or timing.
    const index = reduced.matches ? 0 : Math.floor(time / (1000 / REVIEW_FPS)) % frames.length;
    const feetY = feetLine(
      canvas,
      layers.map((layer) => layer.frames.get(frames[index])),
    );
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
        feetY + frame.offsetY * scale,
        r.width * scale,
        r.height * scale,
      );
    }
  };
  paint(0);
  watcher.observe(canvas);
  animations.push({ canvas, paint });
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
// The clock stops with the pause, so a settler holds its current frame instead of walking on.
let clock = 0;
let last = 0;
function animate(time) {
  if (!paused) clock += time - last;
  last = time;
  if (!document.hidden && !paused)
    for (const { canvas, paint } of animations) if (visible.has(canvas)) paint(clock);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
