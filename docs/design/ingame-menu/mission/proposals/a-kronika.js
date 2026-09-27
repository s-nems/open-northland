// A · Kronika: the construction window's frame and parchment carried over to the mission. One window,
// three tabs, a reading column beside a goal rail, the chapter strip at the foot.
const W = 860;
const CHECK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

function speech(lib, s) {
  const face = s.portrait
    ? `<span class="mpa-face" style="background-image:url(${s.portrait})"></span>`
    : `<span class="mpa-face mpa-face--initial">${lib.esc((s.speaker ?? '?').slice(0, 1))}</span>`;
  return `<div class="mpa-speech">${face}<div>${s.speaker ? `<b class="mpa-speaker">${lib.esc(s.speaker)}</b>` : ''}<p>${lib.esc(s.text)}</p></div></div>`;
}

function reading(ctx, page) {
  const { lib, map } = ctx;
  const out = [];
  let firstPara = true;
  for (const s of page.segments) {
    switch (s.kind) {
      case 'para':
        out.push(`<p class="mpa-para${firstPara ? ' mpa-para--lead' : ''}">${lib.esc(s.text).replace(/\n/g, '<br>')}</p>`);
        firstPara = false;
        break;
      case 'heading':
        out.push(`<h4 class="mpa-sub">${lib.esc(s.text)}</h4>`);
        break;
      case 'speech':
        out.push(speech(lib, s));
        break;
      case 'picture':
        out.push(
          `<figure class="mpa-picture${s.width > 250 ? ' mpa-picture--large' : ''}"><img src="${s.src}" alt=""></figure>`,
        );
        break;
      case 'mapview':
        out.push(
          `<figure class="mpa-view"><button type="button" class="mpa-view__shot" style="${lib.mapViewStyle(map, s.icon, 300, 170)}" aria-label="Pokaż na mapie"></button><figcaption>${lib.GLYPH.go ?? ''}<span>Pokaż na mapie</span></figcaption></figure>`,
        );
        break;
      case 'signature':
        out.push(`<p class="mpa-signature">${lib.esc(s.text)}</p>`);
        break;
    }
  }
  return out.join('');
}

function goalRows(ctx, { compact }) {
  const { lib } = ctx;
  return ctx.goals
    .map((g) => {
      const mark =
        g.state === 'done'
          ? `<i class="mpa-check mpa-check--done" aria-label="wykonany">${CHECK}</i>`
          : `<i class="mpa-check${g.state === 'idle' ? ' mpa-check--idle' : ''}" aria-label="${g.state === 'open' ? 'aktywny' : 'jeszcze nieaktywny'}"></i>`;
      return `<li class="mpa-goal mpa-goal--${g.state}${g.emphasis ? ' mpa-goal--main' : ''}">${mark}<span>${lib.esc(lib.goalText(g))}${
        g.emphasis && !compact ? '<small>Cel główny</small>' : ''
      }</span></li>`;
    })
    .join('');
}

function progress(ctx) {
  const done = ctx.goals.filter((g) => g.state === 'done').length;
  const shown = ctx.goals.filter((g) => g.state !== 'idle').length;
  return { done, shown, total: ctx.goals.length };
}

function narration(arrival) {
  return `<div class="mpa-voice" role="group" aria-label="Narracja">
    <button type="button" class="mpa-voice__play" aria-label="${arrival ? 'Wstrzymaj' : 'Odsłuchaj'}">${arrival ? '❚❚' : '▶'}</button>
    <span class="mpa-voice__bar"><i style="width:${arrival ? 34 : 0}%"></i></span>
    <span class="mpa-voice__time">${arrival ? '0:21' : '0:00'} / 1:02</span>
  </div>`;
}

function chapterStrip(ctx) {
  const { lib } = ctx;
  const n = ctx.pages.length;
  const dots = ctx.pages
    .map(
      (p, i) =>
        `<button type="button" class="mpa-dot${i === n - 1 ? ' mpa-dot--on' : ''}" data-page="${i}" aria-label="${lib.esc(p.title)}"></button>`,
    )
    .join('');
  return `<div class="mpa-strip">
    <button type="button" class="on-button mpa-step" data-step="-1"${ctx.pageIndex === 0 ? ' disabled' : ''}>${lib.GLYPH.back ?? '‹'}<span>Poprzedni</span></button>
    <span class="mpa-dots">${dots}</span>
    <button type="button" class="on-button mpa-step" data-step="1" disabled><span>Następny</span>${lib.GLYPH.next ?? '›'}</button>
  </div>`;
}

function tabs(ctx, selected) {
  const p = progress(ctx);
  const tab = (id, label, count) =>
    `<button type="button" class="on-tab" role="tab" data-tab="${id}" aria-selected="${selected === id}">${label}${count === undefined ? '' : `<span class="on-tab__count">${count}</span>`}</button>`;
  return `<div class="on-tabs mpa-tabs" role="tablist">${tab('task', 'Zadanie')}${tab('goals', 'Cele', `${p.done}/${p.total}`)}${tab('history', 'Kronika', ctx.pages.length)}</div>`;
}

function taskBody(ctx, arrival) {
  const { lib, page } = ctx;
  const p = progress(ctx);
  const i = ctx.pageIndex;
  const rail = `<aside class="mpa-rail">
      <h5 class="mpa-rail__title">Cele <span>${p.done} / ${p.total}</span></h5>
      <span class="mpa-meter"><i style="width:${(100 * p.done) / Math.max(1, p.total)}%"></i></span>
      <ul class="mpa-goals mpa-goals--compact">${goalRows(ctx, { compact: true })}</ul>
      <button type="button" class="mpa-link" data-tab="goals">Wszystkie cele ›</button>
    </aside>`;
  return `${tabs(ctx, 'task')}
    <div class="on-parchment mpa-sheet">
      <article class="mpa-read">
        <p class="mpa-chapter">${arrival ? '<b class="mpa-new">Nowy wpis</b>' : ''}Rozdział ${i + 1} · ${lib.receivedAt(i)}</p>
        <h3 class="mpa-title">${lib.esc(page.title)}</h3>
        ${narration(arrival)}
        <div class="mpa-text">${reading(ctx, page)}</div>
      </article>
      ${rail}
    </div>
    <footer class="mpa-foot">${chapterStrip(ctx)}${
      arrival
        ? `<span class="mpa-paused">${PAUSE} Gra wstrzymana</span><button type="button" class="on-button on-button--accent mpa-go">Kontynuuj</button>`
        : `<span class="mpa-running">Gra toczy się dalej</span>`
    }</footer>`;
}

function goalsBody(ctx) {
  const p = progress(ctx);
  return `${tabs(ctx, 'goals')}
    <div class="on-parchment mpa-sheet mpa-sheet--single">
      <div class="mpa-goalhead"><p class="on-parchment__note">Postęp misji · ${p.done} z ${p.total}</p><span class="mpa-meter mpa-meter--wide"><i style="width:${(100 * p.done) / Math.max(1, p.total)}%"></i></span></div>
      <ul class="mpa-goals">${goalRows(ctx, { compact: false })}</ul>
      <p class="mpa-hint">Wyblakłe cele odsłoni dalsza część historii.</p>
    </div>`;
}

function historyBody(ctx) {
  const { lib } = ctx;
  const rows = ctx.pages
    .map((p, i) => {
      const lead = p.segments.find((s) => s.kind === 'para' || s.kind === 'speech');
      const thumb = p.segments.find((s) => s.kind === 'picture' || s.kind === 'mapview');
      const art =
        thumb === undefined
          ? `<span class="mpa-entry__art mpa-entry__art--none">${i + 1}</span>`
          : thumb.kind === 'picture'
            ? `<span class="mpa-entry__art" style="background-image:url(${thumb.src})"></span>`
            : `<span class="mpa-entry__art" style="${lib.mapViewStyle(ctx.map, thumb.icon, 64, 52)}"></span>`;
      return `<li><button type="button" class="mpa-entry${i === ctx.pages.length - 1 ? ' mpa-entry--latest' : ''}" data-page="${i}">${art}<span class="mpa-entry__text"><b>${lib.esc(p.title)}</b><span>${lib.esc((lead?.text ?? '').slice(0, 150))}${(lead?.text.length ?? 0) > 150 ? '…' : ''}</span></span><time>${lib.receivedAt(i)}</time></button></li>`;
    })
    .reverse()
    .join('');
  return `${tabs(ctx, 'history')}
    <div class="on-parchment mpa-sheet mpa-sheet--single">
      <p class="on-parchment__note">Otrzymane wieści · ${ctx.pages.length}</p>
      <ol class="mpa-entries">${rows}</ol>
      <p class="mpa-hint">Tablice historyczne i mitologia są teraz w oknie <b>Wiedza</b>.</p>
    </div>`;
}

function updateView(ctx) {
  const { lib } = ctx;
  const done = ctx.goals.filter((g) => g.state === 'done').at(-1) ?? ctx.goals[0];
  const next = ctx.goals.find((g) => g.state === 'open') ?? ctx.goals[1] ?? ctx.goals[0];
  const card = (seal, kicker, text, glyph) =>
    `<li class="on-notice on-notice--fresh mpa-notice"><button type="button" class="on-notice__card"><span class="on-notice__preview on-notice__preview--glyph mpa-notice__glyph" aria-hidden="true">${glyph}</span><b class="on-notice__event"><small>${kicker}</small>${lib.esc(text)}</b><i class="on-seal${seal}" aria-hidden="true"></i>${lib.GLYPH.go ?? ''}</button></li>`;
  return `<aside class="on-notices mpa-notices" style="left:10px;top:88px;width:173px"><ul class="on-notices__list">${card('', 'Cel wykonany', lib.goalText(done), CHECK)}${card(' on-seal--warn', 'Nowy cel', lib.goalText(next), lib.paintedIcon('mission', 30))}</ul></aside>
    <div class="mpa-beamcue" aria-hidden="true"><span>1</span></div>`;
}

export default {
  id: 'a',
  name: 'Kronika',
  blurb:
    'Okno misji w ramie i pergaminie okna Budowy: zakładki Zadanie / Cele / Kronika, kolumna do czytania z portretami przy wypowiedziach i widokami mapy jako klikalnymi tablicami, obok stały pasek celów. Najbliżej już zaakceptowanego UI, najmniej ryzyka.',
  css: 'a-kronika.css',
  views: ['arrival', 'task', 'goals', 'history', 'update'],
  render(ctx) {
    const { lib } = ctx;
    if (ctx.view === 'update') return updateView(ctx);
    const body =
      ctx.view === 'goals' ? goalsBody(ctx) : ctx.view === 'history' ? historyBody(ctx) : taskBody(ctx, ctx.view === 'arrival');
    const win = lib.hudWindow({
      title: lib.missionName(ctx.mission),
      kicker: 'Misja',
      art: lib.paintedIcon('mission', 43),
      width: W,
      body,
      cls: 'mpa-window',
    });
    return `${ctx.view === 'arrival' ? '<div class="mpa-dim"></div>' : ''}${win}`;
  },
  mount(root, ctx, rerender) {
    const go = (patch) => {
      const params = new URLSearchParams(location.hash.slice(1));
      for (const [k, v] of Object.entries(patch)) params.set(k, v);
      location.hash = params.toString();
      location.reload();
    };
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go({ v: b.dataset.tab })));
    root.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => go({ v: 'task', pg: b.dataset.page })));
    root.querySelectorAll('[data-step]').forEach((b) =>
      b.addEventListener('click', () => go({ pg: String(Math.max(0, ctx.pageIndex + Number(b.dataset.step))) })),
    );
  },
};
