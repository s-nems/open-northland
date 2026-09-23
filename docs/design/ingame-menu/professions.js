import { pickerEntries } from '../../../packages/app/src/catalog/professions.ts';
import { GLYPH } from '../../../packages/app/src/hud/dom/icons.ts';
import { createHudPlane } from '../../../packages/app/src/hud/dom/root.ts';
import { createHudWindow } from '../../../packages/app/src/hud/dom/window.ts';
import { setActiveLocale } from '../../../packages/app/src/i18n/index.ts';

setActiveLocale('pol');
const stage = document.querySelector('#stage');
const plane = createHudPlane(1);
stage.append(plane.element);
const controls = Object.fromEntries(
  ['mode', 'person', 'state', 'scale'].map((id) => [id, document.getElementById(id)]),
);
const result = document.querySelector('#result');
let window;
let search;
let list;
let selectedProfession;
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const normalize = (text) =>
  text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll('ł', 'l');
const schoolJobs = new Set([9, 10, 11, 12, 13, 14, 17, 19, 20, 21, 25, 29, 30]);
const earlyJobs = new Set([6, 7, 8, 9, 15, 18, 22, 24, 27]);
const knownJobs = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 24, 25, 27, 29, 31]);
const qualified = new Set([6, 7, 8, 9, 13, 15, 18, 22, 24, 27]);

function groups() {
  const school = controls.mode.value === 'school';
  const current =
    controls.person.value === 'smith' ? 13 : controls.person.value === 'collector' ? 8 : undefined;
  const state = controls.state.value;
  if (state === 'empty') return [];
  const visible = state === 'early' ? earlyJobs : knownJobs;
  const sections = [];
  let section = { title: school ? 'Zawody' : 'Bez zawodu', rows: [] };
  sections.push(section);
  for (const entry of pickerEntries('pol')) {
    if (entry.kind === 'header') {
      if (!school) {
        section = { title: entry.label, rows: [] };
        sections.push(section);
      }
      continue;
    }
    if (!visible.has(entry.jobType) || (school && !schoolJobs.has(entry.jobType) && entry.jobType !== 8))
      continue;
    const active = !school && current === entry.jobType;
    section.rows.push({
      label: entry.label,
      jobType: entry.jobType,
      active,
      blocked: !school && !active && !qualified.has(entry.jobType),
    });
  }
  if (!school) {
    const basic = sections.splice(0, 3);
    sections.unshift({ title: 'Podstawowe', rows: basic.flatMap((group) => group.rows) });
  }
  if (state === 'long')
    sections[0].rows.push({
      label: 'Przykładowa bardzo długa nazwa specjalizacji rzemieślniczej',
      method: school,
    });
  for (const group of sections) group.rows.sort((a, b) => collator.compare(a.label, b.label));
  return sections.filter((group) => group.rows.length > 0);
}

function methodsFor(row) {
  if (controls.state.value === 'early') return [];
  const methods =
    row.jobType === 13
      ? [{ label: 'Długi miecz' }, { label: 'Kolczuga' }, { label: 'Zbroja płytowa' }]
      : row.jobType === 8
        ? [{ label: 'Żelazo' }, { label: 'Złoto' }]
        : [];
  return controls.state.value === 'single' ? methods.slice(0, 1) : methods;
}

function finish(label) {
  result.textContent = `Podgląd wyboru: ${label}.`;
  window.close();
  document.querySelector('#reopen').focus();
}

function renderList() {
  const query = normalize(search.value.trim());
  list.replaceChildren();
  let count = 0;
  const shown = selectedProfession
    ? [{ title: 'Metoda produkcji', rows: methodsFor(selectedProfession) }]
    : groups();
  for (const group of shown) {
    const rows = group.rows.filter((row) => normalize(row.label).startsWith(query));
    if (rows.length === 0) continue;
    count += rows.length;
    const section = document.createElement('section');
    section.className = 'choice-group';
    const heading = document.createElement('h3');
    heading.textContent = group.title;
    const tally = document.createElement('span');
    tally.textContent = String(rows.length);
    heading.append(tally);
    const grid = document.createElement('div');
    grid.className = 'choice-grid';
    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'on-button choice-row';
      const label = document.createElement('span');
      label.textContent = row.label;
      button.append(label);
      const blocked =
        row.learned ||
        row.blocked ||
        (row.active && methodsFor(row).length === 0) ||
        (controls.state.value === 'full' && controls.mode.value === 'school');
      button.setAttribute('aria-disabled', String(Boolean(blocked)));
      if (row.active) button.dataset.current = 'true';
      const badge = row.active ? 'Obecny' : row.learned ? 'Znana' : row.blocked ? 'Nauka' : '';
      if (badge) {
        const tag = document.createElement('span');
        tag.className = 'choice-tag';
        tag.textContent = badge;
        button.append(tag);
      }
      if (blocked) button.title = row.active ? 'Obecny zawód' : 'Niedostępne dla wybranego osadnika';
      button.addEventListener('click', () => {
        if (blocked) return;
        if (selectedProfession) {
          finish(`${selectedProfession.label} · ${row.label}`);
          return;
        }
        const methods = methodsFor(row);
        if (methods.length > 1) open(row);
        else finish(methods.length === 1 ? `${row.label} · ${methods[0].label}` : row.label);
      });
      grid.append(button);
    }
    section.append(heading, grid);
    list.append(section);
  }
  if (count === 0) {
    const empty = document.createElement('p');
    empty.className = 'choice-empty';
    empty.textContent = query ? 'Brak pasujących opcji.' : 'Brak odkrytych opcji dla tego wyboru.';
    list.append(empty);
  }
}

function open(profession) {
  selectedProfession = profession;
  window?.dispose();
  const school = controls.mode.value === 'school';
  window = createHudWindow(plane.element, {
    title: selectedProfession?.label ?? (school ? 'Szkoła' : 'Zmień zawód'),
    closeLabel: 'Zamknij',
    width: 448,
    compact: true,
  });
  window.element.classList.add('profession-preview');
  window.element.setAttribute('role', 'dialog');
  const tools = document.createElement('div');
  tools.className = 'choice-tools';
  const context = document.createElement('div');
  context.className = 'choice-context';
  const identity = document.createElement('span');
  identity.textContent =
    controls.person.value === 'group'
      ? '3 osadników · różne zawody'
      : controls.person.value === 'smith'
        ? 'Eryk · Kowal'
        : controls.person.value === 'collector'
          ? 'Eryk · Zbieracz'
          : 'Eryk · Cywil';
  context.append(identity);
  if (school) {
    const capacity = document.createElement('span');
    capacity.textContent = controls.state.value === 'full' ? 'Miejsca 5 / 5' : 'Miejsca 2 / 5';
    context.append(capacity);
  }
  const field = document.createElement('label');
  field.className = 'on-res-field on-res-field--search choice-search';
  field.innerHTML = `${GLYPH.search}<input type="search" placeholder="Szukaj…" aria-label="Szukaj zawodu lub metody" autocomplete="off">`;
  search = field.querySelector('input');
  search.addEventListener('input', renderList);
  tools.append(context, field);
  list = document.createElement('div');
  list.className = 'choice-list';
  window.body.append(tools);
  if (school && controls.state.value === 'full') {
    const alert = document.createElement('p');
    alert.className = 'choice-alert';
    alert.textContent = 'Szkoła jest pełna.';
    window.body.append(alert);
  }
  window.body.append(list);
  window.onDismiss(() => {
    if (selectedProfession) open();
    else document.querySelector('#reopen').focus();
  });
  renderList();
  window.open();
  search.focus({ preventScroll: true });
  search.select();
}
for (const control of Object.values(controls))
  control.addEventListener('change', () => {
    plane.setUiScale(Number(controls.scale.value));
    open();
  });
document.querySelector('#reopen').addEventListener('click', () => open());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && window.isOpen()) {
    if (search.value) {
      search.value = '';
      renderList();
      search.focus();
    } else window.dismiss();
    event.preventDefault();
  }
});
open();
