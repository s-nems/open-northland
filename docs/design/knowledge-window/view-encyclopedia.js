import {
  buildingByType,
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
  LANES,
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

export const CATEGORIES = [
  { id: 'goods', name: 'Towary', count: () => data.goods.length },
  { id: 'buildings', name: 'Budynki', count: () => data.buildings.length },
  { id: 'jobs', name: 'Zawody', count: () => data.jobs.length },
  { id: 'arms', name: 'Broń i pancerze', count: () => 14 },
  { id: 'vehicles', name: 'Pojazdy', count: () => data.vehicles.length },
  { id: 'animals', name: 'Zwierzęta', count: () => data.animals.length },
  { id: 'tribes', name: 'Plemiona', count: () => data.tribes.length },
  { id: 'world', name: 'Świat', count: () => 6 },
];

function listItems(category) {
  if (category === 'buildings') {
    return data.buildings
      .filter((b) => b.kind !== 'vehicle')
      .map((b) => ({ key: `building:${b.id}`, name: b.name, picture: buildingThumb(b) }));
  }
  if (category === 'jobs') return data.jobs.map((j) => ({ key: `job:${j.id}`, name: j.name, picture: '' }));
  if (category === 'vehicles')
    return data.vehicles.map((v) => ({
      key: `vehicle:${v.id}`,
      name: v.name === 'oxcart' ? 'Zaprzęg' : v.name,
      picture: '',
    }));
  if (category === 'animals')
    return data.animals.map((a) => ({ key: `animal:${a.tribe}`, name: a.name, picture: '' }));
  if (category === 'tribes')
    return data.tribes.map((t) => ({ key: `tribe:${t.typeId}`, name: t.name, picture: '' }));
  if (category === 'world') {
    return ['Skrzynie', 'Papiery', 'Palisady i bramy', 'Drogi', 'Drogowskazy', 'Teren'].map((name) => ({
      key: `world:${name}`,
      name,
      picture: '',
    }));
  }
  if (category === 'arms') {
    return data.goods
      .filter((g) => /^(spear|sword|bow|armor)_/.test(g.id))
      .map((g) => ({ key: `good:${g.id}`, name: g.name, picture: goodIcon(g) }));
  }
  return data.goods.map((g) => ({ key: `good:${g.id}`, name: g.name, picture: goodIcon(g) }));
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

function goodEntry(good, state) {
  const sources = recipesOf.get(good.typeId) ?? [];
  const sourceRows = sources
    .map(
      ({ building, recipe }) =>
        `<tr><td>${buildingLink(building)}</td>${recipeRow(recipe).replace('<tr>', '').replace('</tr>', '')}</tr>`,
    )
    .join('');
  const fills = producersOf(good);
  const uses = usesOf.get(good.typeId) ?? [];
  const costs = buildingsCosting(good);
  const raw = [...rawCost(good.typeId)];
  const equip = good.equip;
  const lane = LANES.find((l) => l.id === good.lane)?.name ?? '';
  return `<article class="kn-entry">
    <header class="kn-entry__head">${goodIcon(good)}<div><h2>${esc(good.name)}</h2><p>Towar · ${esc(lane)}</p></div></header>
    ${state.mode === 'game' && good.name === 'Długi Miecz' ? statusLine({ kind: 'locked', text: 'Jeszcze nieodkryty: 5 × Kowalstwo' }) : ''}
    <div class="kn-entry__cols">
      <div>
        ${originalText(good.help)}
        <h3 class="kn-h">Jak zdobyć</h3>
        ${sourceRows === '' ? '' : `<table class="kn-table kn-table--plain"><tbody>${sourceRows}</tbody></table>`}
        ${fills.length === 0 ? '' : `<p>Powstaje w: ${fills.map(buildingLink).join(', ')}</p>`}
        ${(data.gatheredBy[good.typeId] ?? []).length > 0 && sources.length === 0 ? `<p>Pozyskuje: ${data.gatheredBy[good.typeId].map((w) => (jobByType.has(w.job) ? jobLink(jobByType.get(w.job)) : esc(w.name))).join(', ')}</p>` : ''}
        <h3 class="kn-h">Do czego służy</h3>
        ${
          uses.length === 0
            ? ''
            : `<p>Składnik: ${[
                ...new Map(
                  uses.flatMap((u) => u.recipe.outputs.map((o) => [o.goodType, goodByType.get(o.goodType)])),
                ).values(),
              ]
                .slice(0, 12)
                .map((g) => goodLink(g))
                .join(' ')}</p>`
        }
        ${costs.length === 0 ? '' : `<p>Materiał na: ${costs.slice(0, 12).map(buildingLink).join(', ')}${costs.length > 12 ? ` i ${costs.length - 12} więcej` : ''}</p>`}
        ${uses.length === 0 && costs.length === 0 ? `<p>${equip !== null ? 'Osadnik nosi to przy sobie.' : good.edibleForm !== null ? 'Jedzenie.' : 'Nie jest składnikiem ani materiałem.'}</p>` : ''}
      </div>
      <aside class="kn-facts">
        ${equip === null ? '' : `<h3 class="kn-h">Na wyposażeniu</h3><dl><dt>Miejsce</dt><dd>${esc(equip.slot)}</dd><dt>Działanie</dt><dd>${esc(equip.effect)}</dd><dt>Trwałość</dt><dd>${esc(equip.wears)}</dd></dl>`}
        ${raw.length > 0 && raw[0][0] !== good.typeId ? `<h3 class="kn-h">Koszt w surowcach</h3><div class="kn-links">${raw.map(([t, a]) => goodLink(goodByType.get(t), a)).join('')}</div>` : ''}
        <h3 class="kn-h">Zobacz też</h3>
        <div class="kn-links"><button class="kn-link" data-show="production:good:${good.id}"><span>Pokaż w drzewie produkcji</span></button>
        ${/armor|sword|spear|bow/.test(good.id) ? '<button class="kn-link" data-table="matrix"><span>Tabela: broń i pancerz</span></button>' : ''}
        ${/tool/.test(good.id) ? '<button class="kn-link" data-article="tools"><span>Mechanika: narzędzia</span></button>' : ''}</div>
      </aside>
    </div></article>`;
}

function buildingEntry(building, state) {
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
          <dt>Wytrzymałość</dt><dd>${building.hitpoints === null ? '-' : number(building.hitpoints)}</dd>
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
        <div class="kn-links"><button class="kn-link" data-article="experience"><span>Mechanika: doświadczenie</span></button></div>
      </aside>
    </div></article>`;
}

function vehicleEntry(id) {
  const vehicle = data.vehicles.find((v) => v.id === id);
  const name = vehicle.name === 'oxcart' ? 'Zaprzęg' : vehicle.name;
  return `<article class="kn-entry"><header class="kn-entry__head"><div><h2>${esc(name)}</h2><p>Pojazd</p></div></header>
    <dl class="kn-facts__wide"><dt>Ładownia</dt><dd>${vehicle.stockSlots}</dd><dt>Pasażerowie</dt><dd>${vehicle.passengerSlots}</dd><dt>Wytrzymałość</dt><dd>${number(vehicle.hitpoints)}</dd></dl></article>`;
}

function animalEntry(tribe) {
  const animal = data.animals.find((a) => String(a.tribe) === tribe);
  return `<article class="kn-entry"><header class="kn-entry__head"><div><h2>${esc(animal.name)}</h2><p>Zwierzę</p></div></header>
    <dl class="kn-facts__wide"><dt>Zdrowie</dt><dd>${number(animal.hitpoints)}</dd><dt>Agresywne</dt><dd>${animal.aggressive ? 'tak' : animal.getAngry ? 'gdy zaatakowane' : 'nie'}</dd><dt>Można oswoić</dt><dd>${animal.catchable ? 'tak' : 'nie'}</dd><dt>Stado do</dt><dd>${animal.groupSize}</dd></dl></article>`;
}

function placeholderEntry(title, kicker) {
  return `<article class="kn-entry"><header class="kn-entry__head"><div><h2>${esc(title)}</h2><p>${esc(kicker)}</p></div></header>
    <p class="kn-todo">Hasło do napisania. Układ taki sam jak w pozostałych: opis, liczby po prawej, odnośniki.</p></article>`;
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
  if (entry.kind === 'vehicle') return vehicleEntry(entry.id);
  if (entry.kind === 'animal') return animalEntry(entry.id);
  if (entry.kind === 'tribe')
    return placeholderEntry(data.tribes.find((t) => String(t.typeId) === entry.id).name, 'Plemię');
  return placeholderEntry(entry.id, 'Świat');
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
  const at = items.findIndex((item) => item.key === selected);
  const step = (item, label) =>
    item === undefined
      ? '<span></span>'
      : `<button class="kn-link" data-pick="${esc(item.key)}"><span>${label} ${esc(item.name)}</span></button>`;
  const pager =
    at < 0 ? '' : `<nav class="kn-pager">${step(items[at - 1], '‹')}${step(items[at + 1], '›')}</nav>`;
  return `<div class="kn-enc">
    <nav class="kn-rail">${rail}</nav>
    <div class="kn-list" data-keep-scroll="enc-list">${list}</div>
    <div class="on-parchment kn-page" data-keep-scroll="enc-page">${pager}${entryHtml(state.entry, state)}</div>
  </div>`;
}
