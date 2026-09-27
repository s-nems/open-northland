// G · Dziennik: a quest journal in the construction window's frame. The left column lists every
// received chapter (or the goals), the right shows the selected entry with its pictures, world views
// and the goals the chapter gave.

const ICON = {
  play: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13" stroke-width="3"/></svg>',
  replay: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4v4h4"/></svg>',
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  search: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>',
  scroll: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M7 4h11a2 2 0 0 1 0 4h-1v10a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h1z"/><path d="M6 16h9M10 8h4M10 11.5h4"/></svg>',
  flag: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/></svg>',
  spark: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
};

const MISSION_ART = (size) =>
  `<span class="on-icon" aria-hidden="true" style="width:${size}px;height:${size}px;background-size:${size * 3}px ${size * 3}px;background-position:0 -${size}px"></span>`;

const SMALL_WORDS = new Set(['i', 'w', 'z', 'na', 'do', 'od', 'po', 'o', 'u', 'a', 'we', 'ze', 'dla', 'przez', 'oraz']);
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

/** A world view crop scaled down whole from the harness's 280 × 220 view. */
function viewStyle(lib, map, icon, w) {
  const full = lib.mapViewStyle(map, icon, 280, 220);
  const [, x, y] = full.match(/-(\d+)px -(\d+)px/) ?? [0, 0, 0];
  const s = w / 280;
  return `background:#223 url(${lib.worldUrl(map)}) -${Math.round(x * s)}px -${Math.round(y * s)}px / ${Math.round(1365 * s)}px ${Math.round(768 * s)}px no-repeat`;
}

/** Which received chapter gave each goal. The page data has no such link yet, so the mockup spreads
 *  done goals over earlier chapters and hangs active and upcoming ones on the latest. */
function goalChapters(goals, chapters) {
  const done = goals.filter((g) => g.state === 'done').length;
  let k = 0;
  return goals.map((g) => (g.state === 'done' && chapters > 1 ? Math.floor((k++ * (chapters - 1)) / Math.max(done, 1)) : chapters - 1));
}

const local = { key: '', mode: 'brief', entry: 0, goal: -1, playing: false, toast: '', query: '', opened: false, peek: 0 };
function syncLocal(ctx) {
  const key = `${ctx.view}|${ctx.map}|${ctx.pageIndex}`;
  if (local.key === key) return;
  const last = ctx.pages.length - 1;
  Object.assign(local, {
    key,
    mode: ctx.view === 'goals' ? 'goals' : 'brief',
    entry: ctx.view === 'history' ? Math.max(0, last - 1) : last,
    goal: ctx.view === 'goals' ? Math.max(0, ctx.goals.findIndex((g) => g.state === 'open')) : -1,
    playing: false,
    toast: '',
    query: '',
    opened: false,
    peek: 0,
  });
}

function entryThumb(lib, map, page, i) {
  const face = page.segments.find((s) => s.kind === 'speech' && s.portrait)?.portrait ?? page.segments.find((s) => s.kind === 'picture')?.src;
  if (face) return `<span class="gd-thumb gd-thumb--face"><img src="${face}" alt=""></span>`;
  const view = page.segments.find((s) => s.kind === 'mapview');
  if (view) return `<span class="gd-thumb" style="${viewStyle(lib, map, view.icon, 56)}"></span>`;
  return `<span class="gd-thumb gd-thumb--num">${i + 1}</span>`;
}

function excerpt(page) {
  const s = page.segments.find((x) => x.kind === 'para' || x.kind === 'speech');
  if (!s) return '';
  const t = s.text.replace(/\s+/g, ' ').replace(/^["„”«»]/, '');
  return t.length > 64 ? `${t.slice(0, 62).trimEnd()}…` : t;
}

function briefList(ctx) {
  const { lib } = ctx;
  const last = ctx.pages.length - 1;
  const row = (i) => {
    const page = ctx.pages[i];
    const latest = i === last;
    const badge = latest ? (ctx.view === 'arrival' ? '<em class="gd-badge gd-badge--new">Nowe</em>' : '<em class="gd-badge">Bieżący</em>') : '';
    const hay = `${chapterTitle(page, i)} ${page.segments.map((s) => s.text ?? '').join(' ')}`.toLowerCase();
    return `<li><button type="button" class="gd-entry${i === local.entry ? ' is-selected' : ''}${latest && ctx.view === 'arrival' ? ' is-fresh' : ''}" data-entry="${i}" data-hay="${lib.esc(hay)}">
      ${entryThumb(lib, ctx.map, page, i)}
      <span class="gd-entry__text">
        <span class="gd-entry__meta">Rozdział ${i + 1} · ${lib.receivedAt(i)}${badge}</span>
        <span class="gd-entry__title">${lib.esc(chapterTitle(page, i))}</span>
        <span class="gd-entry__excerpt">${lib.esc(excerpt(page))}</span>
      </span>
    </button></li>`;
  };
  const earlier = [];
  for (let i = last - 1; i >= 0; i--) earlier.push(row(i));
  return `<p class="gd-group">Bieżący rozdział</p><ol class="gd-list">${row(last)}</ol>${
    earlier.length ? `<p class="gd-group">Wcześniej<span>${earlier.length}</span></p><ol class="gd-list">${earlier.join('')}</ol>` : ''
  }`;
}

function goalsList(ctx) {
  const { lib, goals } = ctx;
  const done = goals.filter((g) => g.state === 'done').length;
  const group = (state, label) => {
    const rows = goals
      .map((g, i) => [g, i])
      .filter(([g]) => g.state === state)
      .map(
        ([g, i]) =>
          `<li><button type="button" class="gd-goalrow is-${g.state}${i === local.goal ? ' is-selected' : ''}" data-goal="${i}" data-hay="${lib.esc(lib.goalText(g).toLowerCase())}">
            <span class="gd-check" aria-hidden="true">${g.state === 'done' ? ICON.check : ''}</span>
            <span class="gd-goalrow__text">${lib.esc(lib.goalText(g))}</span>
          </button></li>`,
      )
      .join('');
    return rows ? `<p class="gd-group">${label}<span>${goals.filter((g) => g.state === state).length}</span></p><ol class="gd-list">${rows}</ol>` : '';
  };
  return `<div class="gd-progress">
      <span class="gd-progress__n">${done}<small>/${goals.length}</small></span>
      <span class="gd-progress__side"><span class="gd-progress__label">celów wykonanych</span><span class="gd-progress__bar"><span style="width:${(done / goals.length) * 100}%"></span></span></span>
    </div>
    ${group('open', 'Aktywne')}${group('idle', 'Jeszcze nieaktywne')}${group('done', 'Wykonane')}`;
}

function segmentsHtml(lib, map, segs) {
  const out = [];
  const firstFace = segs.find((s) => s.kind === 'speech' && s.portrait)?.portrait;
  let firstPara = true;
  let side = 'right';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const text = (t) => lib.esc(t).replace(/\n/g, '<br>');
    switch (s.kind) {
      case 'heading':
        out.push(`<h4 class="gd-heading">${lib.esc(s.text)}</h4>`);
        break;
      case 'para':
        out.push(`<p class="gd-para${firstPara && /^\p{Lu}/u.test(s.text) ? ' gd-para--lead' : ''}">${text(s.text)}</p>`);
        firstPara = false;
        break;
      case 'speech':
        if (s.portrait) {
          const answer = s.portrait !== firstFace;
          out.push(
            `<blockquote class="gd-say${answer ? ' gd-say--answer' : ''}"><img class="gd-say__face" src="${s.portrait}" alt=""><p>${text(s.text.replace(/^["„”«»]|["„”«»]\s*$/g, ''))}</p></blockquote>`,
          );
        } else {
          out.push(`<p class="gd-speech"><b>${lib.esc(s.speaker)}</b> ${text(s.text)}</p>`);
        }
        firstPara = false;
        break;
      case 'picture':
        // A picture floats beside the paragraphs that follow it, alternating sides.
        side = side === 'right' ? 'left' : 'right';
        out.push(`<img class="gd-picture gd-picture--${side}" src="${s.src}" alt="" style="aspect-ratio:${s.width}/${s.height}">`);
        break;
      case 'mapview': {
        const views = [s];
        while (segs[i + 1]?.kind === 'mapview') views.push(segs[++i]);
        out.push(
          `<div class="gd-views">${views
            .map(
              (v, k) =>
                `<button type="button" class="gd-view" data-view="${k + 1}" style="${viewStyle(lib, map, v.icon, 150)}"><span class="gd-view__cap">${lib.GLYPH.pin}Pokaż na mapie</span></button>`,
            )
            .join('')}</div>`,
        );
        break;
      }
      case 'signature':
        out.push(`<p class="gd-signature">${lib.esc(s.text)}</p>`);
        break;
      default:
    }
  }
  return out.join('');
}

function detail(ctx, chapterOf) {
  const { lib } = ctx;
  const i = local.entry;
  const page = ctx.pages[i];
  const fresh = ctx.view === 'arrival' && i === ctx.pages.length - 1;
  const tied = ctx.goals.map((g, k) => [g, k]).filter(([, k]) => chapterOf[k] === i);
  const goalsBlock = tied.length
    ? `<section class="gd-tied"><p class="on-parchment__note">Cele z tego rozdziału</p><ul>${tied
        .map(
          ([g, k]) =>
            `<li class="is-${g.state}${k === local.goal ? ' is-lit' : ''}"><span class="gd-check" aria-hidden="true">${g.state === 'done' ? ICON.check : ''}</span><span>${lib.esc(lib.goalText(g))}</span><em>${
              { done: 'wykonany', open: 'aktywny', idle: 'wkrótce' }[g.state]
            }</em></li>`,
        )
        .join('')}</ul></section>`
    : '';
  const picked = local.mode === 'goals' ? ctx.goals[local.goal] : undefined;
  const focus = picked
    ? `<aside class="gd-focus is-${picked.state}"><span class="gd-check" aria-hidden="true">${picked.state === 'done' ? ICON.check : ''}</span><div><p class="gd-focus__state">${
        { done: 'Cel wykonany', open: 'Cel aktywny', idle: 'Cel jeszcze nieaktywny' }[picked.state]
      } · zlecony w tym rozdziale</p><p class="gd-focus__text">${lib.esc(lib.goalText(picked))}</p></div></aside>`
    : '';
  return `<article class="gd-detail on-parchment${fresh ? ' is-fresh' : ''}" data-detail>
    <header class="gd-detail__head">
      <div>
        <p class="gd-detail__kicker">Rozdział ${i + 1} z ${ctx.pages.length} · otrzymano ${lib.receivedAt(i)}</p>
        <h3 class="gd-detail__title">${lib.esc(chapterTitle(page, i))}</h3>
      </div>
      <div class="gd-voice${local.playing ? ' is-playing' : ''}">
        <button type="button" class="on-medallion gd-voice__play" data-voice aria-label="${local.playing ? 'Wstrzymaj narrację' : 'Odsłuchaj'}">${local.playing ? ICON.pause : ICON.play}</button>
        <span class="gd-voice__label">${local.playing ? 'Narracja 0:14 / 1:32' : 'Odsłuchaj'}<span class="gd-voice__bar"><span></span></span></span>
        <button type="button" class="gd-voice__again" aria-label="Od początku">${ICON.replay}</button>
      </div>
      ${fresh ? '<span class="gd-stamp" aria-label="Nowy wpis"><span>Nowy<br>wpis</span></span>' : ''}
    </header>
    <svg class="gd-rule" aria-hidden="true"><use href="#on-knot"/></svg>
    ${focus}
    <div class="gd-text">${segmentsHtml(lib, ctx.map, page.segments)}</div>
    ${goalsBlock}
  </article>`;
}

function windowHtml(ctx) {
  const { lib, goals } = ctx;
  const chapterOf = goalChapters(goals, ctx.pages.length);
  if (local.mode === 'goals' && local.goal >= 0) local.entry = chapterOf[local.goal];
  const done = goals.filter((g) => g.state === 'done').length;
  const paused = ctx.view === 'arrival';
  const seg = (id, label, count) =>
    `<button type="button" role="tab" class="gd-seg__btn" data-mode="${id}" aria-selected="${local.mode === id}">${label}<span>${count}</span></button>`;
  const last = ctx.pages.length - 1;
  const foot = `
    <div class="gd-foot__state${paused ? ' is-paused' : ''}">${
      paused ? `${ICON.pause}<span><b>Gra wstrzymana</b> · nowy rozdział</span>` : '<span class="gd-dot"></span><span>Gra toczy się dalej</span>'
    }</div>
    <div class="gd-foot__nav">
      <button type="button" class="on-button" data-step="-1" ${local.entry === 0 ? 'disabled' : ''}>${lib.GLYPH.back}Starszy</button>
      <button type="button" class="on-button" data-step="1" ${local.entry === last ? 'disabled' : ''}>Nowszy${lib.GLYPH.next}</button>
    </div>
    ${
      paused
        ? '<button type="button" class="on-button gd-go" data-close>Wznów grę</button>'
        : '<span class="gd-toast">Esc zamyka dziennik</span>'
    }`;
  return `<section class="on-window on-panel gd-win${paused ? ' is-arrival' : ''}" aria-label="Dziennik misji">
    ${lib.ORNAMENTS}
    <header class="on-window__head gd-head">
      <div class="on-window__heading">${MISSION_ART(43)}<div>
        <p class="on-window__kicker">${lib.esc(lib.missionName(ctx.mission).toUpperCase())}</p>
        <h2 class="on-window__title">Dziennik</h2>
      </div></div>
      <div class="gd-head__right">
        <span class="gd-chip">${ICON.flag}<span>Cele <b>${done}</b>/${goals.length}</span></span>
        <span class="gd-chip">${ICON.scroll}<span>Rozdziały <b>${ctx.pages.length}</b></span></span>
        <button type="button" class="on-medallion on-window__close" data-close aria-label="Zamknij">${lib.GLYPH.close}</button>
      </div>
    </header>
    <div class="gd-body">
      <nav class="gd-side" aria-label="Wpisy">
        <div class="gd-seg" role="tablist">${seg('brief', 'Briefingi', ctx.pages.length)}${seg('goals', 'Cele', `${done}/${goals.length}`)}</div>
        <label class="gd-search">${ICON.search}<input type="search" placeholder="Szukaj w dzienniku" value="${lib.esc(local.query)}" data-search></label>
        <div class="gd-scroll">${local.mode === 'goals' ? goalsList(ctx) : briefList(ctx)}
          <p class="gd-empty" hidden>Nic nie pasuje do wyszukiwania.</p>
        </div>
        <a class="gd-wiedza" href="#" data-wiedza>Tablice historyczne ${lib.GLYPH.next} Wiedza</a>
      </nav>
      ${detail(ctx, chapterOf)}
    </div>
    <footer class="gd-foot">${foot}</footer>
  </section>`;
}

/** Update view: the window is shut; a journal slip rises from the Misja entry on the beam. */
function slip(ctx) {
  const { lib, goals } = ctx;
  let doneAt = goals.map((g) => g.state).lastIndexOf('done');
  if (doneAt < 0) doneAt = 0;
  const fresh = goals.findIndex((g) => g.state === 'idle');
  const done = goals.filter((g) => g.state === 'done').length + (goals[doneAt].state === 'done' ? 0 : 1);
  return `<div class="gd-beambadge" aria-label="2 nowe wpisy w dzienniku">2</div>
  <aside class="gd-slip" role="status">
    <header class="gd-slip__head">${ICON.scroll}<span>Dziennik uzupełniony</span><time>${lib.receivedAt(ctx.pageIndex)}</time></header>
    <p class="gd-slip__row is-done"><span class="gd-check">${ICON.check}</span><span><em>Cel wykonany</em><s>${lib.esc(lib.goalText(goals[doneAt]))}</s></span></p>
    ${
      fresh >= 0
        ? `<p class="gd-slip__row is-new"><span class="gd-check gd-check--new">${ICON.spark}</span><span><em>Nowy cel</em>${lib.esc(lib.goalText(goals[fresh]))}</span></p>`
        : ''
    }
    <footer class="gd-slip__foot"><span>Cele <b>${done}</b>/${goals.length}</span><button type="button" class="gd-slip__open" data-open>Otwórz dziennik <kbd class="on-key">M</kbd></button></footer>
  </aside>`;
}

export default {
  id: 'g',
  name: 'Dziennik',
  blurb:
    'Dziennik zadań jak w nowoczesnym RPG: po lewej lista wpisów (bieżący rozdział na górze, wcześniejsze z czasem gry) i przełącznik Briefingi / Cele, po prawej wybrany wpis z obrazkami przy akapitach, widokami świata i celami tego rozdziału. Jedno okno odpowiada na „co mam robić”, „co było” i „ile zostało”.',
  css: 'g-dziennik.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    syncLocal(ctx);
    if (ctx.view === 'update' && !local.opened) return `<div class="gd-root">${slip(ctx)}</div>`;
    // "Pokaż na mapie" steps the journal aside while the camera looks; one press brings it back.
    if (local.peek > 0)
      return `<div class="gd-root"><div class="gd-camera"><span></span></div><button type="button" class="gd-peek" data-unpeek>${ICON.scroll}<span>Widok ${local.peek} z dziennika</span><b>Wróć do wpisu</b><kbd class="on-key">M</kbd></button></div>`;
    return `<div class="gd-root">${ctx.view === 'arrival' ? '<div class="gd-dim"></div>' : ''}${windowHtml(ctx)}</div>`;
  },
  mount(root, ctx, rerender) {
    const on = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => (e.preventDefault(), fn(el))));
    const keepScroll = (fn) => {
      const list = root.querySelector('.gd-scroll');
      const top = list?.scrollTop ?? 0;
      fn();
      rerender();
      const again = document.querySelector('.mp-g .gd-scroll');
      if (again) again.scrollTop = top;
    };
    on('[data-mode]', (el) => {
      local.mode = el.dataset.mode;
      if (local.mode === 'goals' && local.goal < 0) local.goal = Math.max(0, ctx.goals.findIndex((g) => g.state === 'open'));
      if (local.mode === 'brief') local.goal = -1;
      rerender();
    });
    on('[data-entry]', (el) => keepScroll(() => ((local.entry = Number(el.dataset.entry)), (local.playing = false))));
    on('[data-goal]', (el) => keepScroll(() => (local.goal = Number(el.dataset.goal))));
    on('[data-step]', (el) =>
      keepScroll(() => {
        local.entry = Math.min(ctx.pages.length - 1, Math.max(0, local.entry + Number(el.dataset.step)));
        local.mode = 'brief';
        local.goal = -1;
      }),
    );
    on('[data-voice]', () => ((local.playing = !local.playing), rerender()));
    on('[data-view]', (el) => ((local.peek = Number(el.dataset.view)), rerender()));
    on('[data-unpeek]', () => ((local.peek = 0), rerender()));
    on('[data-open]', () => ((local.opened = true), rerender()));
    on('[data-close]', () => {
      root.querySelector('.gd-win')?.remove();
      root.querySelector('.gd-dim')?.remove();
    });
    const search = root.querySelector('[data-search]');
    search?.addEventListener('input', () => {
      local.query = search.value;
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      root.querySelectorAll('[data-hay]').forEach((el) => {
        const hit = q === '' || el.dataset.hay.includes(q);
        el.parentElement.hidden = !hit;
        shown += hit ? 1 : 0;
      });
      root.querySelector('.gd-empty').hidden = shown > 0;
    });
  },
};
