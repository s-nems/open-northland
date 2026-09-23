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
let hint;
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
  if (school && state !== 'early' && current !== undefined) {
    const methods =
      current === 13
        ? [{ label: 'Kolczuga', learned: true }, { label: 'Zbroja płytowa' }]
        : [{ label: 'Żelazo' }, { label: 'Złoto' }];
    sections.push({
      title: current === 13 ? 'Kowal · metody produkcji' : 'Zbieracz · surowce',
      rows: methods.map((row) => ({ ...row, method: true })),
    });
  }
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
    if (
      !visible.has(entry.jobType) ||
      (school && (!schoolJobs.has(entry.jobType) || current === entry.jobType))
    )
      continue;
    const active = !school && current === entry.jobType;
    section.rows.push({
      label: entry.label,
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

function detail(row) {
  if (row.active) return 'Obecny zawód osadnika.';
  if (row.learned) return 'Osadnik już zna tę metodę.';
  if (controls.state.value === 'full' && controls.mode.value === 'school')
    return 'Brak wolnych miejsc w szkole.';
  if (row.blocked) return 'Osadnik potrzebuje doświadczenia lub nauki w szkole.';
  if (controls.mode.value !== 'school') return `Zmień zawód: ${row.label}.`;
  return row.method
    ? `Naucz metody: ${row.label}. Pozostałe umiejętności zostają.`
    : `Naucz zawodu: ${row.label}.`;
}

function renderList() {
  const query = normalize(search.value.trim());
  list.replaceChildren();
  let count = 0;
  for (const group of groups()) {
    const rows = group.rows.filter((row) => normalize(`${group.title} ${row.label}`).includes(query));
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
        row.active ||
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
      button.title = detail(row);
      button.addEventListener('focus', () => {
        hint.textContent = detail(row);
      });
      button.addEventListener('mouseenter', () => {
        hint.textContent = detail(row);
      });
      button.addEventListener('click', () => {
        if (blocked) {
          hint.textContent = detail(row);
          return;
        }
        result.textContent = `Podgląd wyboru: ${row.label}. Okno zamknięte — w grze w tym momencie trafi polecenie.`;
        window.close();
        document.querySelector('#reopen').focus();
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

function open() {
  window?.dispose();
  const school = controls.mode.value === 'school';
  window = createHudWindow(plane.element, {
    title: school ? 'Szkoła' : 'Zmień zawód',
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
        : 'Eryk · Zbieracz';
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
  hint = document.createElement('p');
  hint.className = 'choice-hint';
  hint.textContent = 'Najedź na opcję, aby zobaczyć szczegóły.';
  window.body.append(tools);
  if (school && controls.state.value === 'full') {
    const alert = document.createElement('p');
    alert.className = 'choice-alert';
    alert.textContent = 'Szkoła jest pełna.';
    window.body.append(alert);
  }
  window.body.append(list, hint);
  window.onDismiss(() => document.querySelector('#reopen').focus());
  renderList();
  window.open();
  search.focus({ preventScroll: true });
}
for (const control of Object.values(controls))
  control.addEventListener('change', () => {
    plane.setUiScale(Number(controls.scale.value));
    open();
  });
document.querySelector('#reopen').addEventListener('click', open);
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
