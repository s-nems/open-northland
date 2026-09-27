// K · Karta: the least intrusive briefing. A new chapter arrives as a compact card under the top edge
// (title, a short lead, the new goals as chips); "Czytaj całość" grows the same card into the full
// reading window, and the beam's Misja opens it grown.

const LEAD_CHARS = 230;
const NEW_GOAL_CHIPS = 2;
const PORTRAIT_MAX_W = 200;
/** The harness mounts on every re-render into the same element; the previous listener goes first. */
let detach = null;

const ICON = {
  play: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/></svg>',
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  flag: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 21V4M6 5h11l-3 4 3 4H6"/></svg>',
  next: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  prev: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  expand: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 9h14M5 13h14M5 17h9"/></svg>',
  eye: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function leadOf(page) {
  const first = page.segments.find((s) => s.kind === 'para' || s.kind === 'speech');
  if (!first) return '';
  const text = first.kind === 'speech' && first.speaker ? `${first.speaker}: ${first.text}` : first.text;
  return text.length > LEAD_CHARS ? `${text.slice(0, text.lastIndexOf(' ', LEAD_CHARS))}…` : text;
}

function emblemOf(ctx, page) {
  const face = page.segments.find((s) => (s.kind === 'speech' && s.portrait) || (s.kind === 'picture' && s.width <= PORTRAIT_MAX_W));
  if (face) return `<span class="kc-emblem kc-emblem--face"><img src="${face.portrait ?? face.src}" alt=""></span>`;
  const view = page.segments.find((s) => s.kind === 'mapview');
  if (view) return `<span class="kc-emblem kc-emblem--view"><span style="${ctx.lib.mapViewStyle(ctx.map, view.icon, 110, 90)}"></span></span>`;
  return `<span class="kc-emblem kc-emblem--seal">${ICON.flag}</span>`;
}

function goalCounts(goals) {
  const done = goals.filter((g) => g.state === 'done').length;
  return { done, total: goals.length };
}

function segmentHtml(ctx, s) {
  const { lib } = ctx;
  switch (s.kind) {
    case 'heading':
      return `<h4 class="kc-sub">${lib.esc(s.text)}</h4>`;
    case 'para':
      return `<p class="kc-para">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`;
    case 'speech':
      return `<div class="kc-speech">${s.portrait ? `<img src="${s.portrait}" alt="">` : ''}<p>${s.speaker ? `<b>${lib.esc(s.speaker)}</b>` : ''}${lib.esc(s.text)}</p></div>`;
    case 'picture':
      return `<figure class="kc-picture"><img src="${s.src}" alt="" style="max-width:${Math.min(s.width, 320)}px"></figure>`;
    case 'views':
      return `<div class="kc-views">${s.items
        .map((v, i) => `<button type="button" class="kc-view" data-view="${i}"><span style="${lib.mapViewStyle(ctx.map, v.icon, 196, 120)}"></span><em>${ICON.eye}Pokaż na mapie</em></button>`)
        .join('')}</div>`;
    case 'signature':
      return `<p class="kc-signature">${lib.esc(s.text)}</p>`;
    default:
      return '';
  }
}

/** Neighbouring world views gather into one strip, so a page with five reads as one gallery. */
function groupViews(segments) {
  const out = [];
  for (const s of segments) {
    if (s.kind === 'mapview') {
      const last = out.at(-1);
      if (last?.kind === 'views') last.items.push(s);
      else out.push({ kind: 'views', items: [s] });
    } else out.push(s);
  }
  return out;
}

function storyHtml(ctx, local) {
  const { lib, pages } = ctx;
  const page = lib.analysePage(ctx.mission.pages[local.shown]);
  return `<div class="kc-voice" role="group" aria-label="Narracja"><button type="button" class="on-medallion kc-voice__play" data-voice aria-label="Odtwórz narrację">${ICON.play}</button><span class="kc-voice__label">Narracja</span><span class="kc-voice__track"><i></i></span><span class="kc-voice__time">0:00 / 1:12</span><button type="button" class="kc-icon-btn" aria-label="Od początku">${ICON.replay}</button></div>
    <h3 class="kc-page-title">${lib.esc(page.title)}</h3>
    <div class="kc-text">${groupViews(page.segments).map((s) => segmentHtml(ctx, s)).join('')}</div>
    ${local.shown < pages.length - 1 ? `<button type="button" class="kc-later" data-step="1">Dalej: ${lib.esc(pages[local.shown + 1].title)} ${ICON.next}</button>` : ''}`;
}

function goalsHtml(ctx) {
  const { lib, goals } = ctx;
  const { done, total } = goalCounts(goals);
  const group = (state, label) => {
    const rows = goals.filter((g) => g.state === state);
    if (!rows.length) return '';
    return `<p class="kc-group">${label}<span>${rows.length}</span></p><ul class="kc-checklist">${rows
      .map((g) => `<li class="is-${state}${g.emphasis ? ' is-main' : ''}"><span class="kc-box">${state === 'done' ? ICON.check : ''}</span><span>${lib.esc(lib.goalText(g))}${g.emphasis ? '<small>Główny cel</small>' : ''}</span></li>`)
      .join('')}</ul>`;
  };
  return `<div class="kc-progress"><span class="kc-progress__bar"><i style="width:${(done / total) * 100}%"></i></span><span><b>${done}</b> z ${total} wykonanych</span></div>${group('open', 'Do zrobienia')}${group('done', 'Wykonane')}${group('idle', 'Później')}`;
}

function historyHtml(ctx, local) {
  const { lib, pages } = ctx;
  return `<ol class="kc-journal">${pages
    .map((p, i) => `<li><button type="button" class="kc-entry${i === local.shown ? ' is-shown' : ''}" data-open="${i}"><span class="kc-entry__n">${i + 1}</span><span class="kc-entry__title">${lib.esc(p.title)}</span><span class="kc-entry__time">${lib.receivedAt(i)}</span></button></li>`)
    .reverse()
    .join('')}</ol><a href="#" class="kc-tables" data-tables>Tablice historyczne ${ICON.next} Wiedza</a>`;
}

function cardHtml(ctx, local) {
  const { lib, goals, pages } = ctx;
  const latest = pages.length - 1;
  const page = lib.analysePage(ctx.mission.pages[latest]);
  const { done, total } = goalCounts(goals);
  const open = goals.filter((g) => g.state === 'open');
  const fresh = open.slice(-NEW_GOAL_CHIPS);
  const tab = (id, label, count) =>
    `<button type="button" role="tab" class="on-tab" data-tab="${id}" aria-selected="${local.tab === id}">${label}${count ? `<span class="on-tab__count">${count}</span>` : ''}</button>`;
  const panel = local.tab === 'goals' ? goalsHtml(ctx) : local.tab === 'history' ? historyHtml(ctx, local) : storyHtml(ctx, local);
  const paused = local.arrival
    ? `<span class="kc-paused" title="Skrypt misji wstrzymał grę">${ICON.pause}Pauza</span>`
    : '';
  const pager = `<div class="kc-pager"><button type="button" class="kc-icon-btn" data-step="-1" aria-label="Poprzedni rozdział" ${local.shown === 0 ? 'disabled' : ''}>${ICON.prev}</button><span>Rozdział ${local.shown + 1} / ${pages.length}</span><button type="button" class="kc-icon-btn" data-step="1" aria-label="Następny rozdział" ${local.shown === latest ? 'disabled' : ''}>${ICON.next}</button></div>`;
  return `<section class="on-window on-panel kc-card${local.open ? ' is-open' : ''}${local.arrival ? ' is-arrival' : ''}" aria-label="Misja">${lib.ORNAMENTS}
    ${lib.closeMedallion('on-window__close kc-close')}
    <div class="kc-compact" ${local.open ? 'inert' : ''}>
      <p class="kc-kicker">Nowy rozdział · ${latest + 1}${paused}</p>
      <div class="kc-headline">${emblemOf(ctx, page)}<div><h2 class="kc-title">${lib.esc(page.title)}</h2><p class="kc-mission">${lib.esc(lib.missionName(ctx.mission))}</p></div></div>
      <p class="kc-lead">${lib.esc(leadOf(page))}</p>
      ${fresh.length ? `<div class="kc-chips"><span class="kc-chips__label">Nowe cele</span>${fresh.map((g) => `<span class="kc-chip">${ICON.flag}${lib.esc(lib.goalText(g))}</span>`).join('')}</div>` : ''}
      <div class="kc-actions"><button type="button" class="on-medallion kc-voice__play kc-voice__play--small" data-voice aria-label="Odtwórz narrację">${ICON.play}</button><button type="button" class="on-button kc-read" data-expand>${ICON.expand}Czytaj całość</button><button type="button" class="on-button kc-go" data-continue>Kontynuuj ${ICON.next}</button></div>
    </div>
    <div class="kc-full" ${local.open ? '' : 'inert'}>
      <header class="kc-full__head"><div><p class="kc-kicker">Misja · ${lib.esc(lib.missionName(ctx.mission))}${paused}</p><h2 class="kc-title">${local.tab === 'goals' ? 'Cele' : local.tab === 'history' ? 'Dziennik' : `Rozdział ${local.shown + 1}`}<small>${local.tab === 'story' ? lib.receivedAt(local.shown) : local.tab === 'goals' ? `${done} / ${total}` : `${pages.length} wpisów`}</small></h2></div></header>
      <div class="on-tabs kc-tabs" role="tablist">${tab('story', 'Opowieść')}${tab('goals', 'Cele', `${done}/${total}`)}${tab('history', 'Dziennik', pages.length)}</div>
      <div class="kc-paper">${panel}</div>
      <footer class="kc-foot">${local.tab === 'story' ? pager : '<span></span>'}${local.arrival ? `<button type="button" class="on-button kc-go" data-continue>Kontynuuj ${ICON.next}</button>` : '<span class="kc-running">Gra toczy się dalej</span>'}</footer>
    </div>
  </section>`;
}

function toastHtml(ctx) {
  const { lib, goals } = ctx;
  const { done, total } = goalCounts(goals);
  const finished = goals.filter((g) => g.state === 'done').at(-1);
  const fresh = goals.filter((g) => g.state === 'open').at(-1);
  return `<aside class="on-panel kc-toast" aria-live="polite">
    <div class="kc-toast__row kc-toast__row--done"><span class="kc-toast__seal">${ICON.check}</span><div><p class="kc-toast__label">Cel wykonany</p><p class="kc-toast__text">${lib.esc(lib.goalText(finished))}</p></div></div>
    <div class="kc-toast__row"><span class="kc-toast__seal kc-toast__seal--new">${ICON.flag}</span><div><p class="kc-toast__label kc-toast__label--new">Nowy cel</p><p class="kc-toast__text kc-toast__text--new">${lib.esc(lib.goalText(fresh))}</p></div></div>
    <div class="kc-toast__foot"><span class="kc-progress__bar"><i style="width:${(done / total) * 100}%"></i></span><span>${done} / ${total}</span><button type="button" class="kc-toast__open" data-expand>Cele ${ICON.next}</button></div>
    <span class="kc-toast__timer"></span>
  </aside>`;
}

function build(ctx, local) {
  if (local.closed) return '<div class="kc-root"></div>';
  if (local.toast) return `<div class="kc-root">${toastHtml(ctx)}</div>`;
  return `<div class="kc-root">${local.arrival && local.open ? '<div class="kc-scrim"></div>' : ''}${cardHtml(ctx, local)}</div>`;
}

function initialLocal(ctx) {
  return {
    tab: { goals: 'goals', history: 'history' }[ctx.view] ?? 'story',
    open: ctx.view !== 'arrival',
    arrival: ctx.view === 'arrival',
    toast: ctx.view === 'update',
    shown: ctx.pages.length - 1,
    closed: false,
  };
}

export default {
  id: 'k',
  name: 'Karta',
  blurb:
    'Najmniej inwazyjna: nowy rozdział to zwarta karta pod górną krawędzią z tytułem, dwoma zdaniami wstępu i nowymi celami jako żetonami. Kto nie czyta fabuły, klika Kontynuuj; kto czyta, rozwija tę samą kartę do pełnego okna lektury. Misja z belki otwiera ją od razu rozwiniętą.',
  css: 'k-karta.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    return build(ctx, initialLocal(ctx));
  },
  mount(root, ctx) {
    detach?.();
    const local = initialLocal(ctx);
    const redraw = () => {
      root.querySelector('.kc-root').outerHTML = build(ctx, local);
    };
    /** Only the reading content changes; the card element stays, so its growth animates. */
    const refill = () => {
      const card = root.querySelector('.kc-card');
      const next = document.createElement('div');
      next.innerHTML = cardHtml(ctx, local);
      card.querySelector('.kc-full').replaceWith(next.querySelector('.kc-full'));
    };
    const onClick = (event) => {
      if (root.querySelector('.kc-root') === null) return;
      const target = event.target.closest('button, a');
      if (target === null || !root.contains(target)) return;
      const { dataset } = target;
      if (dataset.expand !== undefined) {
        if (local.toast) {
          local.toast = false;
          local.tab = 'goals';
          local.open = true;
          redraw();
          return;
        }
        local.open = true;
        refill();
        const card = root.querySelector('.kc-card');
        card.classList.add('is-growing');
        card.addEventListener('transitionend', () => card.classList.remove('is-growing'), { once: true });
        card.classList.add('is-open');
        card.querySelector('.kc-compact').inert = true;
        card.querySelector('.kc-full').inert = false;
        if (local.arrival) root.querySelector('.kc-root').insertAdjacentHTML('afterbegin', '<div class="kc-scrim"></div>');
      } else if (dataset.tab) {
        local.tab = dataset.tab;
        refill();
      } else if (dataset.step) {
        local.shown = clamp(local.shown + Number(dataset.step), 0, ctx.pages.length - 1);
        local.tab = 'story';
        refill();
      } else if (dataset.open !== undefined) {
        local.shown = Number(dataset.open);
        local.tab = 'story';
        refill();
      } else if (dataset.continue !== undefined || target.classList.contains('kc-close')) {
        local.closed = true;
        redraw();
      } else if (dataset.voice !== undefined) {
        const playing = target.classList.toggle('is-playing');
        target.innerHTML = playing ? ICON.pause : ICON.play;
        target.closest('.kc-voice')?.classList.toggle('is-playing', playing);
      } else if (dataset.view !== undefined) {
        root.querySelectorAll('.kc-view').forEach((v) => v.classList.toggle('is-picked', v === target));
      } else if (dataset.tables !== undefined) {
        event.preventDefault();
      }
    };
    root.addEventListener('click', onClick);
    detach = () => root.removeEventListener('click', onClick);
  },
};
