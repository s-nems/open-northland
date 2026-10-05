import { createGoodIconPainter, goodIconMarkup } from '../../src/hud/dom/good-art.ts';
import { GLYPH } from '../../src/hud/dom/icons.ts';
import { createHudPlane } from '../../src/hud/dom/root.ts';
import { createHudWindow } from '../../src/hud/dom/window.ts';
import { initialStock, nations, stances } from './data.js';
import './study.css';

const stage = document.querySelector('#stage');
const scenario = document.querySelector('#scenario');
const stocked = document.querySelector('#stocked');
const plane = createHudPlane(1);
stage.append(plane.element);
const panel = createHudWindow(plane.element, {
  title: 'Dyplomacja',
  kicker: 'RELACJE Z NARODAMI',
  closeLabel: 'Zamknij dyplomację',
  width: 820,
  art: '<span class="on-icon" aria-hidden="true" style="width:43px;height:43px;background-size:129px 129px;background-position:-43px -43px"></span>',
});
panel.element.classList.add('dip-window');
const feedback = document.createElement('p');
feedback.className = 'dip-feedback';
feedback.setAttribute('role', 'status');
panel.element.append(feedback);
const reopen = document.createElement('button');
reopen.className = 'on-button dip-reopen';
reopen.textContent = 'Otwórz dyplomację';
reopen.hidden = true;
plane.element.append(reopen);
const paintGood = createGoodIconPainter(null, null);
let rows = nations();
let stock = { ...initialStock };
let selected = 1;
let confirmation = null;
let pending = false;
let revision = 0;
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const status = (stance) =>
  `<span class="dip-status ${stance}">${GLYPH[stances[stance].icon]}${stances[stance].label}</span>`;
const swatch = (row) => `<span class="dip-swatch" style="--nation:${row.colour}" aria-hidden="true"></span>`;
const section = (title) => `<div class="on-section dip-section"><span>${title}</span></div>`;
const observer = () => scenario.value === 'observer';
const button = (action, label, disabled = false, extra = '') =>
  `<button type="button" class="on-button" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;

function position() {
  const width = Math.min(820, plane.element.clientWidth - 32);
  panel.element.style.maxHeight = `${plane.element.clientHeight - 40}px`;
  panel.place(
    Math.round((plane.element.clientWidth - width) / 2),
    Math.max(20, Math.round((plane.element.clientHeight - panel.element.offsetHeight) / 2)),
  );
}

function notify(message, failed = false) {
  feedback.textContent = message;
  feedback.style.color = failed ? 'var(--warning)' : 'var(--ok)';
}

function renderTribute(tribute) {
  const payable = tribute.demands.every((demand) => stock[demand.good] >= demand.amount);
  const confirm = confirmation?.kind === 'pay' && confirmation.slot === tribute.slot;
  return `<article class="dip-tribute" aria-label="${escapeHtml(tribute.text)}">
    <h4>${escapeHtml(tribute.text)}</h4><p>${escapeHtml(tribute.description)}</p>
    <table class="dip-table"><thead><tr><th scope="col">Towar</th><th scope="col">Koszt</th><th scope="col">Dostępne</th><th scope="col">Brakuje</th></tr></thead>
    <tbody>${tribute.demands.map((d) => `<tr><td><span class="dip-good"><span data-good="${d.good}">${goodIconMarkup()}</span>${escapeHtml(d.label)}</span></td><td>${d.amount}</td><td>${stock[d.good]}</td><td class="${stock[d.good] < d.amount ? 'dip-short' : 'dip-enough'}">${stock[d.good] < d.amount ? d.amount - stock[d.good] : '—'}</td></tr>`).join('')}</tbody></table>
    ${
      confirm
        ? `<div class="dip-confirm"><p>Przekazać te towary? Zostaną pobrane z twoich zapasów.</p><div class="dip-actions">${button('cancel', 'Wróć', pending)}${button('confirm-pay', pending ? 'Przekazywanie…' : 'Potwierdź zapłatę', pending, `data-slot="${tribute.slot}"`)}</div></div>`
        : `<div class="dip-tribute-foot"><span class="${payable ? 'dip-enough' : 'dip-short'}">${observer() ? 'Tylko podgląd' : payable ? 'Wszystkie towary dostępne' : 'Zgromadź brakujące towary'}</span>${button('pay', 'Zapłać trybut', !payable || observer() || pending, `data-slot="${tribute.slot}"`)}</div>`
    }
  </article>`;
}

function renderDetail(row) {
  const locked = row.locked || observer();
  const friendly = row.yourStance === 'friend';
  const offers = row.tradeOffers.length > 0;
  const stanceConfirm = confirmation?.kind === 'stance';
  return `<div class="dip-identity">${swatch(row)}<div><h3>${escapeHtml(row.name)}</h3><p>${observer() ? 'Podgląd relacji plemienia gracza 0' : 'Poznany naród'}</p></div></div>
    ${section('NASTAWIENIE')}
    <div class="dip-relation"><span>Ich nastawienie do ciebie</span>${status(row.towardYou)}</div>
    <span class="dip-label" id="our-stance">Twoje nastawienie do nich</span>
    <div class="dip-stances" role="group" aria-labelledby="our-stance" aria-describedby="stance-help">
    ${Object.entries(stances)
      .map(
        ([id, stance]) =>
          `<button type="button" class="dip-stance" data-action="stance" data-state="${id}" aria-pressed="${row.yourStance === id}" ${locked || pending ? 'disabled' : ''}>${GLYPH[row.yourStance === id ? 'check' : stance.icon]}${stance.label}</button>`,
      )
      .join('')}</div>
    <p class="dip-hint" id="stance-help">${observer() ? `${GLYPH.lock} Obserwujesz grę. Nie możesz zmieniać relacji ani płacić trybutów.` : row.locked ? `${GLYPH.lock} Nastawienie ustala scenariusz. Nie możesz go zmienić.` : 'Zmiana nie wpływa na ich nastawienie do ciebie.'}</p>
    ${stanceConfirm ? `<div class="dip-confirm"><p>${confirmation.state === 'enemy' ? 'Ustawić wrogie nastawienie? Twoi wojownicy będą traktować ten naród jako wroga.' : 'Ustawić neutralne nastawienie? Twoi handlarze przestaną korzystać z ich ofert.'}</p><div class="dip-actions">${button('cancel', 'Wróć', pending)}${button('confirm-stance', pending ? 'Wysyłanie…' : 'Potwierdź zmianę', pending)}</div></div>` : ''}
    ${row.towardYou === 'enemy' && row.yourStance !== 'enemy' ? `<p class="dip-hint dip-warning">${GLYPH.swords} Ten naród jest wobec ciebie wrogi. Twoje nastawienie nie powstrzyma jego ataków.</p>` : ''}
    ${section(`TRYBUTY${row.tributes.length ? ` · ${row.tributes.length}` : ''}`)}
    ${row.tributes.length ? '<p class="dip-hint">Dostępne: zapasy do pobrania z magazynów i zakładów pracy.</p>' : '<p class="dip-hint">Nie masz obecnie trybutów do zapłacenia temu narodowi.</p>'}
    ${row.tributes.map(renderTribute).join('')}
    ${section('HANDEL')}
    <div class="dip-trade">${GLYPH.scales}<div><strong>${!offers ? 'Brak ofert handlowych' : friendly ? 'Możesz korzystać z ofert' : 'Handel wymaga przyjaznego nastawienia'}</strong>
    <p>${!offers ? 'Ten naród nie udostępnia ofert wymiany.' : friendly ? 'Wymianę prowadzą handlarze na wyznaczonych trasach.' : 'Ustaw swoje nastawienie na przyjazne, aby umożliwić wymianę.'}</p>
    ${offers && row.towardYou === 'enemy' ? '<p class="dip-warning">Uwaga: ich wrogość nadal zagraża twoim handlarzom.</p>' : ''}
    ${offers ? `<details class="dip-offers"><summary>Oferty wymiany (${row.tradeOffers.length})</summary><ul>${row.tradeOffers.map((offer) => `<li>${escapeHtml(offer)}</li>`).join('')}</ul></details>` : ''}
    ${friendly && row.towardYou === 'friend' && row.goodsTraded !== undefined ? `<p>Dotychczas wymieniono: <strong>${row.goodsTraded} towarów</strong></p>` : ''}</div></div>`;
}

function render(focusAction) {
  const scroll = panel.body.querySelector('.dip-detail')?.scrollTop ?? 0;
  const layoutScroll = panel.body.querySelector('.dip-layout')?.scrollTop ?? 0;
  const listScroll = panel.body.querySelector('.dip-list')?.scrollTop ?? 0;
  const listScrollX = panel.body.querySelector('.dip-list')?.scrollLeft ?? 0;
  const row = rows.find((item) => item.player === selected);
  if (row === undefined) {
    panel.body.innerHTML = `<div class="dip-empty">${GLYPH.banner}<h3>Nie spotkano jeszcze innych narodów</h3><p>Odkrywaj mapę. Poznane narody pojawią się tutaj wraz z ich nastawieniem i trybutami.</p></div>`;
  } else {
    panel.body.innerHTML = `<div class="dip-layout"><nav class="dip-nav" aria-label="Poznane narody"><h3 class="dip-nav-head">POZNANE NARODY · ${rows.length}</h3><div class="dip-list">
      ${rows.map((nation) => `<button type="button" class="dip-nation" data-action="nation" data-player="${nation.player}" aria-current="${nation.player === selected}">${swatch(nation)}<span><strong>${escapeHtml(nation.name)}</strong><small>Do ciebie: ${stances[nation.towardYou].label.toLowerCase()}</small>${nation.tributes.length ? `<span class="dip-tag">Trybuty: ${nation.tributes.length}</span>` : ''}</span></button>`).join('')}
      </div><p class="dip-nav-note">${observer() ? 'Podgląd obserwatora.' : 'Tylko narody, które już znasz.'}</p></nav><section class="dip-detail" aria-label="Relacje z wybranym narodem">${renderDetail(row)}</section></div>`;
    panel.body.querySelector('.dip-detail').scrollTop = scroll;
    panel.body.querySelector('.dip-layout').scrollTop = layoutScroll;
    panel.body.querySelector('.dip-list').scrollTop = listScroll;
    panel.body.querySelector('.dip-list').scrollLeft = listScrollX;
    for (const el of panel.body.querySelectorAll('[data-good]'))
      paintGood(el.firstElementChild.firstElementChild, el.dataset.good, 25);
  }
  if (focusAction) panel.body.querySelector(focusAction)?.focus({ preventScroll: true });
  if (focusAction === '[data-action="cancel"]')
    panel.body.querySelector('.dip-confirm')?.scrollIntoView({ block: 'nearest' });
  position();
}

async function submit(kind, action) {
  const requestRevision = revision;
  pending = true;
  render();
  notify(kind === 'pay' ? 'Przekazywanie trybutu…' : 'Oczekiwanie na zmianę nastawienia…');
  await new Promise((resolve) => setTimeout(resolve, 650));
  if (requestRevision !== revision) return;
  pending = false;
  if (scenario.value === 'rejected') {
    confirmation = null;
    notify('Polecenie nie zostało wykonane. Stan gry nie zmienił się. Spróbuj ponownie.', true);
  } else {
    action();
    confirmation = null;
  }
  render(`[data-action="nation"][data-player="${selected}"]`);
}

panel.body.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target || target.disabled || pending) return;
  const row = rows.find((item) => item.player === selected);
  if (!row) return;
  const action = target.dataset.action;
  if (action === 'nation') {
    selected = Number(target.dataset.player);
    confirmation = null;
    panel.body.querySelector('.dip-detail').scrollTop = 0;
    panel.body.querySelector('.dip-layout').scrollTop = 0;
    notify('');
    render(`[data-action="nation"][data-player="${selected}"]`);
  } else if (action === 'cancel') {
    const back =
      confirmation?.kind === 'pay'
        ? `[data-action="pay"][data-slot="${confirmation.slot}"]`
        : `[data-action="stance"][data-state="${confirmation?.state}"]`;
    confirmation = null;
    render(back);
  } else if (action === 'stance') {
    const state = target.dataset.state;
    if (observer() || row.locked || row.yourStance === state) return;
    if (
      state === 'enemy' ||
      (row.yourStance === 'friend' && state === 'neutral' && row.tradeOffers.length > 0)
    ) {
      confirmation = { kind: 'stance', state };
      render('[data-action="cancel"]');
    } else {
      void submit('stance', () => {
        row.yourStance = state;
        notify(`Twoje nastawienie do ${row.name}: ${stances[state].label.toLowerCase()}.`);
      });
    }
  } else if (action === 'confirm-stance' && confirmation?.kind === 'stance') {
    const state = confirmation.state;
    void submit('stance', () => {
      row.yourStance = state;
      notify(`Twoje nastawienie do ${row.name}: ${stances[state].label.toLowerCase()}.`);
    });
  } else if (action === 'pay' && !observer()) {
    confirmation = { kind: 'pay', slot: Number(target.dataset.slot) };
    render('[data-action="cancel"]');
  } else if (action === 'confirm-pay' && confirmation?.kind === 'pay' && !observer()) {
    const tribute = row.tributes.find((item) => item.slot === confirmation.slot);
    if (!tribute?.demands.every((d) => stock[d.good] >= d.amount)) return;
    void submit('pay', () => {
      for (const demand of tribute.demands) stock[demand.good] -= demand.amount;
      row.tributes = row.tributes.filter((item) => item.slot !== tribute.slot);
      notify(`Trybut „${tribute.text}” został zapłacony. Towary pobrano z zapasów.`);
    });
  }
});

function reset() {
  revision++;
  rows = scenario.value === 'empty' ? [] : nations();
  stock = stocked.checked ? { wood: 120, food_simple: 80, stone: 90 } : { ...initialStock };
  selected = rows[0]?.player ?? null;
  confirmation = null;
  pending = false;
  if (scenario.value === 'long') {
    const first = rows[0];
    first.name = 'Zjednoczone plemiona leśnych dolin i północnych wzgórz';
    first.tributes.push(
      ...Array.from({ length: 6 }, (_, i) => ({
        ...structuredClone(first.tributes[0]),
        slot: i + 10,
        text: `Prośba rady starszych o pomoc w odbudowie osady — część ${i + 1}`,
      })),
    );
    rows.push(
      ...Array.from({ length: 8 }, (_, i) => ({
        ...structuredClone(rows[1]),
        player: i + 5,
        name: `Strażnicy odległej doliny ${i + 1}`,
      })),
    );
  }
  notify('');
  render();
}

panel.onDismiss(() => {
  confirmation = null;
  reopen.hidden = false;
  reopen.focus();
});
reopen.addEventListener('click', () => {
  reopen.hidden = true;
  render();
  panel.open();
  panel.element.querySelector('.on-window__close').focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !panel.isOpen()) return;
  if (confirmation && !pending) {
    confirmation = null;
    render(`[data-action="nation"][data-player="${selected}"]`);
  } else if (!pending) panel.dismiss();
});
scenario.addEventListener('change', reset);
stocked.addEventListener('change', reset);
document.querySelector('#reset').addEventListener('click', reset);
new ResizeObserver(position).observe(stage);
reset();
panel.open();
position();
