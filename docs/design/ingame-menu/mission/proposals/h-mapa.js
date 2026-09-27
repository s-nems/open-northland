// H · Mapa wyprawy: the mission as a painted expedition map. Every briefing received is a numbered
// wax pin on the route, the page's world views hang off the shown pin as circular lenses, the open
// goals are the waypoints ahead and the reading column sits beside the map.

const MAP_ART = '/mission-review/art/h-mapa.jpg';
const SEAL_ART = '/mission-review/art/h-pieczec-96.png';
/** The painted map's own pixel size, the space the route points below are drawn in. */
const ART = { w: 1536, h: 1024 };
/** The map pane inside the window (design px) and where the art's crop sits horizontally. */
const PANE = { w: 540, h: 540 };
const PANE_FOCUS_X = 0.7;
/** The route across the painted land, in art px: landing on the southern cape, inland over the
 *  river, up into the mountains. Pins take the first points, the waypoints ahead the next ones. */
const ROUTE = [
  [600, 790], [712, 700], [640, 575], [770, 470], [890, 545], [985, 440], [1110, 515],
  [1190, 420], [1080, 330], [985, 225], [1120, 160], [1250, 245], [1330, 330], [1300, 110],
];
const MAX_WAYPOINTS = 4;
const LENS_BIG = 104;
const LENS_SMALL = 84;
const LENS_RINGS = [104, 140, 176, 212, 250];
const LENS_TURN = Math.PI / 9;
const LENS_TURNS = 9;
const LETTERS = 'ABCDEFGH';
/** The harness mounts on every re-render into the same element; the previous listener goes first. */
let detach = null;

const ICON = {
  play: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  flag: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 22V3M6 4h11l-3 4 3 4H6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  next: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  cross: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};

/** The art's cover crop in the pane: scale and left offset, so art px map to pane px. */
function artToPane([x, y]) {
  const scale = Math.max(PANE.w / ART.w, PANE.h / ART.h);
  const left = (PANE.w - ART.w * scale) * PANE_FOCUS_X;
  const top = (PANE.h - ART.h * scale) / 2;
  return [left + x * scale, top + y * scale];
}

/** A smooth path through the points (Catmull-Rom as cubic Béziers). */
function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Lens centres near the pin: the closest free spot on widening rings, clear of the pins, the flags
 *  ahead, the legend and the lenses already placed, inside the pane. */
function lensPlaces(pin, count, obstacles, blocked) {
  const size = count > 2 ? LENS_SMALL : LENS_BIG;
  const half = size / 2 + 4;
  const toward = Math.atan2(PANE.h / 2 - pin[1], PANE.w / 2 - pin[0]);
  const placed = [];
  const free = (x, y) =>
    x > half && x < PANE.w - half && y > half && y < PANE.h - half &&
    obstacles.every(([ox, oy, r]) => Math.hypot(x - ox, y - oy) > half + r) &&
    placed.every((p) => Math.hypot(x - p.x, y - p.y) > size + 8) &&
    blocked.every((b) => x + half < b.x || x - half > b.x + b.w || y + half < b.y || y - half > b.y + b.h);
  for (let i = 0; i < count; i++) {
    let spot = null;
    for (const radius of LENS_RINGS) {
      for (let k = 0; k <= LENS_TURNS && spot === null; k++) {
        for (const side of k === 0 ? [1] : [1, -1]) {
          const a = toward + side * k * LENS_TURN;
          const x = pin[0] + Math.cos(a) * radius;
          const y = pin[1] + Math.sin(a) * radius;
          if (free(x, y)) { spot = { x, y }; break; }
        }
      }
      if (spot !== null) break;
    }
    placed.push({ size, ...(spot ?? { x: clamp(pin[0] + 60 * (i + 1), half, PANE.w - half), y: clamp(pin[1], half, PANE.h - half) }) });
  }
  return placed;
}

/** The legend's box on the pane, estimated from its lines, so lenses keep clear of it. */
function legendBox(lib, open) {
  const CHARS_PER_LINE = 32;
  const lines = open.slice(0, MAX_WAYPOINTS).reduce((n, g) => n + Math.ceil(lib.goalText(g).length / CHARS_PER_LINE), 0);
  return { x: 14, y: 14, w: 238, h: 42 + lines * 18 + (open.length > MAX_WAYPOINTS ? 18 : 0) };
}

function goalGroups(goals) {
  const open = goals.filter((g) => g.state === 'open');
  const done = goals.filter((g) => g.state === 'done');
  return { open, done, total: goals.length };
}

function progressHtml(lib, goals) {
  const { done, total } = goalGroups(goals);
  return `<div class="hm-progress" aria-label="Wykonane cele: ${done.length} z ${total}"><span class="hm-progress__bar"><i style="width:${(done.length / total) * 100}%"></i></span><b>${done.length} / ${total}</b></div>`;
}

function mapHtml(ctx, local) {
  const { lib, pages, goals } = ctx;
  const latest = pages.length - 1;
  const pins = ROUTE.slice(0, pages.length).map(artToPane);
  const { open, done } = goalGroups(goals);
  const ahead = ROUTE.slice(pages.length, pages.length + Math.min(open.length, MAX_WAYPOINTS)).map(artToPane);
  const animate = local.animate && latest > 0;
  const travelled = smoothPath(animate ? pins.slice(0, -1) : pins);
  const fresh = animate ? smoothPath(pins.slice(-2)) : '';
  const onward = smoothPath([pins[latest], ...ahead]);
  // A done goal is stamped on the travelled route, between the pins it was reached at.
  const stamps = done.map((g, i) => {
    const a = pins[Math.min(i, latest)];
    const b = pins[Math.min(i + 1, latest)];
    const x = (a[0] + b[0]) / 2 + (a === b ? 26 : 0);
    const y = (a[1] + b[1]) / 2 + (a === b ? 18 : 0);
    return `<span class="hm-stamp" style="left:${x}px;top:${y}px" title="Wykonano: ${lib.esc(lib.goalText(g))}">${ICON.cross}</span>`;
  });
  const shownPin = pins[local.shown];
  const views = local.view === 'story' ? ctx.lib.analysePage(ctx.mission.pages[local.shown]).segments.filter((s) => s.kind === 'mapview') : [];
  const showLegend = local.view === 'story' && open.length > 0;
  const obstacles = [...pins.map(([x, y]) => [x, y, 22]), ...ahead.map(([x, y]) => [x, y - 12, 18])];
  const lenses = lensPlaces(shownPin, views.length, obstacles, showLegend ? [legendBox(lib, open)] : []);
  return `<div class="hm-map" style="background-image:url(${MAP_ART});background-position:${PANE_FOCUS_X * 100}% 50%">
    <svg class="hm-route" viewBox="0 0 ${PANE.w} ${PANE.h}" aria-hidden="true">
      <defs><mask id="hm-draw" maskUnits="userSpaceOnUse"><path d="${fresh}" pathLength="1" class="hm-route__reveal"/></mask></defs>
      <path class="hm-route__onward" d="${onward}"/>
      <path class="hm-route__trail" d="${travelled}"/>
      ${fresh ? `<path class="hm-route__trail" d="${fresh}" mask="url(#hm-draw)"/>` : ''}
      ${lenses.map((l) => `<line class="hm-route__string" x1="${shownPin[0]}" y1="${shownPin[1]}" x2="${l.x}" y2="${l.y}"/>`).join('')}
    </svg>
    ${stamps.join('')}
    ${ahead
      .map((p, i) => `<button type="button" class="hm-flag" style="left:${p[0]}px;top:${p[1]}px" data-goal="${i}" title="${lib.esc(lib.goalText(open[i]))}">${ICON.flag}<b>${LETTERS[i]}</b></button>`)
      .join('')}
    ${pins
      .map(
        (p, i) =>
          `<button type="button" class="hm-pin${i === local.shown ? ' is-shown' : ''}${animate && i === latest ? ' is-fresh' : ''}" style="left:${p[0]}px;top:${p[1]}px" data-page="${i}" aria-label="Rozdział ${i + 1}: ${lib.esc(pages[i].title)}"><img src="${SEAL_ART}" alt=""><b>${i + 1}</b><span class="hm-pin__tip">${lib.esc(pages[i].title)}</span></button>`,
      )
      .join('')}
    ${views
      .map(
        (s, i) =>
          `<button type="button" class="hm-lens${animate ? ' is-late' : ''}" data-lens="${i}" style="left:${lenses[i].x}px;top:${lenses[i].y}px;--lens:${lenses[i].size}px" aria-label="Pokaż na mapie"><span style="${lib.mapViewStyle(ctx.map, s.icon, lenses[i].size * 1.6, lenses[i].size * 1.25)}"></span><em>Pokaż na mapie</em></button>`,
      )
      .join('')}
    ${showLegend ? legendHtml(ctx, open) : ''}
    <p class="hm-toast" hidden></p>
  </div>`;
}

function legendHtml(ctx, open) {
  const { lib } = ctx;
  const shown = open.slice(0, MAX_WAYPOINTS);
  return `<aside class="hm-legend"><p class="hm-legend__title">Następne punkty trasy</p><ol>${shown
    .map((g, i) => `<li${g.emphasis ? ' class="is-main"' : ''}><b>${LETTERS[i]}</b><span>${lib.esc(lib.goalText(g))}</span></li>`)
    .join('')}</ol>${open.length > shown.length ? `<p class="hm-legend__more">i ${open.length - shown.length} więcej w zakładce Cele</p>` : ''}</aside>`;
}

function segmentHtml(ctx, s, viewIndex) {
  const { lib } = ctx;
  switch (s.kind) {
    case 'heading':
      return `<h4 class="hm-sub">${lib.esc(s.text)}</h4>`;
    case 'para':
      return `<p class="hm-para">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`;
    case 'speech':
      return `<div class="hm-speech${s.portrait ? ' has-portrait' : ''}">${s.portrait ? `<img src="${s.portrait}" alt="">` : ''}<p>${s.speaker ? `<b>${lib.esc(s.speaker)}</b>` : ''}${lib.esc(s.text)}</p></div>`;
    case 'picture':
      return `<figure class="hm-picture${s.width > 300 ? ' is-wide' : ''}"><img src="${s.src}" alt=""></figure>`;
    case 'mapview':
      return `<button type="button" class="hm-viewref" data-lens="${viewIndex}"><span class="hm-viewref__dot">${viewIndex + 1}</span>Widok na mapie · <u>Pokaż</u></button>`;
    case 'signature':
      return `<p class="hm-signature">${lib.esc(s.text)}</p>`;
    default:
      return '';
  }
}

function storyHtml(ctx, local) {
  const { lib, pages } = ctx;
  const page = lib.analysePage(ctx.mission.pages[local.shown]);
  let viewIndex = 0;
  const body = page.segments.map((s) => segmentHtml(ctx, s, s.kind === 'mapview' ? viewIndex++ : 0)).join('');
  const latest = pages.length - 1;
  const footer = local.arrival
    ? `<div class="hm-foot hm-foot--arrival"><span class="hm-paused">${ICON.pause}Gra wstrzymana</span><button type="button" class="on-button hm-go" data-continue>Ruszaj dalej ${ICON.next}</button></div>`
    : `<div class="hm-foot"><button type="button" class="on-button hm-step" data-step="-1" ${local.shown === 0 ? 'disabled' : ''}>${lib.GLYPH.back} Poprzedni</button><span class="hm-foot__count">Rozdział ${local.shown + 1} z ${pages.length}</span><button type="button" class="on-button hm-step" data-step="1" ${local.shown === latest ? 'disabled' : ''}>Następny ${ICON.next}</button></div>`;
  return `<div class="hm-sheet">
    <header class="hm-sheet__head">
      <p class="hm-kicker">${local.arrival ? 'Nowy wpis · ' : ''}Rozdział ${local.shown + 1} · ${lib.receivedAt(local.shown)}</p>
      <h3 class="hm-title">${lib.esc(page.title)}</h3>
      <div class="hm-voice" role="group" aria-label="Narracja"><button type="button" class="on-medallion hm-voice__play" data-voice aria-label="Odtwórz narrację">${ICON.play}</button><span class="hm-voice__track"><i></i></span><span class="hm-voice__time">0:00 / 1:12</span><button type="button" class="hm-voice__again" aria-label="Od początku">${ICON.replay}</button></div>
    </header>
    <div class="hm-text">${body}</div>
  </div>${footer}`;
}

function goalsHtml(ctx) {
  const { lib, goals } = ctx;
  let letter = 0;
  const rows = goals
    .map((g) => {
      const mark = g.state === 'open' ? `<b class="hm-goal__letter">${LETTERS[letter++] ?? '·'}</b>` : g.state === 'done' ? `<span class="hm-goal__cross">${ICON.cross}</span>` : '<span class="hm-goal__later"></span>';
      const note = g.state === 'done' ? '<span class="hm-goal__stamp">Wykonano</span>' : g.state === 'idle' ? '<span class="hm-goal__note">Później</span>' : g.emphasis ? '<span class="hm-goal__note hm-goal__note--main">Główny cel</span>' : '';
      return `<li class="hm-goal is-${g.state}${g.emphasis ? ' is-main' : ''}">${mark}<span class="hm-goal__text">${lib.esc(lib.goalText(g))}</span>${note}</li>`;
    })
    .join('');
  return `<div class="hm-sheet"><header class="hm-sheet__head"><p class="hm-kicker">Punkty trasy</p><h3 class="hm-title">Cele wyprawy</h3>${progressHtml(lib, goals)}</header><ol class="hm-goals">${rows}</ol></div>`;
}

function historyHtml(ctx, local) {
  const { lib, pages } = ctx;
  const latest = pages.length - 1;
  const rows = pages
    .map((p, i) => `<li><button type="button" class="hm-entry${i === local.shown ? ' is-shown' : ''}" data-open="${i}"><span class="hm-entry__seal"><img src="${SEAL_ART}" alt=""><b>${i + 1}</b></span><span class="hm-entry__title">${lib.esc(p.title)}</span><span class="hm-entry__time">${lib.receivedAt(i)}${i === latest ? ' · najnowszy' : ''}</span></button></li>`)
    .reverse()
    .join('');
  return `<div class="hm-sheet"><header class="hm-sheet__head"><p class="hm-kicker">${pages.length} ${pages.length === 1 ? 'wpis' : pages.length < 5 ? 'wpisy' : 'wpisów'}</p><h3 class="hm-title">Dziennik wyprawy</h3></header><ol class="hm-journal">${rows}</ol><a class="hm-tables" href="#" data-tables>Tablice historyczne ${ICON.next} Wiedza</a></div>`;
}

function windowHtml(ctx, local) {
  const { lib, goals, pages } = ctx;
  const { done, total } = goalGroups(goals);
  const tab = (id, label, extra = '') =>
    `<button type="button" role="tab" class="on-tab" data-tab="${id}" aria-selected="${local.view === id}">${label}${extra}</button>`;
  const column = local.view === 'goals' ? goalsHtml(ctx) : local.view === 'history' ? historyHtml(ctx, local) : storyHtml(ctx, local);
  return `${local.arrival ? '<div class="hm-scrim"></div>' : ''}<section class="on-window on-panel hm-window${local.arrival ? ' is-arrival' : ''}" aria-label="Misja">${lib.ORNAMENTS}
    <header class="on-window__head hm-head"><div class="on-window__heading"><span class="hm-head__pin">${lib.GLYPH.pin}</span><div><p class="on-window__kicker">MISJA</p><h2 class="on-window__title">${lib.esc(lib.missionName(ctx.mission))}</h2></div></div>
    ${local.arrival ? `<span class="hm-head__paused">${ICON.pause}Gra wstrzymana do Twojej decyzji</span>` : '<span class="hm-head__running">Gra toczy się dalej</span>'}
    ${lib.closeMedallion('on-window__close')}</header>
    <div class="hm-body">${mapHtml(ctx, local)}<div class="hm-column"><div class="on-tabs hm-tabs" role="tablist">${tab('story', 'Opowieść')}${tab('goals', 'Cele', `<span class="on-tab__count">${done.length}/${total}</span>`)}${tab('history', 'Dziennik', `<span class="on-tab__count">${pages.length}</span>`)}</div><div class="hm-paper">${column}</div></div></div>
  </section>`;
}

function trackerHtml(ctx) {
  const { lib, goals } = ctx;
  const { open, done } = goalGroups(goals);
  const finished = done.at(-1);
  const fresh = open.at(-1) ?? open[0];
  const pin = artToPane(ROUTE[Math.min(ctx.pages.length - 1, ROUTE.length - 1)]);
  return `<aside class="on-panel hm-tracker" aria-live="polite">
    <div class="hm-tracker__scrap" style="background-image:url(${MAP_ART});background-size:${PANE.w * 1.4}px auto;background-position:${-pin[0] * 1.4 + 58}px ${-pin[1] * 1.4 + 58}px"><img src="${SEAL_ART}" alt=""><span class="hm-tracker__x">${ICON.cross}</span></div>
    <div class="hm-tracker__text">
      <p class="hm-tracker__kicker">${ICON.check}Punkt trasy osiągnięty</p>
      <p class="hm-tracker__done">${lib.esc(lib.goalText(finished))}</p>
      <p class="hm-tracker__kicker hm-tracker__kicker--new">${ICON.flag}Nowy cel na mapie</p>
      <p class="hm-tracker__new">${lib.esc(lib.goalText(fresh))}</p>
      ${progressHtml(lib, goals)}
    </div>
    <button type="button" class="on-medallion hm-tracker__close" aria-label="Zamknij">${lib.GLYPH.close}</button>
  </aside>
  <span class="hm-beam-mark" aria-label="Nowe wpisy w Misji"></span>`;
}

function build(ctx, local) {
  return `<div class="hm-root">${local.view === 'update' ? trackerHtml(ctx) : local.closed ? '' : windowHtml(ctx, local)}</div>`;
}

function initialLocal(ctx) {
  const view = { arrival: 'story', task: 'story', goals: 'goals', history: 'history', update: 'update' }[ctx.view];
  return { view, shown: ctx.pages.length - 1, arrival: ctx.view === 'arrival', animate: ctx.view === 'arrival', closed: false };
}

export default {
  id: 'h',
  name: 'Mapa wyprawy',
  blurb:
    'Misja jako malowana mapa wyprawy: każdy otrzymany briefing to numerowana pieczęć na trasie, widoki świata wiszą przy niej jako soczewki, a aktywne cele to kolejne punkty trasy przed graczem. Tekst czyta się w pergaminowej kolumnie obok, a nowy rozdział rysuje trasę do nowej pieczęci.',
  css: 'h-mapa.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    return build(ctx, initialLocal(ctx));
  },
  mount(root, ctx) {
    detach?.();
    const local = initialLocal(ctx);
    const redraw = () => {
      root.querySelector('.hm-root').outerHTML = build(ctx, local);
      local.animate = false;
    };
    local.animate = false;
    const onClick = (event) => {
      if (root.querySelector('.hm-root') === null) return;
      const target = event.target.closest('button, a');
      if (target === null || !root.contains(target)) return;
      const { dataset } = target;
      if (dataset.tab) {
        local.view = dataset.tab;
        redraw();
      } else if (dataset.page !== undefined || dataset.open !== undefined) {
        local.shown = Number(dataset.page ?? dataset.open);
        local.view = 'story';
        redraw();
      } else if (dataset.step) {
        local.shown = clamp(local.shown + Number(dataset.step), 0, ctx.pages.length - 1);
        redraw();
      } else if (dataset.continue !== undefined || target.classList.contains('on-window__close') || target.classList.contains('hm-tracker__close')) {
        local.closed = true;
        local.view = local.view === 'update' ? 'story' : local.view;
        redraw();
      } else if (dataset.lens !== undefined) {
        const toast = root.querySelector('.hm-toast');
        root.querySelectorAll('.hm-lens').forEach((l) => l.classList.toggle('is-picked', l.dataset.lens === dataset.lens));
        if (toast) {
          toast.hidden = false;
          toast.textContent = `Kamera jedzie do widoku ${Number(dataset.lens) + 1}`;
        }
      } else if (dataset.goal !== undefined) {
        local.view = 'goals';
        redraw();
      } else if (dataset.voice !== undefined) {
        const playing = target.classList.toggle('is-playing');
        target.innerHTML = playing ? ICON.pause : ICON.play;
        target.closest('.hm-voice').classList.toggle('is-playing', playing);
      } else if (dataset.tables !== undefined) {
        event.preventDefault();
      }
    };
    root.addEventListener('click', onClick);
    detach = () => root.removeEventListener('click', onClick);
  },
};
