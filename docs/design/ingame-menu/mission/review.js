// Review harness: switches proposal, view, mission and page, and keeps the choice in the URL hash so
// a capture can address one state (#p=a&v=task&m=gringo&pg=2).
import * as lib from './lib.js';
import { PROPOSALS } from './proposals/index.js';

const VIEWS = [
  ['arrival', 'Nowy briefing (skrypt)'],
  ['task', 'Misja otwarta z belki'],
  ['goals', 'Cele'],
  ['history', 'Historia'],
  ['update', 'Zmiana celu (w grze)'],
  ['map', 'Karta celów zwinięta (w grze)'],
];

const proposals = await Promise.all(PROPOSALS.map(async (path) => (await import(`./proposals/${path}`)).default));
const stage = document.querySelector('[data-stage]');
const hud = document.querySelector('[data-hud]');
const css = document.querySelector('[data-proposal-css]');
const blurb = document.querySelector('[data-blurb]');

const state = Object.assign(
  { p: proposals[0].id, v: 'arrival', m: 'gringo', pg: '1' },
  Object.fromEntries(new URLSearchParams(location.hash.slice(1))),
);

function buttons(selector, items, key) {
  const row = document.querySelector(selector);
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.value = value;
    b.addEventListener('click', () => {
      state[key] = value;
      render();
    });
    row.append(b);
  }
}

buttons('[data-proposals]', proposals.map((p) => [p.id, `${p.id.toUpperCase()} · ${p.name}`]), 'p');
buttons('[data-views]', VIEWS, 'v');
const option = document.querySelector('[data-option]');
function optionRow(proposal) {
  option.querySelectorAll('button').forEach((b) => b.remove());
  option.hidden = proposal.option === undefined;
  if (proposal.option === undefined) return;
  option.querySelector('b').textContent = proposal.option.label;
  state.o ??= proposal.option.values[0][0];
  for (const [value, label] of proposal.option.values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === state.o));
    b.addEventListener('click', () => {
      state.o = value;
      render();
    });
    option.append(b);
  }
}

buttons('[data-maps]', Object.keys(lib.MISSIONS).map((m) => [m, lib.missionName(lib.MISSIONS[m])]), 'm');

function render() {
  const proposal = proposals.find((p) => p.id === state.p) ?? proposals[0];
  const mission = lib.MISSIONS[state.m] ?? lib.MISSIONS.gringo;
  const pageIndex = Math.min(Number(state.pg) || 0, mission.pages.length - 1);
  const pagesRow = document.querySelector('[data-pages]');
  pagesRow.querySelectorAll('button').forEach((b) => b.remove());
  mission.pages.forEach((page, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${i + 1}. ${lib.analysePage(page).title.slice(0, 22)}`;
    b.setAttribute('aria-pressed', String(i === pageIndex));
    b.addEventListener('click', () => {
      state.pg = String(i);
      render();
    });
    pagesRow.append(b);
  });
  for (const row of ['[data-proposals]', '[data-views]', '[data-maps]']) {
    const key = { '[data-proposals]': 'p', '[data-views]': 'v', '[data-maps]': 'm' }[row];
    document.querySelectorAll(`${row} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === state[key])));
  }
  document.querySelectorAll('[data-views] button').forEach((b) => {
    b.disabled = !(proposal.views ?? VIEWS.map((v) => v[0])).includes(b.dataset.value);
  });
  optionRow(proposal);
  document.querySelector('[data-proposals]').hidden = proposals.length < 2;
  location.replace(`#${new URLSearchParams(state)}`);
  css.href = proposal.css ? `mission/proposals/${proposal.css}` : '';
  blurb.innerHTML = `<strong>${lib.esc(proposal.name)}.</strong> ${proposal.blurb}`;
  stage.style.backgroundImage = `url(${proposal.background?.(state.m, state.v) ?? lib.worldUrl(state.m)})`;
  const ctx = {
    lib,
    map: state.m,
    mission,
    lang: 'pl',
    view: state.v,
    option: state.o,
    pageIndex,
    page: lib.analysePage(mission.pages[pageIndex]),
    pages: mission.pages.slice(0, pageIndex + 1).map((p) => lib.analysePage(p)),
    goals: mission.goals,
  };
  hud.className = `on-hud mp-root mp-${proposal.id}`;
  hud.innerHTML = lib.SYMBOLS + ((proposal.views ?? []).includes(state.v) || !proposal.views ? proposal.render(ctx) : '');
  proposal.mount?.(hud, ctx, render);
}

render();
