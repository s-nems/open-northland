import {
  animalEntryHtml,
  armourOf,
  armourSheet,
  tribeEntryHtml,
  vehicleEntryHtml,
  weaponOf,
  weaponSheet,
} from './entry-stats.js';
import {
  animalPicture,
  buildingByType,
  buildingHitpoints,
  buildingLink,
  buildingStatus,
  buildingsCosting,
  buildingThumb,
  DEMO,
  data,
  esc,
  goodById,
  goodByType,
  goodIcon,
  goodLink,
  jobByType,
  jobLink,
  number,
  producersOf,
  rawCost,
  recipesOf,
  seconds,
  usesOf,
} from './model.js';

const KIND_NAME = {
  home: 'Mieszkanie',
  storage: 'Magazyn',
  workplace: 'Warsztat',
  training: 'Nauka',
  tower: 'Obrona',
  vehicle: 'Pojazd',
  wonder: 'Cud',
};

const ARMS = /^(spear|sword|bow|armor)_/;
const VEHICLE_IDS = new Set(data.vehicles.map((v) => v.id));

const inGoods = (g) => !ARMS.test(g.id) && !VEHICLE_IDS.has(g.id);
const plainBuildings = () => data.buildings.filter((b) => b.kind !== 'vehicle' && b.kind !== 'wonder');
const wonders = () => data.buildings.filter((b) => b.kind === 'wonder');

export const CATEGORIES = [
  { id: 'goods', name: 'Towary', count: () => data.goods.filter(inGoods).length },
  { id: 'arms', name: 'Uzbrojenie', count: () => data.goods.filter((g) => ARMS.test(g.id)).length },
  { id: 'buildings', name: 'Budynki', count: () => plainBuildings().length },
  { id: 'wonders', name: 'Cuda', count: () => wonders().length },
  { id: 'jobs', name: 'Zawody', count: () => data.jobs.length },
  { id: 'vehicles', name: 'Pojazdy', count: () => data.vehicles.length },
  { id: 'animals', name: 'Zwierzęta', count: () => data.animals.length },
  { id: 'tribes', name: 'Plemiona', count: () => data.tribes.length },
];

/** The category an entry lists under, and the entry a tree card opens. */
export function placeOf(entry) {
  if (entry.kind === 'good' && VEHICLE_IDS.has(entry.id)) {
    return { category: 'vehicles', entry: { kind: 'vehicle', id: entry.id } };
  }
  if (entry.kind === 'good') return { category: ARMS.test(entry.id) ? 'arms' : 'goods', entry };
  if (entry.kind === 'building') {
    const kind = data.buildings.find((b) => b.id === entry.id)?.kind;
    if (kind === 'vehicle') return { category: 'vehicles', entry: { kind: 'vehicle', id: entry.id } };
    return { category: kind === 'wonder' ? 'wonders' : 'buildings', entry };
  }
  const category = { job: 'jobs', vehicle: 'vehicles', animal: 'animals', tribe: 'tribes' };
  return { category: category[entry.kind], entry };
}

function listItems(category) {
  const goodRow = (g) => ({ key: `good:${g.id}`, name: g.name, picture: goodIcon(g) });
  const buildingRow = (b) => ({ key: `building:${b.id}`, name: b.name, picture: buildingThumb(b) });
  if (category === 'buildings') return plainBuildings().map(buildingRow);
  if (category === 'wonders') return wonders().map(buildingRow);
  if (category === 'jobs') return data.jobs.map((j) => ({ key: `job:${j.id}`, name: j.name, picture: '' }));
  if (category === 'vehicles') {
    return data.vehicles.map((v) => ({
      key: `vehicle:${v.id}`,
      name: v.name,
      picture: goodIcon(goodById.get(v.id)),
    }));
  }
  if (category === 'animals')
    return data.animals.map((a) => ({ key: `animal:${a.tribe}`, name: a.name, picture: animalPicture(a) }));
  if (category === 'tribes')
    return data.tribes.map((t) => ({ key: `tribe:${t.typeId}`, name: t.name, picture: '' }));
  if (category === 'arms') return data.goods.filter((g) => ARMS.test(g.id)).map(goodRow);
  return data.goods.filter(inGoods).map(goodRow);
}

function statusLine(status) {
  return `<p class="kn-chip kn-chip--${status.kind}">${esc(status.text)}</p>`;
}

/** In a running game what the settlement has fades, so the missing ones stand out. */
const met = (state, known, name) => (state.mode === 'game' && known.has(name) ? 'kn-met' : '');

function recipeRow(recipe) {
  const inputs = recipe.inputs.map((i) => goodLink(goodByType.get(i.goodType), i.amount)).join('<i>+</i>');
  const outputs = recipe.outputs.map((o) => goodLink(goodByType.get(o.goodType), o.amount)).join('');
  return `<tr><td class="kn-recipe">${inputs}</td><td class="kn-recipe__to">→</td><td class="kn-recipe">${outputs}</td><td class="kn-num">${seconds(recipe.ticks)} s</td></tr>`;
}

function originalText(help) {
  return help === null
    ? ''
    : `<blockquote class="kn-origin">${esc(help).replaceAll('\n', '<br>')}<cite>opis z oryginału</cite></blockquote>`;
}

function howToGet(good) {
  const sources = recipesOf.get(good.typeId) ?? [];
  const rows = sources
    .map(
      ({ building, recipe }) =>
        `<tr><td>${buildingLink(building)}</td>${recipeRow(recipe).replace('<tr>', '').replace('</tr>', '')}</tr>`,
    )
    .join('');
  const fills = producersOf(good);
  const workers = data.gatheredBy[good.typeId] ?? [];
  return `<h3 class="kn-h">Jak zdobyć</h3>
    ${rows === '' ? '' : `<table class="kn-table kn-table--plain"><tbody>${rows}</tbody></table>`}
    ${fills.length === 0 ? '' : `<p>Powstaje w: ${fills.map(buildingLink).join(', ')}</p>`}
    ${workers.length > 0 && sources.length === 0 ? `<p>Pozyskuje: ${workers.map((w) => (jobByType.has(w.job) ? jobLink(jobByType.get(w.job)) : esc(w.name))).join(', ')}</p>` : ''}`;
}

function usesOfGood(good) {
  const uses = usesOf.get(good.typeId) ?? [];
  const costs = buildingsCosting(good);
  const outputs = [
    ...new Map(
      uses.flatMap((u) => u.recipe.outputs.map((o) => [o.goodType, goodByType.get(o.goodType)])),
    ).values(),
  ];
  const usable =
    good.equip !== null
      ? 'Osadnik nosi to przy sobie.'
      : good.edibleForm !== null
        ? 'Jedzenie.'
        : 'Nie jest składnikiem ani materiałem.';
  return `<h3 class="kn-h">Do czego służy</h3>
    ${outputs.length === 0 ? '' : `<p>Składnik: ${outputs.map((g) => goodLink(g)).join(' ')}</p>`}
    ${costs.length === 0 ? '' : `<p>Materiał na: ${costs.slice(0, 12).map(buildingLink).join(', ')}${costs.length > 12 ? ` i ${costs.length - 12} więcej` : ''}</p>`}
    ${outputs.length === 0 && costs.length === 0 ? `<p>${usable}</p>` : ''}`;
}

function rawCostHtml(good) {
  const raw = [...rawCost(good.typeId)];
  return raw.length > 0 && raw[0][0] !== good.typeId
    ? `<h3 class="kn-h">Koszt w surowcach</h3><div class="kn-links">${raw.map(([t, a]) => goodLink(goodByType.get(t), a)).join('')}</div>`
    : '';
}

function treeLink(good) {
  return `<button class="kn-link" data-show="good:${good.id}"><span>Pokaż w drzewie</span></button>`;
}

function kicker(good) {
  if (armourOf(good) !== undefined) return 'Uzbrojenie · Pancerz';
  if (ARMS.test(good.id)) return 'Uzbrojenie · Broń';
  return good.equip === null ? 'Towar' : 'Towar · Wyposażenie';
}

function goodEntry(good, state) {
  const armour = armourOf(good);
  const sheet =
    armour !== undefined
      ? armourSheet(good, state.tribe)
      : ARMS.test(good.id) && weaponOf(good, state.tribe) !== undefined
        ? weaponSheet(good, state.tribe)
        : null;
  const equip = good.equip;
  return `<article class="kn-entry">
    <header class="kn-entry__head">${goodIcon(good)}<div><h2>${esc(good.name)}</h2><p>${kicker(good)}</p></div></header>
    ${state.mode === 'game' && good.name === 'Długi Miecz' ? statusLine({ kind: 'locked', text: 'Jeszcze nieodkryty: 5 × Kowalstwo' }) : ''}
    <div class="kn-entry__cols">
      <div>
        ${sheet === null ? originalText(good.help) : sheet.left}
        ${howToGet(good)}
        ${usesOfGood(good)}
        ${sheet === null ? '' : originalText(good.help)}
      </div>
      <aside class="kn-facts">
        ${sheet === null ? '' : sheet.right}
        ${equip === null ? '' : `<h3 class="kn-h">Na wyposażeniu</h3><dl><dt>Miejsce</dt><dd>${esc(equip.slot)}</dd><dt>Działanie</dt><dd>${esc(equip.effect)}</dd><dt>Trwałość</dt><dd>${esc(equip.wears)}</dd></dl>`}
        ${good.food === null ? '' : `<h3 class="kn-h">Posiłek</h3><dl><dt>Poza domem</dt><dd>${esc(good.food.outside)}</dd>${good.food.home === null ? '' : `<dt>W domu</dt><dd>${esc(good.food.home)}</dd>`}</dl>`}
        ${rawCostHtml(good)}
        <h3 class="kn-h">Zobacz też</h3>
        <div class="kn-links">${treeLink(good)}
        ${ARMS.test(good.id) ? '<button class="kn-link" data-article="damage"><span>Mechanika: broń i obrażenia</span></button>' : ''}
        ${/tool/.test(good.id) ? '<button class="kn-link" data-article="tools"><span>Mechanika: narzędzia</span></button>' : ''}
        ${good.food === null ? '' : '<button class="kn-link" data-article="food"><span>Mechanika: jedzenie</span></button>'}</div>
      </aside>
    </div></article>`;
}

function wonderEntry(building) {
  return `<article class="kn-entry">
    <header class="kn-entry__head kn-entry__head--building">${buildingThumb(building)}<div><h2>${esc(building.name)}</h2><p>Cud</p></div></header>
    ${originalText(building.help)}
    <h3 class="kn-h">W grze</h3>
    <p>Cud stoi na mapach, które go przewidują, i nie daje żadnego działania w rozgrywce.</p></article>`;
}

function buildingEntry(building, state) {
  if (building.kind === 'wonder') return wonderEntry(building);
  const previous = data.buildings.find((b) => b.upgradeTarget === building.typeId);
  const next = building.upgradeTarget == null ? undefined : buildingByType.get(building.upgradeTarget);
  const recipes = building.recipes.map(recipeRow).join('');
  const workers = building.workers
    .map(
      (w) =>
        `<li>${jobByType.has(w.job) ? jobLink(jobByType.get(w.job)) : esc(w.name)} <span>do ${w.count}</span></li>`,
    )
    .join('');
  const tech = building.tech;
  return `<article class="kn-entry">
    <header class="kn-entry__head kn-entry__head--building">${buildingThumb(building)}<div><h2>${esc(building.name)}</h2><p>Budynek · ${esc(KIND_NAME[building.kind] ?? '')}</p></div></header>
    ${state.mode === 'game' ? statusLine(buildingStatus(building)) : ''}
    <div class="kn-entry__cols">
      <div>
        ${originalText(building.help)}
        ${recipes === '' ? '' : `<h3 class="kn-h">Co wytwarza</h3><table class="kn-table kn-table--plain"><tbody>${recipes}</tbody></table>`}
        ${workers === '' ? '' : `<h3 class="kn-h">Pracownicy</h3><ul class="kn-workers">${workers}</ul>`}
      </div>
      <aside class="kn-facts">
        <h3 class="kn-h">Budowa</h3>
        <div class="kn-links">${building.cost.map((c) => goodLink(goodByType.get(c.good), c.amount)).join('') || '<span>Nie buduje się</span>'}</div>
        <dl>
          <dt>Zdrowie</dt><dd>${building.hitpoints === null ? '-' : number(buildingHitpoints(building, state.tribe))}</dd>
          ${building.homeSize > 0 ? `<dt>Rodziny</dt><dd>${building.homeSize}</dd>` : ''}
          ${building.schoolSize > 0 ? `<dt>Miejsca nauki</dt><dd>${building.schoolSize}</dd>` : ''}
        </dl>
        ${previous === undefined && next === undefined ? '' : `<h3 class="kn-h">Poziomy</h3><p class="kn-tierline">${previous === undefined ? '' : `${buildingLink(previous)} → `}<b>${esc(building.name)}</b>${next === undefined ? '' : ` → ${buildingLink(next)}`}</p>`}
        ${tech === null ? '' : `<h3 class="kn-h">Wymaga odkrycia</h3><div class="kn-links">${tech.jobs.map((j) => `<span class="${met(state, DEMO.jobs, j.name)}">${jobByType.has(j.id) ? jobLink(jobByType.get(j.id)) : esc(j.name)}</span>`).join('')}${tech.goods.map((g) => `<span class="${met(state, DEMO.goods, g.name)}">${goodLink(goodByType.get(g.id))}</span>`).join('')}</div>`}
      </aside>
    </div></article>`;
}

function jobEntry(job) {
  const need = job.requirements.filter((r) => r.route === 'need');
  const train = job.requirements.filter((r) => r.route === 'train');
  const places = data.buildings.filter((b) => b.workers.some((w) => w.job === job.typeId));
  const makes = (job.enables.good ?? []).map((g) => goodLink(goodByType.get(g.id))).join('');
  const next = data.jobs.filter((j) =>
    j.requirements.some((r) => r.route === 'need' && r.fromJobs.includes(job.typeId)),
  );
  return `<article class="kn-entry">
    <header class="kn-entry__head"><div><h2>${esc(job.name)}</h2><p>Zawód${job.needsReligion ? ' · wymaga wiary przy pracy' : ''}</p></div></header>
    <div class="kn-entry__cols">
      <div>
        <h3 class="kn-h">Jak się nauczyć</h3>
        ${need.length === 0 ? '<p>Zawód dostępny od początku.</p>' : `<ul class="kn-steps">${need.map((r) => `<li><b>Praktyka:</b> ${r.amount} × ${esc(r.experience.join(' + '))}</li>`).join('')}${train.map((r) => `<li><b>Szkoła:</b> ${r.amount} s nauki, jeśli zawód jest już odkryty</li>`).join('')}</ul>`}
        ${makes === '' ? '' : `<h3 class="kn-h">Co wytwarza</h3><div class="kn-links">${makes}</div>`}
        ${next.length === 0 ? '' : `<h3 class="kn-h">Otwiera drogę do</h3><p>${next.map(jobLink).join(', ')}</p>`}
      </div>
      <aside class="kn-facts">
        <h3 class="kn-h">Miejsca pracy</h3>
        <p>${places.length === 0 ? 'Bez przypisanego budynku' : places.slice(0, 8).map(buildingLink).join(', ')}</p>
        <h3 class="kn-h">Zobacz też</h3>
        <div class="kn-links"><button class="kn-link" data-article="trades"><span>Mechanika: zawody i szkoła</span></button></div>
      </aside>
    </div></article>`;
}

function entryHtml(entry, state) {
  if (entry === null) return '<p class="kn-empty">Wybierz hasło z listy.</p>';
  if (entry.kind === 'good') return goodEntry(goodById.get(entry.id), state);
  if (entry.kind === 'building')
    return buildingEntry(
      data.buildings.find((b) => b.id === entry.id),
      state,
    );
  if (entry.kind === 'job') return jobEntry(data.jobs.find((j) => j.id === entry.id));
  if (entry.kind === 'vehicle') return vehicleEntryHtml(data.vehicles.find((v) => v.id === entry.id));
  if (entry.kind === 'animal') {
    return animalEntryHtml(
      data.animals.find((a) => String(a.tribe) === entry.id),
      state.tribe,
    );
  }
  return tribeEntryHtml(data.tribes.find((t) => String(t.typeId) === entry.id));
}

export function encyclopediaView(state) {
  const rail = CATEGORIES.map(
    (c) =>
      `<button class="kn-rail__item" aria-current="${state.category === c.id}" data-category="${c.id}"><span>${c.name}</span><small>${c.count()}</small></button>`,
  ).join('');
  const items = listItems(state.category).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const selected = state.entry === null ? '' : `${state.entry.kind}:${state.entry.id}`;
  const list = items
    .map(
      (item) =>
        `<button class="kn-row${item.key === selected ? ' is-selected' : ''}" data-pick="${esc(item.key)}">${item.picture}<span>${esc(item.name)}</span></button>`,
    )
    .join('');
  return `<div class="kn-enc">
    <nav class="kn-rail">${rail}</nav>
    <div class="kn-list" data-keep-scroll="enc-list">${list}</div>
    <div class="on-parchment kn-page" data-keep-scroll="entry-${esc(selected)}">${entryHtml(state.entry, state)}</div>
  </div>`;
}
