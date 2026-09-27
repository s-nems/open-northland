import { components } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { VehicleHoldModel, VehiclePanelModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { type Counter, createCounter } from '../parts/counter.js';
import {
  button,
  element,
  isDisabled,
  setClass,
  setDisabled,
  setHidden,
  setStyleVar,
  setTip,
  write,
} from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createRoundButton } from '../parts/round-button.js';
import { createSection } from '../parts/section.js';
import type { VehiclePanelDeps } from './actions.js';
import { type CargoLine, cargoRoom, createCargoState } from './cargo.js';
import { createCargoPicker } from './cargo-picker.js';

/** Design px of a good's icon in its manifest well (foundation.css `.on-good-well`). */
const CARGO_ICON_PX = 18;
/** A line's target never passes a stock byte; the hold's room clamps a step further (`setWanted`). */
const CARGO_COUNTER_RANGE = { max: components.VEHICLE_STOCK_BYTE_MAX };

/** The units on their way in (booked past what is aboard) and out (aboard past what is booked). */
export function cargoFlow(line: Pick<CargoLine, 'current' | 'reserved'>): {
  coming: number;
  leaving: number;
} {
  return {
    coming: Math.max(0, line.reserved - line.current),
    leaving: Math.max(0, line.current - line.reserved),
  };
}

/** A line's tooltip: its counts in words. */
export function cargoLineTooltip(line: CargoLine, routed: boolean): string {
  const copy = messages().hud.vehiclePanel;
  const { coming, leaving } = cargoFlow(line);
  const parts = [formatMessage(copy.row, { good: line.label, current: line.current })];
  if (coming > 0) parts.push(formatMessage(copy.rowComing, { count: coming }));
  if (leaving > 0) parts.push(formatMessage(copy.rowLeaving, { count: leaving }));
  if (!routed) parts.push(formatMessage(copy.rowWanted, { count: line.wanted }));
  return parts.join(' · ');
}

/** How much of the target is aboard, the rule under the line; full for a line with no target. */
export function cargoFill(line: Pick<CargoLine, 'current' | 'wanted'>): string {
  if (line.wanted === 0) return line.current > 0 ? '100%' : '0%';
  return meterFill(line.current, line.wanted);
}

interface LineView {
  readonly item: HTMLLIElement;
  readonly name: HTMLElement;
  readonly now: HTMLElement;
  readonly counter: Counter;
}

/**
 * Ładownia: the load gauge (aboard, on the way, the target), one manifest line per good with what is
 * aboard, what is on its way and the target's counter, and "Dodaj towar" for the rest of what the hold
 * may carry. A trader's cart shows the lines read-only: its route writes the targets.
 */
export interface HoldSection {
  readonly element: HTMLElement;
  update(model: VehiclePanelModel): void;
  /** Escape: close the picker; false when it was not open. */
  closePicker(): boolean;
}

export function createHoldSection(
  deps: VehiclePanelDeps,
  current: () => VehiclePanelModel | null,
): HoldSection {
  const state = createCargoState();
  const flag = element('span', 'on-flag');
  const routed = element('span', 'on-section__count');
  const clear = button('on-more');
  const controls = element('span', 'on-section__group');
  controls.append(flag, routed, clear);
  const title = createSection(controls);
  const gauge = element(
    'div',
    'on-load',
    '<div class="on-load__bar"><span class="on-load__aboard"></span><span class="on-load__coming"></span><span class="on-load__target"></span></div><b><span></span><small></small></b>',
  );
  const [aboardBar, comingBar, targetMark] = [...gauge.querySelectorAll<HTMLElement>('.on-load__bar > span')];
  const loadText = gauge.querySelector('b > span');
  const slotsText = gauge.querySelector('b > small');
  if (
    aboardBar === undefined ||
    comingBar === undefined ||
    targetMark === undefined ||
    loadText === null ||
    slotsText === null
  ) {
    throw new Error('vehicle hold: gauge');
  }
  const manifest = element('ul', 'on-manifest on-manifest--lines');
  // A manifest past its height fades out at the bottom while more lines sit below the fold.
  const paintFold = (): void => {
    const below = manifest.scrollTop + manifest.clientHeight < manifest.scrollHeight - 1;
    setClass(manifest, 'on-manifest--more', below);
  };
  manifest.addEventListener('scroll', paintFold, { passive: true });
  const empty = element('li', 'on-cargo-add', '<span class="on-ledger--muted"></span>');
  const emptyText = empty.firstElementChild;
  if (emptyText === null) throw new Error('vehicle hold: empty');
  const addRow = element('li', 'on-cargo-add');
  const addButton = createRoundButton('ledger', () => togglePicker());
  const addLink = button('on-more');
  addLink.addEventListener('click', () => togglePicker());
  addRow.append(addButton.element, addLink);
  // Outside the manifest, so a long manifest scrolls under it and the add row stays in reach.
  const addList = element('ul', 'on-manifest');
  addList.append(addRow);
  const root = element('div', '');

  let shown: VehiclePanelModel | null = null;
  let lines: CargoLine[] = [];
  const hold = (): VehicleHoldModel | null => shown?.hold ?? null;
  const picker = createCargoPicker(
    deps,
    (goodType) => {
      if (lines.some((line) => line.goodType === goodType && !line.pinned)) return;
      if (state.isPinned(goodType)) {
        const line = lines.find((candidate) => candidate.goodType === goodType);
        if (line !== undefined && line.wanted === 0 && line.current === 0 && line.reserved === 0)
          state.unpin(goodType);
      } else {
        state.pin(goodType);
        repaint();
        views.get(goodType)?.item.scrollIntoView({ block: 'nearest' });
        return;
      }
      repaint();
    },
    () => {
      picker.close();
      paintAdd();
    },
  );
  root.append(title.element, gauge, manifest, addList, picker.element);

  const togglePicker = (): void => {
    const model = hold();
    if (model === null) return;
    if (picker.isOpen()) picker.close();
    else {
      deps.cue('confirm');
      picker.open(model.goods);
      picker.update(model.goods, new Set(lines.map((line) => line.goodType)));
    }
    paintAdd();
  };
  const setWanted = (goodType: number, amount: number): void => {
    const model = shown;
    const line = lines.find((candidate) => candidate.goodType === goodType);
    if (model === null || model.hold === null || line === undefined) return;
    const room = cargoRoom(model.hold, lines);
    const next = Math.max(0, Math.min(amount, line.wanted + room));
    if (next === line.wanted) return;
    const live = model.hold.rows.find((row) => row.goodType === goodType)?.wanted ?? 0;
    state.hold(goodType, next, live);
    deps.vehicle.setWanted(model.entityId, goodType, next);
    repaint();
  };
  clear.addEventListener('click', () => {
    const model = shown;
    if (model === null || model.hold === null || isDisabled(clear)) return;
    for (const line of lines) {
      if (line.wanted === 0) continue;
      state.hold(
        line.goodType,
        0,
        model.hold.rows.find((row) => row.goodType === line.goodType)?.wanted ?? 0,
      );
    }
    deps.vehicle.clearWanted(model.entityId);
    repaint();
  });

  const views = new Map<number, LineView>();
  const lineView = (goodType: number, goodId: string | undefined): LineView => {
    const known = views.get(goodType);
    if (known !== undefined) return known;
    const item = element('li', 'on-cargo-row');
    const well = element('span', 'on-good-well', goodIconMarkup(CARGO_ICON_PX));
    const frame = well.querySelector('.on-good__frame');
    if (goodId !== undefined && frame instanceof HTMLElement) deps.icons(frame, goodId, CARGO_ICON_PX);
    const name = element('span', 'on-cargo-row__name');
    const now = element('span', 'on-cargo-row__now');
    const counter = createCounter(CARGO_COUNTER_RANGE, (next) => setWanted(goodType, next));
    item.append(well, name, now, counter.element);
    const view = { item, name, now, counter };
    views.set(goodType, view);
    return view;
  };

  const paintAdd = (): void => {
    const copy = messages().hud.vehiclePanel;
    const open = picker.isOpen();
    addButton.update({
      face: { glyph: open ? GLYPH.close : GLYPH.plus },
      label: copy.add,
      tooltip: copy.addTooltip,
    });
    write(addLink, copy.add);
    setTip(addLink, copy.addTooltip);
  };

  const repaint = (): void => {
    const model = shown;
    const cargo = model?.hold ?? null;
    if (model === null || cargo === null) return;
    const copy = messages().hud.vehiclePanel;
    lines = state.lines(cargo);
    const room = cargoRoom(cargo, lines);
    let aboard = 0;
    let coming = 0;
    let target = 0;
    for (const line of lines) {
      aboard += line.current;
      coming += cargoFlow(line).coming;
      target += line.wanted;
    }
    aboardBar.style.width = meterFill(aboard, cargo.slots);
    comingBar.style.left = meterFill(aboard, cargo.slots);
    comingBar.style.width = meterFill(coming, cargo.slots);
    setHidden(targetMark, cargo.routed);
    targetMark.style.left = meterFill(target, cargo.slots);
    write(loadText, String(aboard));
    write(slotsText, ` / ${cargo.slots}`);
    setTip(gauge, formatMessage(copy.load, { load: aboard, coming, wanted: target, slots: cargo.slots }));

    const items: HTMLElement[] = [];
    for (const line of lines) {
      const view = lineView(line.goodType, line.goodId);
      const { coming: incoming, leaving } = cargoFlow(line);
      write(view.name, line.label);
      const flow = incoming > 0 ? ` +${incoming}` : leaving > 0 ? ` −${leaving}` : '';
      const nowKey = `${line.current}|${flow}|${cargo.routed}`;
      if (view.now.dataset.key !== nowKey) {
        view.now.dataset.key = nowKey;
        view.now.replaceChildren(String(line.current));
        if (flow !== '') view.now.append(element('small', '', flow.trim()));
        if (!cargo.routed) view.now.append(element('em', '', '→'));
      }
      setTip(view.now, cargoLineTooltip(line, cargo.routed));
      setStyleVar(view.item, '--fill', cargoFill(line));
      setClass(view.item, 'on-cargo-row--static', cargo.routed);
      setClass(view.item, 'on-cargo-row--leaving', !cargo.routed && line.wanted < line.current);
      setHidden(view.counter.element, cargo.routed);
      if (!cargo.routed) {
        view.counter.update({
          value: line.wanted,
          lessLabel: formatMessage(copy.less, { good: line.label }),
          moreLabel: formatMessage(copy.more, { good: line.label }),
          lessTooltip: copy.lessTooltip,
          moreTooltip: room > 0 ? copy.moreTooltip : copy.holdFull,
          lessEnabled: line.wanted > 0,
          moreEnabled: room > 0,
        });
      }
      items.push(view.item);
    }
    for (const good of views.keys()) if (!lines.some((line) => line.goodType === good)) views.delete(good);
    write(emptyText, cargo.routed ? copy.emptyRouted : copy.empty);
    if (lines.length === 0) items.push(empty);
    setHidden(addList, cargo.routed);
    if (
      manifest.children.length !== items.length ||
      items.some((item, index) => manifest.children[index] !== item)
    ) {
      manifest.replaceChildren(...items);
      paintFold();
    }
    if (cargo.routed && picker.isOpen()) picker.close();
    picker.update(cargo.goods, new Set(lines.map((line) => line.goodType)));
    paintAdd();

    title.update(copy.hold);
    setHidden(flag, cargo.cargoHand || cargo.routed);
    write(flag, copy.noHand);
    setTip(flag, copy.noHandTooltip);
    setHidden(routed, !cargo.routed);
    write(routed, copy.routed);
    setTip(routed, copy.routedTooltip);
    setHidden(clear, cargo.routed);
    write(clear, copy.clear);
    setDisabled(clear, target === 0);
    setTip(clear, copy.clearTooltip);
  };

  return {
    element: root,
    update(model): void {
      // Another vehicle: the picker closes, the local lines start afresh and the manifest opens at its top.
      const another = shown?.entityId !== model.entityId;
      if (another) {
        picker.close();
        manifest.scrollTop = 0;
      }
      shown = model;
      setHidden(root, model.hold === null);
      if (model.hold === null) {
        picker.close();
        return;
      }
      state.show(model.entityId);
      repaint();
      if (another) paintFold();
    },
    closePicker(): boolean {
      if (!picker.isOpen()) return false;
      picker.close();
      paintAdd();
      return true;
    },
  };
}
