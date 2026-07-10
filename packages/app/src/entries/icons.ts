import { GUI_FRAMES } from '../content/gui-atlas-map.js';
import { el, mountMessage, pageInnerStyle, pageRootStyle } from '../view/overlay.js';

/**
 * The `?icons` ICON GALLERY entry — a browsable board of every decoded bob-atlas frame, so a human can
 * find the exact sprite (and its FRAME INDEX) to wire into a feature. It is the in-app, always-current
 * successor to the throwaway HTML board: the dev server's `/bobs-index` lists every palette-applied RGBA
 * atlas the pipeline emitted (GUI, goods, and every landscape/house/object set), and this page shows one
 * atlas at a time as a grid of frames cropped straight from its sheet PNG, each labelled by frame index.
 *
 * Pure DOM (no Pixi): the atlases are already palette-baked to `<stem>.png`, so a frame is just a CSS
 * background-crop of that sheet — no runtime recolour needed. Real content required (it browses the
 * gitignored `content/`); a bare checkout degrades to a "run the pipeline" message.
 */

interface BobsIndexEntry {
  readonly stem: string;
  readonly base: string;
  readonly variant: string;
}

interface AtlasFrameJson {
  readonly bobId: number;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}
interface AtlasJson {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasFrameJson[];
}

/** GUI-sheet frames carry human names (`content/gui-atlas-map.ts`); show them so the badge search reads. */
const GUI_BASE = 'ls_gui_window';
/** Cap the frames rendered at once — a character sheet has thousands; a "show all" toggle lifts it. */
const FRAME_CAP = 800;

const STYLE_ID = 'vinland-icon-gallery-style';
const GALLERY_CSS = `
.vig-wrap{display:flex;flex-direction:column;gap:14px}
.vig-controls{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;font-size:13px}
.vig-controls select,.vig-controls input[type="search"]{
  font:inherit;color:#e8dcc8;background:#2c2015;border:1px solid #4a3a22;border-radius:6px;padding:6px 9px;
}
.vig-controls select{max-width:340px}
.vig-controls input[type="search"]{width:200px}
.vig-controls label{display:flex;align-items:center;gap:7px;color:#b8a684}
.vig-controls input[type="range"]{accent-color:#c79a52}
.vig-meta{font-size:12.5px;color:#b8a684;font-family:ui-monospace,Menlo,monospace}
.vig-grid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cell,104px),1fr));gap:10px;
  --zoom:3;--sheet:none;--sw:1;--sh:1;
}
.vig-tile{
  display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
  background:#2c2015;border:1px solid #4a3a22;border-radius:8px;padding:10px 6px 8px;cursor:pointer;
}
.vig-tile:hover{border-color:#8a6f3f}
.vig-tile.sel{border-color:#d8fb55;box-shadow:0 0 0 1px #d8fb55}
.vig-chip{
  display:flex;align-items:center;justify-content:center;width:100%;height:calc(var(--zoom) * 34px);
  background:#181109;border:1px solid #3a2b19;border-radius:6px;overflow:hidden;
}
.vig-crop{
  background-image:var(--sheet);background-repeat:no-repeat;image-rendering:pixelated;
  width:calc(var(--w) * var(--zoom) * 1px);height:calc(var(--h) * var(--zoom) * 1px);
  background-size:calc(var(--sw) * var(--zoom) * 1px) calc(var(--sh) * var(--zoom) * 1px);
  background-position:calc(var(--x) * var(--zoom) * -1px) calc(var(--y) * var(--zoom) * -1px);
}
.vig-idx{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#e8dcc8;display:flex;gap:6px;align-items:baseline}
.vig-idx .hx{font-size:10.5px;color:#b8a684}
.vig-nm{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#b8a684;line-height:1.25;overflow-wrap:anywhere}
.vig-grid::-webkit-scrollbar-thumb{background:#4a3a22}
`;

function installStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = GALLERY_CSS;
  document.head.append(s);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** A short, human group label for a base sprite set — enough to find "GUI" / "Dobra" / "Domy" at a glance. */
function groupLabel(base: string): string {
  if (base === GUI_BASE) return 'GUI (przyciski, glify, panel)';
  if (base === 'ls_gui_bubbles') return 'Dymki osadnika';
  if (base === 'ls_goods') return 'Dobra / narzędzia / broń';
  if (base.startsWith('ls_houses')) return 'Domy';
  if (base.startsWith('ls_ruin')) return 'Ruiny';
  if (base.startsWith('cr_')) return 'Postacie / zwierzęta / pojazdy';
  return 'Obiekty / teren / efekty';
}

export function renderIconGallery(_canvas: HTMLCanvasElement, params: URLSearchParams): void {
  void (async () => {
    const index = await fetchJson<BobsIndexEntry[]>('/bobs-index');
    if (index === null || index.length === 0) {
      mountMessage(
        'Galeria ikon',
        'Brak zdekodowanych atlasów w content/. Uruchom `npm run pipeline` na posiadanej kopii gry (są gitignore), aby przeglądać ikony.',
      );
      return;
    }
    installStyle();

    const root = el('div', pageRootStyle(28, 14));
    const inner = el('div', pageInnerStyle(1180));
    root.append(inner);

    inner.append(el('h1', 'font-size:22px;margin:0 0 4px', 'Galeria ikon'));
    inner.append(
      el(
        'p',
        'margin:0 0 14px;color:#b8a684;font-size:13.5px;line-height:1.5;max-width:70ch',
        'Każda klatka każdego zdekodowanego atlasu, etykietowana numerem klatki (frame index). Wybierz zestaw, filtruj i przybliżaj; kliknij kafelek, by go zaznaczyć i skopiować „stem #index".',
      ),
    );

    // Controls: atlas picker (grouped), frame filter, zoom.
    const controls = el('div', '');
    controls.className = 'vig-controls';
    const select = document.createElement('select');
    let lastGroup = '';
    let optgroup: HTMLOptGroupElement | null = null;
    for (const e of index) {
      const g = groupLabel(e.base);
      if (g !== lastGroup) {
        optgroup = document.createElement('optgroup');
        optgroup.label = g;
        select.append(optgroup);
        lastGroup = g;
      }
      const opt = document.createElement('option');
      opt.value = e.stem;
      opt.textContent = e.variant === '' ? e.base : `${e.base} · ${e.variant}`;
      (optgroup ?? select).append(opt);
    }
    const filter = el('input', '') as HTMLInputElement;
    filter.type = 'search';
    filter.placeholder = 'filtr: indeks lub nazwa';
    const zoom = el('input', '') as HTMLInputElement;
    zoom.type = 'range';
    zoom.min = '2';
    zoom.max = '6';
    zoom.step = '1';
    zoom.value = '3';
    const meta = el('span', '');
    meta.className = 'vig-meta';
    const zoomLabel = el('label', '', 'zoom ');
    zoomLabel.append(zoom);
    controls.append(select, filter, zoomLabel, meta);
    inner.append(controls);

    const grid = el('div', 'margin-top:14px');
    grid.className = 'vig-grid';
    inner.append(grid);
    document.body.append(root);

    let selected: HTMLElement | null = null;

    const applyFilter = (): void => {
      const t = filter.value.trim().toLowerCase();
      for (const tile of Array.from(grid.children) as HTMLElement[]) {
        const idx = tile.dataset.idx ?? '';
        const nm = (tile.dataset.name ?? '').toLowerCase();
        const hit = t === '' || idx === t || `0x${Number(idx).toString(16)}` === t || nm.includes(t);
        tile.style.display = hit ? '' : 'none';
      }
    };
    const applyZoom = (): void => {
      grid.style.setProperty('--zoom', zoom.value);
      grid.style.setProperty('--cell', `${52 + Number(zoom.value) * 26}px`);
    };

    const showAtlas = async (stem: string): Promise<void> => {
      grid.textContent = '';
      selected = null;
      const atlas = await fetchJson<AtlasJson>(`/bobs/${stem}.atlas.json`);
      if (atlas === null) {
        meta.textContent = `nie udało się wczytać /bobs/${stem}.atlas.json`;
        return;
      }
      grid.style.setProperty('--sheet', `url('/bobs/${stem}.png')`);
      grid.style.setProperty('--sw', String(atlas.width));
      grid.style.setProperty('--sh', String(atlas.height));
      const withName = stem.startsWith(`${GUI_BASE}.`);
      const drawable = atlas.frames.filter((f) => f.rect.width > 0 && f.rect.height > 0);
      const shown = drawable.slice(0, FRAME_CAP);
      const capNote = drawable.length > FRAME_CAP ? ` (pokazano ${FRAME_CAP})` : '';
      meta.textContent = `${stem} — ${drawable.length} klatek${capNote}`;
      const frag = document.createDocumentFragment();
      for (const f of shown) {
        const name = withName ? (GUI_FRAMES[f.bobId]?.name ?? '') : '';
        const tile = el('div', '');
        tile.className = 'vig-tile';
        tile.dataset.idx = String(f.bobId);
        tile.dataset.name = name;
        const chip = el('div', '');
        chip.className = 'vig-chip';
        const crop = el('div', `--x:${f.rect.x};--y:${f.rect.y};--w:${f.rect.width};--h:${f.rect.height}`);
        crop.className = 'vig-crop';
        chip.append(crop);
        const idxLine = el('div', '');
        idxLine.className = 'vig-idx';
        idxLine.append(el('span', '', String(f.bobId)), el('span', '', `0x${f.bobId.toString(16)}`));
        (idxLine.lastChild as HTMLElement).className = 'hx';
        const nmLine = el('div', '', name || '—');
        nmLine.className = 'vig-nm';
        tile.append(chip, idxLine, nmLine);
        tile.addEventListener('click', () => {
          if (selected !== null) selected.classList.remove('sel');
          tile.classList.add('sel');
          selected = tile;
          const tag = `${stem} #${f.bobId}`;
          navigator.clipboard?.writeText(tag).catch(() => {});
          meta.textContent = `${tag}${name ? `  (${name})` : ''} — skopiowano`;
        });
        frag.append(tile);
      }
      grid.append(frag);
      applyZoom();
      applyFilter();
    };

    filter.addEventListener('input', applyFilter);
    zoom.addEventListener('input', applyZoom);
    select.addEventListener('change', () => void showAtlas(select.value));

    // Initial selection: `?atlas=<stem>` if valid, else the GUI sheet (the badge/order-icon candidates).
    const wanted = params.get('atlas');
    const initial =
      (wanted !== null && index.some((e) => e.stem === wanted) ? wanted : undefined) ??
      index.find((e) => e.base === GUI_BASE)?.stem ??
      index[0]?.stem;
    if (initial !== undefined) {
      select.value = initial;
      await showAtlas(initial);
    }
  })();
}
