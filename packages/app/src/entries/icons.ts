import { BobsIndex, type BobsIndexEntry } from '@open-northland/data';
import type { AtlasManifest } from '@open-northland/render';
import { palettedSheetBitmap } from '../content/atlas-sheet/index.js';
import { loadAtlasManifest } from '../content/bob-atlases.js';
import { GUI_FRAMES } from '../content/gui/atlas-map.js';
import { fetchJsonOrNull, moddedContentAssetUrl } from '../content/net.js';
import { atlasImagePath, contentUrl } from '../content/url.js';
import { diag } from '../diag/log.js';
import { formatMessage, messages } from '../i18n/index.js';
import { el, mountMessage, pageInnerStyle, pageRootStyle } from '../view/overlay.js';

/**
 * The `?icons` gallery: one decoded bob atlas at a time as a grid of frames labelled by frame index, so
 * a human can find the exact sprite to wire into a feature. The atlases are already palette-baked into
 * the sheet each manifest names, so a frame is a CSS background-crop of it and needs no Pixi. A bare checkout
 * degrades to a "run the pipeline" message.
 */

const BOBS_INDEX_URL = '/bobs-index.json';

/** The listing the pipeline wrote, or none: a document this build cannot read shows the "run the
 *  pipeline" message rather than a partial gallery. */
export function parseBobsIndex(data: unknown): readonly BobsIndexEntry[] {
  const parsed = BobsIndex.safeParse(data);
  return parsed.success ? parsed.data : [];
}

/** Frames of this sheet carry human names, so the gallery shows them beside the index. */
const GUI_BASE = 'ls_gui_window';
/** Frames rendered at once; a character sheet has thousands. */
const FRAME_CAP = 800;

const STYLE_ID = 'opennorthland-icon-gallery-style';
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
  background:#2c2015;border:1px solid #4a3a22;border-radius:8px;padding:10px 6px 8px;cursor:var(--cursor-pointer, pointer);
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

/** The object URL of the shown paletted sheet, revoked when the next sheet replaces it. */
let colouredSheetUrl: string | undefined;

/**
 * The sheet a stem's tiles crop from: a paletted one is coloured as the map colours it and shown through
 * an object URL (its caller revokes it), since a sheet-sized data URL passes the browser's URL length limit.
 */
async function gallerySheetUrl(atlas: AtlasManifest): Promise<string> {
  if (atlas.palette === undefined) return moddedContentAssetUrl(contentUrl(atlasImagePath(atlas.image)));
  const bitmap = await palettedSheetBitmap({ ...atlas, palette: atlas.palette });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (blob === null) throw new Error(`icons: ${atlas.image} could not be encoded`);
  return URL.createObjectURL(blob);
}

function groupLabel(base: string): string {
  const groups = messages().icons.groups;
  if (base === GUI_BASE) return groups.gui;
  if (base === 'ls_gui_bubbles') return groups.bubbles;
  if (base === 'ls_goods') return groups.goods;
  if (base.startsWith('ls_houses')) return groups.houses;
  if (base.startsWith('ls_ruin')) return groups.ruins;
  if (base.startsWith('cr_')) return groups.characters;
  return groups.objects;
}

export function renderIconGallery(_canvas: HTMLCanvasElement, params: URLSearchParams): void {
  void (async () => {
    const index = parseBobsIndex(await fetchJsonOrNull<unknown>(BOBS_INDEX_URL));
    if (index.length === 0) {
      mountMessage(messages().icons.title, messages().icons.missingDetail);
      return;
    }
    installStyle();

    const root = el('div', pageRootStyle(28, 14));
    const inner = el('div', pageInnerStyle(1180));
    root.append(inner);

    inner.append(el('h1', 'font-size:22px;margin:0 0 4px', messages().icons.title));
    inner.append(
      el(
        'p',
        'margin:0 0 14px;color:#b8a684;font-size:13.5px;line-height:1.5;max-width:70ch',
        messages().icons.intro,
      ),
    );

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
    filter.placeholder = messages().icons.filter;
    const zoom = el('input', '') as HTMLInputElement;
    zoom.type = 'range';
    zoom.min = '2';
    zoom.max = '6';
    zoom.step = '1';
    zoom.value = '3';
    const meta = el('span', '');
    meta.className = 'vig-meta';
    const zoomLabel = el('label', '', `${messages().icons.zoom} `);
    zoomLabel.append(zoom);
    controls.append(select, filter, zoomLabel, meta);
    inner.append(controls);

    const grid = el('div', 'margin-top:14px');
    grid.className = 'vig-grid';
    inner.append(grid);
    document.body.append(root);

    let selected: HTMLElement | null = null;
    /** Bumped per stem switch, so a slow colouring that finishes later cannot replace a newer sheet. */
    let selection = 0;

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
      const shownSelection = ++selection;
      grid.textContent = '';
      selected = null;
      const loaded = await loadAtlasManifest(stem)
        .then(async (atlas) => (atlas === null ? null : { atlas, sheetUrl: await gallerySheetUrl(atlas) }))
        .catch((err: unknown) => {
          diag.warn('content', `icons: ${stem} could not be shown`, err);
          return null;
        });
      const objectUrl = loaded?.atlas.palette === undefined ? undefined : loaded.sheetUrl;
      if (shownSelection !== selection) {
        if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (loaded === null) {
        meta.textContent = formatMessage(messages().icons.loadFailed, { stem });
        return;
      }
      if (colouredSheetUrl !== undefined) URL.revokeObjectURL(colouredSheetUrl);
      colouredSheetUrl = objectUrl;
      const { atlas } = loaded;
      grid.style.setProperty('--sheet', `url('${loaded.sheetUrl}')`);
      grid.style.setProperty('--sw', String(atlas.width));
      grid.style.setProperty('--sh', String(atlas.height));
      const withName = stem.startsWith(`${GUI_BASE}.`);
      const drawable = atlas.frames.filter((f) => f.rect.width > 0 && f.rect.height > 0);
      const shown = drawable.slice(0, FRAME_CAP);
      const capNote =
        drawable.length > FRAME_CAP ? formatMessage(messages().icons.frameCapNote, { count: FRAME_CAP }) : '';
      meta.textContent = formatMessage(messages().icons.frameCount, {
        stem,
        count: drawable.length,
        note: capNote,
      });
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
        const nmLine = el('div', '', name || '-');
        nmLine.className = 'vig-nm';
        tile.append(chip, idxLine, nmLine);
        tile.addEventListener('click', () => {
          if (selected !== null) selected.classList.remove('sel');
          tile.classList.add('sel');
          selected = tile;
          const tag = `${stem} #${f.bobId}`;
          navigator.clipboard?.writeText(tag).catch(() => {});
          meta.textContent = formatMessage(messages().icons.copied, {
            tag,
            name: name ? `  (${name})` : '',
          });
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
