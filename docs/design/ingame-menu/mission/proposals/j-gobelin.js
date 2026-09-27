// J · Gobelin: the campaign as a woven hanging in the Bayeux manner. Each received briefing is one
// scene on the strip across the window's top; the picked scene reads below on linen, the goals run
// down an embroidered side band. The Kronika tab hangs the whole tapestry in rows.

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (i) => ROMAN[i] ?? String(i + 1);
/** The title `lib.analysePage` gives a page without one. */
const UNTITLED = '\u2014';
const TABS = [
  ['story', 'Opowieść'],
  ['goals', 'Cele'],
  ['history', 'Kronika'],
];
const TAB_OF_VIEW = { arrival: 'story', task: 'story', goals: 'goals', history: 'history' };
const WINDOW = { x: 190, y: 64, w: 985, h: 620 };
const VIGNETTE = { w: 128, h: 74 };
const HANG = { w: 164, h: 92 };
const INLINE_VIEW = { w: 200, h: 126 };
const EXCERPT_CHARS = 150;
/** Wool shades of the generated border band, reused for stitched marks. */
const WOOL = ['#a8492f', '#c89a3c', '#7f8f62', '#3c4a57'];

const SVG = {
  play: '<svg viewBox="0 0 20 20" class="gb-ico"><path d="M6 4l10 6-10 6z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 20 20" class="gb-ico"><path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" fill="currentColor"/></svg>',
  replay:
    '<svg viewBox="0 0 20 20" class="gb-ico"><path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 3.2v4.3h4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 20 20" class="gb-ico"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 20 20" class="gb-ico"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // A stitched tick: a dashed stroke over a faint running thread reads as needlework.
  stitch:
    '<svg viewBox="0 0 24 24" class="gb-stitch" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3.2 1.6"/></svg>',
  ring: '<svg viewBox="0 0 24 24" class="gb-stitch" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="2.6 2"/></svg>',
  needle:
    '<svg viewBox="0 0 40 40" class="gb-needle" aria-hidden="true"><path d="M6 34L33 7" stroke="#d8d2c4" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="30.5" cy="9.5" rx="3.2" ry="1.3" transform="rotate(-45 30.5 9.5)" fill="none" stroke="#8a8378" stroke-width="1"/><path d="M31 9c6 4 2 12-6 14s-12 8-10 14" fill="none" stroke="#a8492f" stroke-width="1.6"/></svg>',
};

/** Hand-drawn Bayeux-like motifs for a scene with no picture: a longship, a hall, a tree. */
const MOTIFS = [
  `<svg viewBox="0 0 132 80" class="gb-motif" aria-hidden="true"><path d="M14 52c16 12 88 12 104 0" fill="${WOOL[0]}" stroke="#3c2a1a" stroke-width="1.5"/><path d="M14 52c-4-10-2-18 4-22 3 3 1 7-2 8" fill="none" stroke="${WOOL[3]}" stroke-width="3" stroke-linecap="round"/><path d="M118 52c4-10 2-18-4-22-3 3-1 7 2 8" fill="none" stroke="${WOOL[3]}" stroke-width="3" stroke-linecap="round"/><path d="M66 50V12" stroke="#3c2a1a" stroke-width="2"/><path d="M46 16h40l-4 26H50z" fill="${WOOL[1]}" stroke="#3c2a1a" stroke-width="1.5"/><path d="M52 16l2 26M60 16v26M68 16v26M76 16l-1 26" stroke="${WOOL[0]}" stroke-width="3"/><circle cx="34" cy="54" r="4" fill="${WOOL[2]}"/><circle cx="48" cy="56" r="4" fill="${WOOL[1]}"/><circle cx="84" cy="56" r="4" fill="${WOOL[2]}"/><circle cx="98" cy="54" r="4" fill="${WOOL[1]}"/><path d="M4 70c10-4 18 4 28 0s18-4 28 0 18 4 28 0 18-4 28 0 10 2 14 0" fill="none" stroke="${WOOL[3]}" stroke-width="2.4"/></svg>`,
  `<svg viewBox="0 0 132 80" class="gb-motif" aria-hidden="true"><path d="M30 68V38h72v30" fill="${WOOL[1]}" stroke="#3c2a1a" stroke-width="1.5"/><path d="M24 40l42-24 42 24z" fill="${WOOL[0]}" stroke="#3c2a1a" stroke-width="1.5"/><path d="M34 32l32-18 32 18" fill="none" stroke="${WOOL[3]}" stroke-width="2" stroke-dasharray="3 2"/><path d="M58 68V52a8 8 0 0 1 16 0v16" fill="${WOOL[3]}"/><path d="M40 46h10v8H40zM82 46h10v8H82z" fill="${WOOL[2]}"/><path d="M24 16c-3-4 1-8 4-6M108 16c3-4-1-8-4-6" fill="none" stroke="${WOOL[3]}" stroke-width="2.4" stroke-linecap="round"/><path d="M8 70h116" stroke="${WOOL[2]}" stroke-width="3"/></svg>`,
  `<svg viewBox="0 0 132 80" class="gb-motif" aria-hidden="true"><path d="M66 72V30" stroke="#5a3d24" stroke-width="5"/><path d="M66 50c-10-6-18-6-26-14M66 44c10-6 18-8 26-16" fill="none" stroke="#5a3d24" stroke-width="3"/><path d="M66 8c-22 0-30 14-30 22 0 6 8 10 14 8 4 6 28 6 32 0 6 2 14-2 14-8 0-8-8-22-30-22z" fill="${WOOL[2]}" stroke="#3c2a1a" stroke-width="1.5"/><path d="M50 24c6-8 26-8 32 0M46 32c10-4 30-4 40 0" fill="none" stroke="${WOOL[1]}" stroke-width="2.2" stroke-dasharray="4 2"/><path d="M20 72h92" stroke="${WOOL[0]}" stroke-width="3"/><path d="M26 64c4-6 8-6 12 0M94 64c4-6 8-6 12 0" fill="none" stroke="${WOOL[3]}" stroke-width="2.4"/></svg>`,
];

/** Wool filter: flatten the picture to a few thread shades and fray its edges a little. */
const WOOL_FILTER = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="gb-wool" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feComponentTransfer result="p"><feFuncR type="discrete" tableValues="0.16 0.32 0.5 0.66 0.8 0.92"/><feFuncG type="discrete" tableValues="0.14 0.28 0.45 0.6 0.74 0.86"/><feFuncB type="discrete" tableValues="0.1 0.2 0.32 0.44 0.56 0.7"/></feComponentTransfer>
    <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves="2" seed="4" result="n"/>
    <feDisplacementMap in="p" in2="n" scale="2" xChannelSelector="R" yChannelSelector="G"/>
  </filter></defs></svg>`;

const S = { key: '', tab: 'story', scene: 0, playing: false };

function sync(ctx) {
  const key = `${ctx.map}|${ctx.view}|${ctx.pageIndex}`;
  if (S.key === key) return;
  Object.assign(S, { key, tab: TAB_OF_VIEW[ctx.view] ?? 'story', scene: ctx.pageIndex, playing: false });
}

const niceTitle = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s:(„-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()) : t);
const titleOf = (page, i) => niceTitle(page.title && page.title !== UNTITLED ? page.title : `Scena ${roman(i)}`);

/** The scene's picture: the first free picture or world view, else the first speaker's portrait. */
function artOf(page) {
  const free = page.segments.find((s) => s.kind === 'picture' || s.kind === 'mapview');
  if (free) return free;
  const face = page.segments.find((s) => s.kind === 'speech' && s.portrait);
  return face ? { kind: 'picture', src: face.portrait, width: 164, height: 136 } : null;
}

function vignette(lib, map, page, i, box) {
  const art = artOf(page);
  if (art === null) return `<span class="gb-vig gb-vig--motif">${MOTIFS[i % MOTIFS.length]}</span>`;
  if (art.kind === 'mapview') return `<span class="gb-vig"><span class="gb-vig__wool" style="${lib.mapViewStyle(map, art.icon, box.w, box.h)}"></span></span>`;
  const portrait = art.width <= 200;
  return `<span class="gb-vig${portrait ? ' gb-vig--portrait' : ''}"><img class="gb-vig__wool" src="${art.src}" alt=""></span>`;
}

function strip(ctx) {
  const { lib, map } = ctx;
  const arrival = ctx.view === 'arrival';
  const scenes = ctx.pages
    .map((p, i) => {
      const fresh = arrival && i === ctx.pages.length - 1;
      return `${i > 0 ? '<span class="gb-tree" aria-hidden="true"></span>' : ''}<button type="button" class="gb-scene${fresh ? ' gb-scene--weaving' : ''}" data-scene="${i}" aria-current="${i === S.scene}" aria-label="Scena ${i + 1}: ${lib.esc(titleOf(p, i))}">
        ${vignette(lib, map, p, i, VIGNETTE)}${fresh ? SVG.needle : ''}
        <span class="gb-scene__cap"><b>${roman(i)}</b> ${lib.esc(titleOf(p, i))}</span></button>`;
    })
    .join('');
  const unwoven = `<span class="gb-tree" aria-hidden="true"></span><span class="gb-scene gb-scene--unwoven" aria-hidden="true"><span class="gb-vig">${SVG.needle}</span><span class="gb-scene__cap">ciąg dalszy</span></span>`;
  return `<div class="gb-strip">
    <button type="button" class="gb-strip__arrow gb-strip__arrow--prev" data-roll="-1" aria-label="Przewiń w lewo">${SVG.prev}</button>
    <div class="gb-strip__roll" data-roll-area>${scenes}${unwoven}</div>
    <button type="button" class="gb-strip__arrow gb-strip__arrow--next" data-roll="1" aria-label="Przewiń w prawo">${SVG.next}</button>
  </div>`;
}

function readingHtml(lib, map, page) {
  return page.segments
    .map((s) => {
      switch (s.kind) {
        case 'heading':
          return `<h4 class="gb-sub">${lib.esc(niceTitle(s.text))}</h4>`;
        case 'para':
          return `<p class="gb-p">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`;
        case 'speech':
          return `<div class="gb-say${s.portrait ? ' gb-say--face' : ''}">${s.portrait ? `<img src="${s.portrait}" alt="">` : ''}<p>${s.speaker ? `<b>${lib.esc(s.speaker)}</b>` : ''}${lib.esc(s.text.replace(/^["„”«»]|["„”«»]$/g, ''))}</p></div>`;
        case 'picture':
          return `<figure class="gb-fig${s.width <= 200 ? ' gb-fig--portrait' : ''}"><img src="${s.src}" alt=""></figure>`;
        case 'mapview':
          return `<figure class="gb-fig gb-fig--view"><button type="button" class="gb-view" style="${lib.mapViewStyle(map, s.icon, INLINE_VIEW.w, INLINE_VIEW.h)}" aria-label="Pokaż na mapie"></button><figcaption>${lib.GLYPH.pin}Pokaż na mapie</figcaption></figure>`;
        case 'signature':
          return `<p class="gb-sign">${lib.esc(s.text)}</p>`;
        default:
          return '';
      }
    })
    .join('');
}

function reading(ctx) {
  const { lib, map } = ctx;
  const page = ctx.pages[S.scene];
  const arrival = ctx.view === 'arrival';
  return `<article class="gb-read">
    <header class="gb-read__head">
      <div class="gb-read__title"><p class="gb-kicker">${arrival && S.scene === ctx.pages.length - 1 ? '<span class="gb-new">Nowa scena</span>' : ''}Scena ${roman(S.scene)} · wpleciona w ${lib.receivedAt(S.scene)}</p><h3>${lib.esc(titleOf(page, S.scene))}</h3></div>
      <div class="gb-tools">
        <div class="gb-nav" role="group" aria-label="Sceny">
          <button type="button" class="gb-round" data-step="-1" aria-label="Poprzednia scena" ${S.scene === 0 ? 'disabled' : ''}>${SVG.prev}</button>
          <span class="gb-nav__count">${S.scene + 1} / ${ctx.pages.length}</span>
          <button type="button" class="gb-round" data-step="1" aria-label="Następna scena" ${S.scene === ctx.pages.length - 1 ? 'disabled' : ''}>${SVG.next}</button>
        </div>
        <div class="gb-voice" role="group" aria-label="Narracja">
          <button type="button" class="on-medallion gb-voice__play" data-voice aria-label="${S.playing ? 'Wstrzymaj narrację' : 'Odtwórz narrację'}">${S.playing ? SVG.pause : SVG.play}</button>
          <button type="button" class="gb-round" data-voice-again aria-label="Od początku">${SVG.replay}</button>
        </div>
      </div>
    </header>
    <div class="gb-read__body">${readingHtml(lib, map, page)}</div>
  </article>`;
}

function goalItem(lib, g) {
  const mark = g.state === 'done' ? SVG.stitch : SVG.ring;
  return `<li class="gb-goal gb-goal--${g.state}" style="--wool:${g.state === 'done' ? WOOL[2] : g.state === 'open' ? WOOL[0] : '#8d8472'}">
    <span class="gb-goal__mark">${mark}</span><span class="gb-goal__text">${lib.esc(lib.goalText(g))}${g.emphasis ? '<em>główny</em>' : ''}</span></li>`;
}

function progress(goals) {
  const done = goals.filter((g) => g.state === 'done').length;
  return `<span class="gb-progress" aria-label="Wypełnione ${done} z ${goals.length}">${goals
    .map((g) => `<i class="gb-progress__knot gb-progress__knot--${g.state}"></i>`)
    .join('')}<b>${done} / ${goals.length}</b></span>`;
}

function goalsBand(ctx) {
  const { lib, goals } = ctx;
  const order = [...goals.filter((g) => g.state === 'open'), ...goals.filter((g) => g.state === 'done'), ...goals.filter((g) => g.state === 'idle')];
  return `<aside class="gb-band" aria-label="Cele">
    <header class="gb-band__head"><h3>Cele</h3>${progress(goals)}</header>
    <ul class="gb-goals">${order.map((g) => goalItem(lib, g)).join('')}</ul>
    <button type="button" class="gb-band__more" data-tab="goals">Wszystkie cele ›</button>
  </aside>`;
}

function goalsSampler(ctx) {
  const { lib, goals } = ctx;
  const group = (state, label, note = '') => {
    const list = goals.filter((g) => g.state === state);
    return list.length
      ? `<section class="gb-sampler__col"><h4>${label} <small>${list.length}</small></h4><ul class="gb-goals">${list.map((g) => goalItem(lib, g)).join('')}</ul>${note}</section>`
      : '';
  };
  return `<div class="gb-sampler">
    <header class="gb-sampler__head"><div><p class="gb-kicker">Cele misji</p><h3>${lib.esc(lib.missionName(ctx.mission))}</h3></div>${progress(goals)}</header>
    <div class="gb-sampler__cols">
      ${group('open', 'Do wykonania')}
      ${group('done', 'Wyhaftowane')}
      ${group('idle', 'Jeszcze nie wyszyte', '<p class="gb-note">Te cele pojawią się w kolejnych scenach.</p>')}
    </div>
  </div>`;
}

function excerptOf(page) {
  const text = page.segments
    .filter((s) => s.kind === 'para' || s.kind === 'speech')
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^["„”«»\s-]+/, '');
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).replace(/\s\S*$/, '')}…` : text;
}

function hanging(ctx) {
  const { lib, map } = ctx;
  const scenes = ctx.pages
    .map(
      (p, i) => `<button type="button" class="gb-hang__scene" data-open="${i}" aria-current="${i === ctx.pages.length - 1}">
        <span class="gb-hang__art">${vignette(lib, map, p, i, HANG)}<span class="gb-hang__time">${lib.receivedAt(i)}</span></span>
        <span class="gb-hang__cap"><b>${roman(i)}</b>${lib.esc(titleOf(p, i))}</span>
        <span class="gb-hang__text">${lib.esc(excerptOf(p))}</span></button>`,
    )
    .join('');
  return `<div class="gb-hang">
    <div class="gb-hang__cloth"><div class="gb-hang__grid">${scenes}</div></div>
    <p class="gb-hang__foot"><span>Kliknij scenę, aby ją przeczytać. Kronika rośnie z każdym rozdziałem misji.</span><button type="button" class="gb-link">Tablice historyczne → Wiedza</button></p>
  </div>`;
}

function tabs(ctx) {
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  return `<div class="on-tabs gb-tabs" role="tablist">${TABS.map(
    ([id, label]) =>
      `<button type="button" role="tab" class="on-tab" data-tab="${id}" aria-selected="${S.tab === id}">${label}${
        id === 'goals' ? `<span class="on-tab__count">${done}/${ctx.goals.length}</span>` : id === 'history' ? `<span class="on-tab__count">${ctx.pages.length}</span>` : ''
      }</button>`,
  ).join('')}${
    ctx.view === 'arrival'
      ? `<span class="gb-paused"><i></i>Gra wstrzymana</span><button type="button" class="on-button on-button--accent gb-resume" data-close>${SVG.play}Wróć do gry</button>`
      : '<span class="gb-running">Gra toczy się dalej</span>'
  }</div>`;
}

function windowHtml(ctx) {
  const { lib } = ctx;
  let body;
  if (S.tab === 'history') body = hanging(ctx);
  else if (S.tab === 'goals') body = `${strip(ctx)}<div class="gb-lower">${goalsSampler(ctx)}</div>`;
  else body = `${strip(ctx)}<div class="gb-lower gb-lower--story">${reading(ctx)}${goalsBand(ctx)}</div>`;
  return lib.hudWindow({
    title: 'Misja',
    kicker: lib.missionName(ctx.mission),
    width: WINDOW.w,
    cls: `gb-win gb-win--${S.tab}${ctx.view === 'arrival' ? ' gb-win--arrival' : ''}`,
    style: `left:${WINDOW.x}px;top:${WINDOW.y}px;height:${WINDOW.h}px`,
    body: `${tabs(ctx)}${body}`,
  });
}

function patch(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done');
  const open = goals.filter((g) => g.state === 'open');
  const justDone = done.at(-1);
  const fresh = open.at(-1);
  return `<aside class="gb-patch" aria-label="Aktualizacja celów">
    <span class="gb-patch__band" aria-hidden="true"></span>
    <div class="gb-patch__body">
      ${justDone ? `<p class="gb-patch__row gb-patch__row--done">${SVG.stitch}<span><em>Cel wyhaftowany</em>${lib.esc(lib.goalText(justDone))}</span></p>` : ''}
      ${fresh ? `<p class="gb-patch__row gb-patch__row--new">${SVG.ring}<span><em>Nowy cel</em>${lib.esc(lib.goalText(fresh))}</span></p>` : ''}
      <footer>${progress(goals)}<button type="button" class="gb-patch__open">Misja <kbd class="on-key">M</kbd></button></footer>
    </div>
  </aside>
  <span class="gb-beam-thread" aria-hidden="true"></span>`;
}

function scene(ctx) {
  sync(ctx);
  if (ctx.view === 'update') return `<div class="gb-scene-root">${patch(ctx)}</div>`;
  const arrival = ctx.view === 'arrival';
  return `<div class="gb-scene-root">${WOOL_FILTER}${arrival ? '<div class="gb-dim"></div>' : ''}${windowHtml(ctx)}</div>`;
}

export default {
  id: 'j',
  name: 'Gobelin',
  blurb:
    'Historia kampanii jako tkanina w stylu z Bayeux: każdy otrzymany briefing to wyszyta scena na pasie u góry okna, bieżąca świeci, kliknięcie otwiera ją do czytania na lnie poniżej. Cele biegną wyhaftowanym pasem z boku, a zakładka Kronika rozwiesza całą tkaninę w rzędach, więc gracz od razu widzi, jak daleko zaszła opowieść.',
  css: 'j-gobelin.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render: scene,
  mount(root, ctx) {
    const refresh = () => {
      root.querySelector('.gb-scene-root').outerHTML = scene(ctx);
      wire();
    };
    const wire = () => {
      const roll = root.querySelector('[data-roll-area]');
      // Centre the picked scene once the proposal stylesheet has given the strip its size.
      const centre = () => {
        const current = root.querySelector('.gb-scene[aria-current="true"]');
        if (roll && current && roll.isConnected) roll.scrollLeft = current.offsetLeft - (roll.clientWidth - current.offsetWidth) / 2;
      };
      centre();
      document.querySelector('[data-proposal-css]')?.addEventListener('load', centre, { once: true });
      if (roll) new ResizeObserver(centre).observe(roll);
      root.querySelectorAll('[data-roll]').forEach((b) =>
        b.addEventListener('click', () => roll.scrollBy({ left: Number(b.dataset.roll) * 320, behavior: 'smooth' })),
      );
      root.querySelectorAll('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          S.tab = b.dataset.tab;
          refresh();
        }),
      );
      root.querySelectorAll('[data-scene]').forEach((b) =>
        b.addEventListener('click', () => {
          S.scene = Number(b.dataset.scene);
          refresh();
        }),
      );
      root.querySelectorAll('[data-open]').forEach((b) =>
        b.addEventListener('click', () => {
          Object.assign(S, { tab: 'story', scene: Number(b.dataset.open) });
          refresh();
        }),
      );
      root.querySelectorAll('[data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          S.scene = Math.max(0, Math.min(ctx.pages.length - 1, S.scene + Number(b.dataset.step)));
          refresh();
        }),
      );
      root.querySelector('[data-voice]')?.addEventListener('click', () => {
        S.playing = !S.playing;
        refresh();
      });
      root.querySelector('[data-voice-again]')?.addEventListener('click', () => {
        S.playing = true;
        refresh();
      });
    };
    wire();
  },
};
