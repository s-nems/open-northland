import type { PalettedSprite, SpriteSheet } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../../../content/gui-art.js';
import { guiFrameIndex } from '../../../content/gui-atlas-map.js';
import type { Rect } from '../../geometry.js';
import type { PanelContext } from '../context.js';
import { NOTE_BACKDROP, noteIcon } from './icons.js';
import { layoutMessageNotes } from './layout.js';
import { NotePortraits, PORTRAIT_FEET_X, PORTRAIT_FEET_Y } from './portrait.js';
import type { MessagePriorityLevel, UserMessage } from './types.js';

/** Stacking slots each note owns: its parchment, then the token or settler standing on it. Notes pack
 *  tighter than they are wide, so a note must cover its predecessor whole, art and icon together. */
const NOTE_Z_SLOTS = 2;

/** Flat fallback when the decoded GUI art is absent: parchment with a coloured pin. */
const FALLBACK_PARCHMENT = 0xd9c79c;
const FALLBACK_PARCHMENT_EDGE = 0x8a744a;
const FALLBACK_PIN_RADIUS = 4;
const FALLBACK_PIN_Y = 6;
const FALLBACK_PIN_COLOUR: Readonly<Record<MessagePriorityLevel, number>> = {
  0: 0x3fa34d,
  1: 0xe08a2a,
  2: 0xc8322e,
};

export interface MessageStripDeps {
  readonly ctx: PanelContext;
  readonly app: Application;
  readonly art: GuiArt | null;
  readonly container: Container;
  readonly sheet?: SpriteSheet | undefined;
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** A drawn note: its message and where it stands, in strip order. */
export interface NoteSlot {
  readonly id: number;
  readonly rect: Rect;
}

/** The row of pinned notes along the top edge, one per displayed message. */
export interface MessageStrip {
  /** Redraw for `displayed`; a repeat call with the same `version` and screen size is a no-op. */
  render(displayed: readonly UserMessage[], snapshot: WorldSnapshot, version: number): void;
  slots(): readonly NoteSlot[];
  /** Forget the last drawn state, so the next `render` redraws whatever version it sees. */
  invalidate(): void;
  dispose(): void;
}

/** One note's GUI meshes, kept across redraws since a message's priority and icon never change. */
interface NoteSprites {
  readonly backdrop: PalettedSprite | null;
  /** Placed at the note's own origin: the parchment frame starts there and the token frame carries the
   *  offset that seats it on top. */
  readonly token: PalettedSprite | null;
}

export function createMessageStrip(deps: MessageStripDeps): MessageStrip {
  const { ctx, app, art } = deps;
  const { scale } = ctx;
  const root = new Container();
  root.sortableChildren = true;
  deps.container.addChild(root);
  const fallback = new Graphics();
  // One shared shape for every flat parchment, so it can only sit under the art it stands in for.
  fallback.zIndex = -1;
  root.addChild(fallback);
  const portraits = new NotePortraits(app, deps.sheet, root, deps.playerColourOf);

  const byId = new Map<number, NoteSprites>();
  let slots: NoteSlot[] = [];
  let drawnVersion = -1;
  let drawnWidth = -1;
  let drawnHeight = -1;

  const mint = (m: UserMessage): NoteSprites => {
    if (art === null) return { backdrop: null, token: null };
    const backdrop = makeGuiSprite(art, guiFrameIndex(NOTE_BACKDROP[m.priority]), {
      defaultPalette: 'iconsleft',
      colorKey: 'magenta',
    });
    if (backdrop !== null) root.addChild(backdrop.sprite);
    const icon = noteIcon(m.type, m.subject);
    const token =
      icon?.kind === 'frame'
        ? makeGuiSprite(art, guiFrameIndex(icon.name), { defaultPalette: 'iconsleft', colorKey: 'magenta' })
        : null;
    if (token !== null) root.addChild(token.sprite);
    return { backdrop: backdrop?.sprite ?? null, token: token?.sprite ?? null };
  };

  const release = (s: NoteSprites): void => {
    s.backdrop?.destroy();
    s.token?.destroy();
  };

  const drawFallback = (m: UserMessage, r: Rect): void => {
    const line = Math.max(1, Math.round(scale));
    fallback
      .rect(r.x, r.y, r.w, r.h)
      .fill(FALLBACK_PARCHMENT)
      .stroke({ color: FALLBACK_PARCHMENT_EDGE, width: line });
    fallback
      .circle(r.x + r.w / 2, r.y + FALLBACK_PIN_Y * scale, FALLBACK_PIN_RADIUS * scale)
      .fill(FALLBACK_PIN_COLOUR[m.priority]);
  };

  return {
    render: (displayed, snapshot, version): void => {
      const screen = ctx.screen();
      if (version === drawnVersion && screen.width === drawnWidth && screen.height === drawnHeight) return;
      drawnVersion = version;
      drawnWidth = screen.width;
      drawnHeight = screen.height;
      fallback.clear();
      const rects = layoutMessageNotes(displayed.length, scale);
      slots = [];
      const seen = new Set<number>();
      const standing: { entity: number; feetX: number; feetY: number; zIndex: number }[] = [];
      displayed.forEach((m, i) => {
        const r = rects[i];
        if (r === undefined) return;
        slots.push({ id: m.id, rect: r });
        seen.add(m.id);
        let sprites = byId.get(m.id);
        if (sprites === undefined) {
          sprites = mint(m);
          byId.set(m.id, sprites);
        }
        const z = i * NOTE_Z_SLOTS;
        if (sprites.backdrop === null) drawFallback(m, r);
        else {
          sprites.backdrop.zIndex = z;
          sprites.backdrop.place(r.x, r.y, scale, screen.width, screen.height);
        }
        if (sprites.token !== null) {
          sprites.token.zIndex = z + 1;
          sprites.token.place(r.x, r.y, scale, screen.width, screen.height);
        }
        if (m.subject?.kind === 'settler' && noteIcon(m.type, m.subject)?.kind === 'portrait') {
          standing.push({
            entity: m.subject.entity,
            feetX: r.x + PORTRAIT_FEET_X * scale,
            feetY: r.y + PORTRAIT_FEET_Y * scale,
            zIndex: z + 1,
          });
        }
      });
      for (const [id, sprites] of byId) {
        if (seen.has(id)) continue;
        release(sprites);
        byId.delete(id);
      }
      portraits.render(snapshot, standing, scale);
    },
    slots: () => slots,
    invalidate: (): void => {
      drawnVersion = -1;
    },
    dispose: (): void => {
      for (const sprites of byId.values()) release(sprites);
      byId.clear();
      portraits.dispose();
      root.destroy({ children: true });
    },
  };
}
