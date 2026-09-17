import type { SpriteSheet } from '@open-northland/render';
import type { HalfCellNode, Paper, SimEvent, WorldSnapshot } from '@open-northland/sim';
import type { Application, Container } from 'pixi.js';
import { professionDefForJob } from '../../../catalog/professions.js';
import type { GuiArt } from '../../../content/gui-art.js';
import { characterName } from '../../../game/character-names/index.js';
import { PRIMARY_TRIBE } from '../../../game/rules.js';
import { isFemale, num, type SnapshotEntity, surnameSourceOf } from '../../../game/snapshot.js';
import { formatMessage, messages, professionLabel } from '../../../i18n/index.js';
import type { TooltipSurface } from '../../tooltip-surface.js';
import type { PanelContext } from '../context.js';
import { diplomacyStanceText } from '../diplomacy/model.js';
import { createDeselectionDismisser, type UnitSelectionView } from './deselection.js';
import { createMessageFeed, type MessageFeedState } from './feed.js';
import { createDiplomacyMessageSource, type MetSeat } from './from-diplomacy.js';
import { messagesFromEvents } from './from-events.js';
import { createSnapshotMessageSource } from './from-snapshot.js';
import { hitTestNotes } from './layout.js';
import type { MessageNaming } from './raise.js';
import { isNoteOver } from './retire.js';
import { createMessageStrip } from './strip.js';
import { composeMessageText } from './text.js';
import type { MessagePriorityLevel, UserMessage } from './types.js';
import { createMessageWindow } from './window.js';

export type { UnitSelectionView } from './deselection.js';
export type { MessageFeedState } from './feed.js';
export { MESSAGE_LEVEL_FACE } from './priority.js';

/** The `miscwindow` row heading an unnamed seat, ahead of its slot number. */
const PLAYER_STRING_ID = 361;

/** Where a note's Select centres the view: the subject while it lives, else the spot it was raised at. */
export interface MessageTarget {
  readonly entity: number | null;
  readonly at: HalfCellNode | null;
}

export interface MessageCenterDeps {
  readonly ctx: PanelContext;
  readonly app: Application;
  readonly art: GuiArt | null;
  readonly notesContainer: Container;
  readonly windowContainer: Container;
  readonly sheet?: SpriteSheet | undefined;
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** Only this seat's messages become notes. */
  readonly localPlayer: number;
  /** A building type's menu label, which names a building in its note. */
  readonly buildingLabel: (typeId: number) => string | undefined;
  /** A paper's display name, for the note about finding one. */
  readonly paperLabel: (paper: Paper) => string;
  readonly technologyLabel: (kind: 'job' | 'good' | 'house', typeId: number) => string;
  readonly playerLabel: (player: number) => string | null;
  /** The seats this player has met, as the diplomacy roster lists them; a first contact and a seat that
   *  changed its stance toward this one each become a note. Read once per tick. */
  readonly metSeats: () => readonly MetSeat[];
  readonly tooltip?: TooltipSurface | undefined;
  readonly onSelect: (target: MessageTarget) => void;
  readonly initial?: MessageFeedState | undefined;
}

/** The message centre: the feed, its notes along the top edge, and the window a note opens. */
export interface MessageCenter {
  /** Per frame: raise this frame's events and a due snapshot sweep as notes, retire the stale ones,
   *  redraw. */
  present(snapshot: WorldSnapshot, events: readonly SimEvent[], selection: UnitSelectionView): void;
  level(): MessagePriorityLevel;
  setLevel(level: MessagePriorityLevel): void;
  /** How many notes the feed shows at the current level. */
  count(): number;
  /** True over the open window or a note. */
  claims(x: number, y: number): boolean;
  /** The open window's own claim; it draws above the tool pop-ups, so it takes a press before them. */
  windowClaims(x: number, y: number): boolean;
  handleWindowClick(x: number, y: number, button: number): boolean;
  /** Left on a note opens it, right dismisses it (Shift: all of them); true when consumed. The caller
   *  offers a press only where no pop-up covers the note. */
  handleNoteClick(x: number, y: number, button: number, shift: boolean): boolean;
  /** Tooltip for the note or the priority button under the pointer; `covered` means a pop-up is over
   *  the point, which hides it. */
  handleHover(x: number, y: number, clientX: number, clientY: number, covered: boolean): void;
  state(): MessageFeedState;
  /** Adopt another mount's feed, so a HUD rescale keeps the notes and the level. */
  restore(state: MessageFeedState): void;
  dispose(): void;
}

const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

/** The catalog's stand-in for a decoded `messages` row, keyed by the row id. */
function fallbackRow(id: number): string {
  const rows: Readonly<Record<string, string | undefined>> = messages().userMessages.rows;
  return rows[String(id)] ?? '';
}

function makeNaming(deps: MessageCenterDeps): MessageNaming {
  return {
    settler: (e: SnapshotEntity, snapshot) => {
      const s = e.components.Settler as { tribe?: unknown; jobType?: unknown } | undefined;
      const jobType = num(s?.jobType);
      const young = e.components.Age !== undefined;
      const female = isFemale(e);
      const name = characterName(
        num(s?.tribe) ?? PRIMARY_TRIBE,
        jobType,
        young,
        e.id,
        surnameSourceOf(snapshot, e),
        female,
      );
      // The original appends the trade for a grown man with one; women and children go by name alone.
      const def = young || female ? undefined : professionDefForJob(jobType);
      return { name, jobLabel: def === undefined ? null : professionLabel(def.key) };
    },
    building: (e) => {
      const typeId = num((e.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
      return typeId === undefined ? null : (deps.buildingLabel(typeId) ?? null);
    },
    // An authored roster name, else the numbered fallback the diplomacy window renders: many maps leave
    // a slot unnamed, and a note about a nameless seat would lose its subject entirely.
    player: (player) =>
      deps.playerLabel(player) ??
      `${deps.ctx.uiString('miscwindow', PLAYER_STRING_ID, messages().hud.player)} ${player}`,
    stance: (state) => diplomacyStanceText(deps.ctx.uiString, state),
    paper: deps.paperLabel,
    technology: deps.technologyLabel,
    training: (course, subjectName, jobName) =>
      formatMessage(
        course === 'barracks'
          ? messages().userMessages.becameSoldier
          : messages().userMessages.learnedProfession,
        { name: subjectName, profession: jobName },
      ),
    text: (type, parts) => composeMessageText(type, parts, { uiString: deps.ctx.uiString, fallbackRow }),
  };
}

export function createMessageCenter(deps: MessageCenterDeps): MessageCenter {
  const { ctx } = deps;
  let feed = createMessageFeed(deps.initial);
  const dismissDeselected = createDeselectionDismisser(() => feed);
  const naming = makeNaming(deps);
  const snapshotSource = createSnapshotMessageSource(deps.localPlayer);
  const diplomacySource = createDiplomacyMessageSource(deps.metSeats);
  const strip = createMessageStrip({
    ctx,
    app: deps.app,
    art: deps.art,
    container: deps.notesContainer,
    sheet: deps.sheet,
    playerColourOf: deps.playerColourOf,
  });
  const select = (m: UserMessage): void => deps.onSelect({ entity: m.subject?.entity ?? null, at: m.at });
  const messageWindow = createMessageWindow({
    ctx,
    container: deps.windowContainer,
    onRemove: (id) => feed.remove(id, true),
    onSelect: (id) => {
      const m = feed.find(id);
      if (m !== undefined) select(m);
    },
  });
  let previous: WorldSnapshot | null = null;

  const noteAt = (x: number, y: number): UserMessage | undefined => {
    const slots = strip.slots();
    const i = hitTestNotes(slots, x, y);
    const slot = i === null ? undefined : slots[i];
    return slot === undefined ? undefined : feed.find(slot.id);
  };

  return {
    present: (snapshot, events, selection): void => {
      dismissDeselected(selection);
      // The same snapshot object means no tick ran, so nothing was raised and nothing aged.
      if (snapshot !== previous) {
        if (events.length > 0) {
          for (const raised of messagesFromEvents(events, snapshot, previous, deps.localPlayer, naming)) {
            feed.add(raised.pending, snapshot.tick, raised.compose);
          }
        }
        for (const raised of snapshotSource.sweep(snapshot, naming)) {
          feed.add(raised.pending, snapshot.tick, raised.compose);
        }
        for (const raised of diplomacySource.poll(naming)) {
          feed.add(raised.pending, snapshot.tick, raised.compose);
        }
        feed.expire(snapshot.tick, (m) => isNoteOver(m, snapshot));
        previous = snapshot;
      }
      strip.render(feed.displayed(), snapshot, feed.version());
      const open = messageWindow.current();
      if (open !== null && feed.find(open) === undefined) messageWindow.close();
      else messageWindow.refresh();
    },
    level: () => feed.level(),
    setLevel: (level) => feed.setLevel(level),
    count: () => feed.displayed().length,
    claims: (x, y) => messageWindow.claims(x, y) || noteAt(x, y) !== undefined,
    windowClaims: (x, y) => messageWindow.claims(x, y),
    handleWindowClick: (x, y, button): boolean => {
      if (!messageWindow.claims(x, y)) return false;
      // Either button stays inside the window; only the left one presses its plates.
      return button === LEFT_BUTTON ? messageWindow.handleClick(x, y) : true;
    },
    handleNoteClick: (x, y, button, shift): boolean => {
      const m = noteAt(x, y);
      if (m === undefined) return false;
      if (button === RIGHT_BUTTON) {
        ctx.cue('confirm');
        if (shift) feed.removeAll(true);
        else feed.remove(m.id, true);
        deps.tooltip?.hide();
        return true;
      }
      if (button !== LEFT_BUTTON) return false;
      ctx.cue('confirm');
      messageWindow.open(m);
      return true;
    },
    handleHover: (x, y, clientX, clientY, covered): void => {
      if (deps.tooltip === undefined) return;
      const m = covered ? undefined : noteAt(x, y);
      if (m !== undefined) deps.tooltip.show(clientX, clientY, m.text);
      else deps.tooltip.hide();
    },
    state: () => feed.state(),
    restore: (state): void => {
      messageWindow.close();
      feed = createMessageFeed(state);
      strip.invalidate();
    },
    dispose: (): void => {
      deps.tooltip?.hide();
      strip.dispose();
    },
  };
}
