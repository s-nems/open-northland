// F · Raport boczny: the briefing docks at the right edge as a tall side panel, so the map stays in
// view beside it, and a compact goal tracker stays on the HUD while the panel is closed.

const ICON = {
  play: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13" stroke-width="3"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4v4h4"/></svg>',
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  up: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 15 7-7 7 7"/></svg>',
  dock: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM14 5v14M16.5 9h1.5M16.5 12h1.5"/></svg>',
  star: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="currentColor" stroke="none"/></svg>',
  eye: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
};

const MISSION_ART = (size) =>
  `<span class="on-icon" aria-hidden="true" style="width:${size}px;height:${size}px;background-size:${size * 3}px ${size * 3}px;background-position:0 -${size}px"></span>`;

const SMALL_WORDS = new Set(['i', 'w', 'z', 'na', 'do', 'od', 'po', 'o', 'u', 'a', 'we', 'ze', 'dla', 'przez', 'oraz']);
/** A readable chapter title: the pages shout in capitals, and some carry none at all. */
function chapterTitle(page, index) {
  const t = page.title;
  if (!t || t === '\u2014') return `Rozdział ${index + 1}`;
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/(^|[-„"(])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())))
    .join('');
}

const THUMB = { w: 112, h: 88 };
/** A world view as a small thumbnail: the harness's full-size crop, scaled down whole. */
function thumbStyle(lib, map, icon) {
  const full = lib.mapViewStyle(map, icon, 280, 220);
  const [, x, y] = full.match(/-(\d+)px -(\d+)px/) ?? [0, 0, 0];
  const s = THUMB.w / 280;
  return `background:#223 url(${lib.worldUrl(map)}) -${Math.round(x * s)}px -${Math.round(y * s)}px / ${Math.round(1365 * s)}px ${Math.round(768 * s)}px no-repeat`;
}

/** Update view: the last done goal was just completed and the first idle one just appeared. */
function updatedGoals(goals) {
  const list = goals.map((g) => ({ ...g }));
  let doneAt = list.map((g) => g.state).lastIndexOf('done');
  if (doneAt < 0) {
    doneAt = list.findIndex((g) => g.state === 'open');
    if (doneAt >= 0) list[doneAt].state = 'done';
  }
  if (doneAt >= 0) list[doneAt].justDone = true;
  const fresh = list.findIndex((g) => g.state === 'idle');
  if (fresh >= 0) Object.assign(list[fresh], { state: 'open', isNew: true });
  return list;
}

const tally = (goals) => ({ done: goals.filter((g) => g.state === 'done').length, all: goals.length });

// Mockup-local state: which tab, which chapter, whether the panel is docked or folded to the tracker.
const local = { key: '', tab: 'report', chapter: 0, open: true, folded: false, playing: false, camera: null };

function syncLocal(ctx) {
  const key = `${ctx.view}|${ctx.map}|${ctx.pageIndex}`;
  if (local.key === key) return;
  Object.assign(local, {
    key,
    tab: { goals: 'goals', history: 'journal' }[ctx.view] ?? 'report',
    chapter: ctx.pages.length - 1,
    open: ctx.view !== 'update',
    folded: false,
    playing: ctx.view === 'arrival',
    camera: null,
  });
}

function segments(lib, map, segs) {
  const out = [];
  // The first face on the page speaks from the left, every other face answers from the right.
  const firstFace = segs.find((s) => s.kind === 'speech' && s.portrait)?.portrait;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const text = (t) => lib.esc(t).replace(/\n/g, '<br>');
    switch (s.kind) {
      case 'heading':
        out.push(`<h4 class="fr-heading">${lib.esc(s.text)}</h4>`);
        break;
      case 'para':
        out.push(`<p class="fr-para">${text(s.text)}</p>`);
        break;
      case 'speech':
        out.push(
          s.portrait
            ? `<div class="fr-quote${s.portrait === firstFace ? '' : ' fr-quote--answer'}"><span class="fr-quote__face"><img src="${s.portrait}" alt=""></span><p class="fr-quote__text">${text(s.text.replace(/^["„”«»]|["„”«»]\s*$/g, ''))}</p></div>`
            : `<p class="fr-speech"><b>${lib.esc(s.speaker)}</b>${text(s.text)}</p>`,
        );
        break;
      case 'picture':
        out.push(`<figure class="fr-figure"><img src="${s.src}" alt=""></figure>`);
        break;
      case 'mapview': {
        const views = [s];
        while (segs[i + 1]?.kind === 'mapview') views.push(segs[++i]);
        out.push(
          `<div class="fr-views">${views
            .map(
              (v) =>
                `<button type="button" class="fr-view" data-view-at="${v.icon[1]},${v.icon[2]}" style="${thumbStyle(lib, map, v.icon)}" aria-label="Pokaż na mapie"><span class="fr-view__tag">${lib.GLYPH.pin}Pokaż</span></button>`,
            )
            .join('')}</div>`,
        );
        break;
      }
      case 'signature':
        out.push(`<p class="fr-signature">~ ${lib.esc(s.text)} ~</p>`);
        break;
      default:
    }
  }
  return out.join('');
}

function reportTab(ctx) {
  const { lib } = ctx;
  const n = ctx.pages.length;
  const i = Math.min(local.chapter, n - 1);
  const page = ctx.pages[i];
  const latest = i === n - 1;
  const fresh = ctx.view === 'arrival' && latest;
  return `
    <div class="fr-chapterbar">
      <button type="button" class="on-button fr-step" data-step="-1" ${i === 0 ? 'disabled' : ''} aria-label="Poprzedni rozdział">${lib.GLYPH.back}</button>
      <div class="fr-chapterbar__label">
        <span class="fr-chapterbar__n"><b>Rozdział ${i + 1}</b> z ${n}</span>
        <span class="fr-chapterbar__time">${fresh ? '<em class="fr-new">Nowy</em>' : ''}otrzymano ${lib.receivedAt(i)}</span>
      </div>
      <button type="button" class="on-button fr-step" data-step="1" ${latest ? 'disabled' : ''} aria-label="Następny rozdział">${lib.GLYPH.next}</button>
    </div>
    <article class="on-parchment fr-sheet">
      <header class="fr-sheet__head">
        <h3 class="fr-title">${lib.esc(chapterTitle(page, i))}</h3>
        <div class="fr-voice${local.playing ? ' is-playing' : ''}">
          <button type="button" class="on-medallion fr-voice__play" data-voice aria-label="${local.playing ? 'Wstrzymaj narrację' : 'Odtwórz narrację'}">${local.playing ? ICON.pause : ICON.play}</button>
          <span class="fr-voice__track"><span class="fr-voice__fill"></span></span>
          <span class="fr-voice__time">${local.playing ? '0:14' : '0:00'} / 1:32</span>
          <button type="button" class="fr-voice__again" aria-label="Od początku">${ICON.replay}</button>
        </div>
      </header>
      ${segments(lib, ctx.map, page.segments)}
    </article>`;
}

function goalRow(lib, g) {
  const cls = ['fr-goal', `is-${g.state}`, g.emphasis ? 'is-main' : ''].join(' ');
  return `<li class="${cls}"><span class="fr-box" aria-hidden="true">${g.state === 'done' ? ICON.check : ''}</span><span class="fr-goal__text">${lib.esc(lib.goalText(g))}${
    g.emphasis ? '<em class="fr-main">Główny</em>' : ''
  }</span></li>`;
}

function goalsTab(ctx) {
  const { lib, goals } = ctx;
  const { done, all } = tally(goals);
  const group = (state, label) => {
    const rows = goals.filter((g) => g.state === state);
    return rows.length === 0
      ? ''
      : `<p class="on-parchment__note">${label}<span class="fr-note-count">${rows.length}</span></p><ul class="fr-goals">${rows.map((g) => goalRow(lib, g)).join('')}</ul>`;
  };
  return `
    <div class="on-parchment fr-sheet fr-sheet--goals">
      <div class="fr-progress">
        <span class="fr-progress__big">${done}<small> / ${all}</small></span>
        <span class="fr-progress__label">celów misji wykonanych</span>
        <span class="fr-progress__bar"><span style="width:${(done / all) * 100}%"></span></span>
      </div>
      ${group('open', 'Aktywne')}
      ${group('idle', 'Jeszcze nieaktywne')}
      ${group('done', 'Wykonane')}
      <label class="fr-pin"><input type="checkbox" checked> Pokazuj aktywne cele na ekranie, gdy raport jest zamknięty</label>
    </div>`;
}

function journalTab(ctx) {
  const { lib } = ctx;
  const rows = ctx.pages
    .map((p, i) => {
      const latest = i === ctx.pages.length - 1;
      return `<li><button type="button" class="fr-entry${latest ? ' is-latest' : ''}" data-open-chapter="${i}">
        <span class="fr-entry__dot" aria-hidden="true"></span>
        <span class="fr-entry__n">${i + 1}</span>
        <span class="fr-entry__title">${lib.esc(chapterTitle(p, i))}</span>
        <span class="fr-entry__time">${lib.receivedAt(i)}${latest ? ' · najnowszy' : ''}</span>
      </button></li>`;
    })
    .reverse()
    .join('');
  return `
    <div class="on-parchment fr-sheet fr-sheet--journal">
      <p class="on-parchment__note">Otrzymane rozdziały<span class="fr-note-count">${ctx.pages.length}</span></p>
      <ol class="fr-journal">${rows}</ol>
      <a class="fr-wiedza" href="#" data-wiedza>Tablice historyczne ${lib.GLYPH.next} Wiedza</a>
    </div>`;
}

function panel(ctx) {
  const { lib } = ctx;
  const { done, all } = tally(ctx.goals);
  const paused = ctx.view === 'arrival';
  const tab = (id, label, extra = '') =>
    `<button type="button" role="tab" class="on-tab" data-tab="${id}" aria-selected="${local.tab === id}">${label}${extra}</button>`;
  const body = { report: reportTab, goals: goalsTab, journal: journalTab }[local.tab](ctx);
  const foot = paused
    ? `<span class="fr-state fr-state--paused">${ICON.pause}Gra wstrzymana na czas lektury</span><button type="button" class="on-button fr-go" data-close>Wznów grę</button>`
    : `<span class="fr-state"><span class="fr-state__dot"></span>Gra toczy się dalej</span><button type="button" class="on-button on-button--accent fr-fold" data-close>${ICON.dock}Zwiń do celów</button>`;
  return `
    <section class="on-window on-panel fr-panel${paused ? ' is-arrival' : ''}" aria-label="Misja">
      ${lib.ORNAMENTS}
      <header class="on-window__head fr-head">
        <div class="on-window__heading">${MISSION_ART(40)}<div>
          <p class="on-window__kicker">${lib.esc(lib.missionName(ctx.mission))}</p>
          <h2 class="on-window__title">Misja</h2>
        </div></div>
        <button type="button" class="on-medallion on-window__close" data-close aria-label="Zamknij">${lib.GLYPH.close}</button>
      </header>
      <div class="on-tabs fr-tabs" role="tablist">
        ${tab('report', 'Raport')}
        ${tab('goals', 'Cele', `<span class="on-tab__count">${done}/${all}</span>`)}
        ${tab('journal', 'Dziennik', `<span class="on-tab__count">${ctx.pages.length}</span>`)}
      </div>
      <div class="fr-body">${body}</div>
      <footer class="fr-foot">${foot}</footer>
    </section>`;
}

function tracker(ctx) {
  const { lib } = ctx;
  const update = ctx.view === 'update';
  const goals = update ? updatedGoals(ctx.goals) : ctx.goals;
  const { done, all } = tally(goals);
  const shown = goals.filter((g) => g.state === 'open' || g.justDone);
  const rows = shown
    .map((g) => {
      const cls = ['fr-track__row', g.justDone ? 'is-done-now' : '', g.isNew ? 'is-new' : '', g.emphasis ? 'is-main' : ''].join(' ');
      return `<li class="${cls}"><span class="fr-box" aria-hidden="true">${g.justDone ? ICON.check : ''}</span><span class="fr-track__text"><span>${lib.esc(lib.goalText(g))}</span></span>${
        g.isNew ? '<em class="fr-track__badge">Nowy cel</em>' : ''
      }${g.justDone ? '<em class="fr-track__badge fr-track__badge--done">Wykonano</em>' : ''}</li>`;
    })
    .join('');
  return `
    <aside class="fr-track${local.folded ? ' is-folded' : ''}${update ? ' is-update' : ''}" aria-label="Cele misji">
      <header class="fr-track__head">
        <button type="button" class="fr-track__fold" data-fold aria-expanded="${!local.folded}">
          ${MISSION_ART(26)}
          <span class="fr-track__title">Cele</span>
          <span class="fr-track__count"><b>${done}</b>/${all}</span>
          <span class="fr-track__chev">${ICON.up}</span>
        </button>
        <button type="button" class="on-medallion fr-track__open" data-open aria-label="Otwórz raport misji">${ICON.dock}</button>
      </header>
      <ol class="fr-track__list">${rows}</ol>
    </aside>`;
}

export default {
  id: 'f',
  name: 'Raport boczny',
  blurb:
    'Misja nie zasłania świata: raport otwiera się jako wysoki panel przy prawej krawędzi, mapa obok zostaje widoczna i grywalna, a widoki świata to miniatury, które przesuwają kamerę. Po zamknięciu zostaje mały tropiciel celów pod paskiem, który sam pokazuje wykonany i nowy cel.',
  css: 'f-raport.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    syncLocal(ctx);
    const paused = ctx.view === 'arrival' && local.open;
    const camera = local.camera
      ? `<div class="fr-camera" style="left:${local.camera.x}px;top:${local.camera.y}px"><span></span><em>Kamera tutaj</em></div>`
      : '';
    return `<div class="fr-root">
      ${paused ? `<div class="fr-pausewash"></div><div class="fr-pausepill">${ICON.pause}<span><b>Pauza</b> · nowy rozdział misji</span></div>` : ''}
      ${camera}
      ${local.open ? panel(ctx) : tracker(ctx)}
    </div>`;
  },
  mount(root, ctx, rerender) {
    const on = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => (e.preventDefault(), fn(el))));
    on('[data-tab]', (el) => ((local.tab = el.dataset.tab), rerender()));
    on('[data-step]', (el) => ((local.chapter = Math.max(0, local.chapter + Number(el.dataset.step))), rerender()));
    on('[data-open-chapter]', (el) => ((local.chapter = Number(el.dataset.openChapter)), (local.tab = 'report'), rerender()));
    on('[data-close]', () => ((local.open = false), (local.playing = false), rerender()));
    on('[data-open]', () => ((local.open = true), (local.tab = 'report'), rerender()));
    on('[data-fold]', () => ((local.folded = !local.folded), rerender()));
    on('[data-voice]', () => ((local.playing = !local.playing), rerender()));
    on('[data-view-at]', (el) => {
      // In game the camera centres on the node; here a marker shows where it went.
      const [a, b] = el.dataset.viewAt.split(',').map(Number);
      local.camera = { x: 240 + ((a * 7) % 560), y: 150 + ((b * 5) % 380) };
      rerender();
    });
  },
};
