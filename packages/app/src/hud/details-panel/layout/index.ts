import type { Rect } from '../../geometry.js';
import type { PalisadePanelModel } from '../model/index.js';
import { PANEL_W, panelRect, ROW_H, type SectionRect, sectionAt } from './shared.js';

export { ROW_H, ROW_TEXT_PAD, type SectionRect } from './shared.js';

export type ButtonAction = 'demolish' | 'toggle-gate' | 'demolish-palisade';

export interface ButtonHit {
  readonly action: ButtonAction;
  readonly rect: Rect;
  readonly enabled: boolean;
}
/** A selected signpost: one section window whose body is the tear-down button. */
export interface SignpostLayout {
  readonly kind: 'signpost';
  readonly panel: Rect;
  readonly section: SectionRect;
  readonly button: ButtonHit;
}

export interface PalisadeLayout {
  readonly kind: 'palisade';
  readonly panel: Rect;
  readonly section: SectionRect;
  /** The hitpoints written out, on its own row above the bar so the fill never covers it. */
  readonly healthLabel: Rect;
  readonly health: Rect;
  readonly progress: Rect | null;
  readonly buttons: readonly ButtonHit[];
}

export type DetailsLayout = SignpostLayout | PalisadeLayout;

/** The signpost tear-down button's height. */
const SIGNPOST_BUTTON_H = 18;
/** Inset between that button and its section body, on both axes. */
const SIGNPOST_BUTTON_PAD = 2;

/**
 * Apply `fn` to every rect in a layout, returning a new layout of the same shape. The off-screen
 * supersample draw layout is derived from the on-canvas hit layout this way, so drawn geometry equals
 * hit-tested geometry by construction rather than by two passes agreeing on rounding.
 */
export function mapLayout<T extends DetailsLayout>(layout: T, fn: (r: Rect) => Rect): T {
  const sec = (s: SectionRect): SectionRect => ({ frame: fn(s.frame), title: fn(s.title), body: fn(s.body) });
  if (layout.kind === 'signpost') {
    return {
      ...layout,
      panel: fn(layout.panel),
      section: sec(layout.section),
      button: { ...layout.button, rect: fn(layout.button.rect) },
    };
  }
  return {
    ...layout,
    panel: fn(layout.panel),
    section: sec(layout.section),
    healthLabel: fn(layout.healthLabel),
    health: fn(layout.health),
    progress: layout.progress === null ? null : fn(layout.progress),
    buttons: layout.buttons.map((button) => ({ ...button, rect: fn(button.rect) })),
  };
}

export function layoutSignpost(
  screen: { readonly width: number; readonly height: number },
  s: number,
): SignpostLayout {
  const w = Math.round(PANEL_W * s);
  const pad = Math.round(SIGNPOST_BUTTON_PAD * s);
  const bodyH = Math.round(SIGNPOST_BUTTON_H * s) + pad * 2;
  const probe = sectionAt(0, 0, w, bodyH, s);
  const panel = panelRect(probe.frame.h, screen, s);
  const section = sectionAt(panel.x, panel.y, w, bodyH, s);
  const button: ButtonHit = {
    action: 'demolish',
    enabled: true,
    rect: {
      x: section.body.x + pad,
      y: section.body.y + pad,
      w: section.body.w - pad * 2,
      h: Math.round(SIGNPOST_BUTTON_H * s),
    },
  };
  return { kind: 'signpost', panel, section, button };
}

export function layoutPalisade(
  model: PalisadePanelModel,
  screen: { readonly width: number; readonly height: number },
  s: number,
): PalisadeLayout {
  const w = Math.round(PANEL_W * s);
  const rowH = Math.round(ROW_H * s);
  const pad = Math.round(SIGNPOST_BUTTON_PAD * s);
  const buttonH = Math.round(SIGNPOST_BUTTON_H * s);
  const actions = [
    ...(model.gateOpen === null ? [] : (['toggle-gate'] as const)),
    'demolish-palisade' as const,
  ];
  // The hitpoints label, its bar, then the build progress of a segment still going up. A road site has
  // no hitpoints, and its progress row says where its paving stands.
  const healthRows = model.roadSite ? 0 : 2;
  const showsProgress = model.underConstruction;
  const rows = healthRows + (showsProgress ? 1 : 0);
  const bodyH = rowH * rows + actions.length * buttonH + pad * Math.max(0, actions.length - 1);
  const probe = sectionAt(0, 0, w, bodyH, s);
  const panel = panelRect(probe.frame.h, screen, s);
  const section = sectionAt(panel.x, panel.y, w, bodyH, s);
  const healthLabel = { x: section.body.x, y: section.body.y, w: section.body.w, h: rowH };
  const health = {
    x: section.body.x,
    y: section.body.y + rowH + 2,
    w: section.body.w,
    h: Math.max(4, rowH - 6),
  };
  const progress = showsProgress
    ? { x: section.body.x, y: section.body.y + rowH * healthRows, w: section.body.w, h: rowH }
    : null;
  const buttonY = section.body.y + rowH * rows;
  const buttons = actions.map((action, index) => ({
    action,
    enabled: action === 'demolish-palisade' || !model.underConstruction,
    rect: {
      x: section.body.x,
      y: buttonY + index * (buttonH + pad),
      w: section.body.w,
      h: buttonH,
    },
  }));
  return { kind: 'palisade', panel, section, healthLabel, health, progress, buttons };
}
