import type { SpriteSheet } from '@open-northland/render';
import {
  entityById,
  type HalfCellNode,
  type Paper,
  type SimEvent,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { professionDefForJob } from '../../../catalog/professions.js';
import { characterName } from '../../../game/character-names/index.js';
import { PRIMARY_TRIBE } from '../../../game/rules.js';
import { isFemale, num, type SnapshotEntity, surnameSourceOf } from '../../../game/snapshot.js';
import type { ViewerSeat } from '../../../game/viewer-seat.js';
import { formatMessage, messages, professionLabel } from '../../../i18n/index.js';
import type { BuildingThumbs } from '../../dom/building-thumb.js';
import { createNoticeArt, noticeTint } from '../../dom/notice-art.js';
import { createNoticeColumn, type NoticeCardView } from '../../dom/notice-column.js';
import type { PanelContext } from '../context.js';
import { diplomacyStanceText } from '../diplomacy/model.js';
import { noticeThumb, orderNotes } from './cards.js';
import type { MessageFeedState } from './feed.js';
import type { FigureFrames } from './figure-frames.js';
import { NoticeFigures } from './figures.js';
import { createDiplomacyMessageSource, type MetSeat } from './from-diplomacy.js';
import { messagesFromEvents } from './from-events.js';
import { createSnapshotMessageSource, SNAPSHOT_SWEEP_INTERVAL_TICKS } from './from-snapshot.js';
import { galleryMessages, type NoticeGallery } from './gallery.js';
import type { MessageNaming } from './raise.js';
import { isNoteOver, isSubjectGone } from './retire.js';
import { createSeatFeeds } from './seat-feeds.js';
import { composeMessageText, type MessageText, type ShortLabels } from './text.js';
import type { UserMessage } from './types.js';

export type { MessageFeedState } from './feed.js';
export { NOTICE_GALLERY_DEBUG_FLAG, type NoticeGallery } from './gallery.js';

/** The `miscwindow` row heading an unnamed seat, ahead of its slot number. */
const PLAYER_STRING_ID = 361;
/** A note this young slides in as it arrives; an older one (a restored feed) simply stands. */
const FRESH_NOTE_TICKS = 2 * TICKS_PER_SECOND;
/** The building body's canvas box on a note (design px): the thumbnail's content height at rest;
 *  `object-fit: contain` fits it to whatever the padding leaves. */
const NOTICE_THUMB_BOX_PX = 40;

/** Where a note's press centres the view: the subject while it lives, else the spot it was raised at. */
export interface MessageTarget {
  readonly entity: number | null;
  readonly at: HalfCellNode | null;
}

export interface MessageCenterDeps {
  readonly ctx: PanelContext;
  /** The DOM plane the column mounts on. */
  readonly plane: HTMLElement;
  /** Design px the column keeps clear above the plane's bottom edge, for the minimap. */
  readonly bottomInset: number;
  /** The sheet the cards' settler figures draw from; absent, the thumbnails stay clear. */
  readonly sheet?: SpriteSheet | undefined;
  /** That sheet's recoloured-frame cache, one for every figure painter of the panel. */
  readonly figureFrames: FigureFrames;
  /** Paints a finished building's body on its note, as the construction window pictures it; absent,
   *  the note shows the house glyph. */
  readonly buildingThumbs?: BuildingThumbs | undefined;
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** Only the viewer seat's messages become notes. A spectator switching seats gets that seat's notes
   *  from the switch on, over what it dismissed on an earlier visit; watching the whole map, none. */
  readonly viewer: ViewerSeat;
  /** A building type's menu label, which names a building in its note. */
  readonly buildingLabel: (typeId: number) => string | undefined;
  /** A vehicle type's name, which leads its refused-order notes. */
  readonly vehicleLabel: (typeId: number) => string | undefined;
  /** A paper's display name, for the note about finding one. */
  readonly paperLabel: (paper: Paper) => string;
  readonly technologyLabel: (kind: 'job' | 'good' | 'house', typeId: number) => string;
  readonly playerLabel: (player: number) => string | null;
  /** The seats this player has met, as the diplomacy roster lists them; a first contact and a seat that
   *  changed its stance toward this one each become a note. Read once per tick. */
  readonly metSeats: () => readonly MetSeat[];
  readonly onSelect: (target: MessageTarget) => void;
  readonly initial?: MessageFeedState | undefined;
  /** Set, raises one note of every type on the seat's own actors once a sweep (the `notices` debug flag). */
  readonly gallery?: NoticeGallery | undefined;
}

/** The message centre: the feed and the notification column that shows it. */
export interface MessageCenter {
  /** Per frame: raise this frame's events and a due snapshot sweep as notes, retire the stale ones,
   *  redraw what changed and paint the figures; `alpha` is the frame's inter-tick fraction, as the map
   *  draws with. */
  present(snapshot: WorldSnapshot, events: readonly SimEvent[], alpha: number): void;
  state(): MessageFeedState;
  /** Adopt another mount's feed, so a HUD rescale keeps the notes and the level. */
  restore(state: MessageFeedState): void;
  dispose(): void;
}

/** The catalog's stand-in for a decoded `messages` row, keyed by the row id. */
function fallbackRow(id: number): string {
  const rows: Readonly<Record<string, string | undefined>> = messages().userMessages.rows;
  return rows[String(id)] ?? '';
}

function shortLabels(): ShortLabels {
  const copy = messages().userMessages;
  return {
    byType: copy.short,
    withGood: copy.shortWithGood,
    withStance: copy.shortWithStance,
    unknownHeroDied: copy.shortUnknownHeroDied,
  };
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
    vehicle: (e) => {
      const typeId = num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
      return typeId === undefined ? null : (deps.vehicleLabel(typeId) ?? null);
    },
    // An authored roster name, else the numbered fallback the diplomacy window renders: many maps leave
    // a slot unnamed, and a note about a nameless seat would lose its subject entirely.
    player: (player) =>
      deps.playerLabel(player) ??
      `${deps.ctx.uiString('miscwindow', PLAYER_STRING_ID, messages().hud.player)} ${player}`,
    stance: (state) => diplomacyStanceText(deps.ctx.uiString, state),
    paper: deps.paperLabel,
    technology: deps.technologyLabel,
    training: (course, subjectName, jobName): MessageText => {
      const body = formatMessage(
        course === 'barracks'
          ? messages().userMessages.becameSoldier
          : messages().userMessages.learnedProfession,
        { profession: jobName },
      );
      const short = formatMessage(
        course === 'barracks'
          ? messages().userMessages.shortBecameSoldier
          : messages().userMessages.shortLearnedProfession,
        { profession: jobName },
      );
      return { short, full: `${subjectName} ${body}` };
    },
    text: (type, parts) =>
      composeMessageText(type, parts, { uiString: deps.ctx.uiString, fallbackRow, short: shortLabels() }),
  };
}

function buildingTypeIn(snapshot: WorldSnapshot): (entity: number) => number | undefined {
  return (entity) => {
    const building = entityById(snapshot, entity)?.components.Building as
      | { buildingType?: unknown }
      | undefined;
    return num(building?.buildingType);
  };
}

function cardOf(m: UserMessage, snapshot: WorldSnapshot): NoticeCardView {
  return {
    id: m.id,
    level: m.priority,
    short: m.text.short,
    full: m.text.full,
    thumb: noticeThumb(m, buildingTypeIn(snapshot)),
    canGo: m.subject !== null || m.at !== null,
    fresh: snapshot.tick - m.tick < FRESH_NOTE_TICKS,
  };
}

export function createMessageCenter(deps: MessageCenterDeps): MessageCenter {
  const { ctx } = deps;
  const feeds = createSeatFeeds(deps.viewer.seat(), deps.initial);
  const naming = makeNaming(deps);
  let snapshotSource = feeds.seat === null ? null : createSnapshotMessageSource(feeds.seat);
  let diplomacySource = createDiplomacyMessageSource(deps.metSeats);
  const select = (m: UserMessage): void => deps.onSelect({ entity: m.subject?.entity ?? null, at: m.at });
  const art = createNoticeArt();
  const column = createNoticeColumn({
    plane: deps.plane,
    bottomInset: deps.bottomInset,
    paintBuilding: (canvas, typeId) =>
      deps.buildingThumbs?.paint(canvas, typeId, NOTICE_THUMB_BOX_PX) === true,
    paintGlyph: (canvas, glyph, seat, onFail) =>
      art?.paint(canvas, glyph, noticeTint(seat, deps.playerColourOf), onFail) === true,
    onLevel: (level) => {
      ctx.cue('confirm');
      feeds.current.setLevel(level);
    },
    onGo: (id) => {
      const m = feeds.current.find(id);
      if (m === undefined) return;
      ctx.cue('confirm');
      select(m);
    },
    onDismiss: (id) => {
      ctx.cue('confirm');
      feeds.current.remove(id, true);
    },
    onDismissAll: () => {
      ctx.cue('confirm');
      feeds.current.removeAll(true);
    },
  });
  const figures = new NoticeFigures(deps.sheet, deps.figureFrames, deps.playerColourOf);
  let previous: WorldSnapshot | null = null;
  let renderedVersion = -1;
  // The sources start over with the seat, since the idle streaks and the met seats they remember are
  // the last seat's.
  const switchSeat = (seat: number | null): void => {
    if (!feeds.switchTo(seat)) return;
    snapshotSource = seat === null ? null : createSnapshotMessageSource(seat);
    diplomacySource = createDiplomacyMessageSource(deps.metSeats);
    previous = null;
    renderedVersion = -1;
  };
  let lastGalleryTick: number | null = null;
  const galleryDue = (tick: number): boolean => {
    if (lastGalleryTick !== null && tick - lastGalleryTick < SNAPSHOT_SWEEP_INTERVAL_TICKS) return false;
    lastGalleryTick = tick;
    return true;
  };

  return {
    present: (snapshot, events, alpha): void => {
      const seat = deps.viewer.seat();
      if (seat !== feeds.seat) switchSeat(seat);
      // The same snapshot object means no tick ran, so nothing was raised and nothing aged.
      if (snapshot !== previous) {
        if (seat !== null && events.length > 0) {
          for (const raised of messagesFromEvents(events, snapshot, previous, seat, naming)) {
            feeds.current.add(raised.pending, snapshot.tick, raised.compose);
          }
        }
        for (const raised of snapshotSource?.sweep(snapshot, naming) ?? []) {
          feeds.current.add(raised.pending, snapshot.tick, raised.compose);
        }
        if (seat !== null) {
          for (const raised of diplomacySource.poll(naming)) {
            feeds.current.add(raised.pending, snapshot.tick, raised.compose);
          }
        }
        if (seat !== null && deps.gallery !== undefined && galleryDue(snapshot.tick)) {
          for (const raised of galleryMessages(snapshot, seat, naming, deps.metSeats(), deps.gallery)) {
            feeds.current.add(raised.pending, snapshot.tick, raised.compose);
          }
        }
        // The gallery's notes have no cause in the sim to check against, so they stand until dismissed or
        // their subject is gone; retiring them would bring each back a sweep later as a new card.
        if (deps.gallery === undefined) feeds.current.expire(snapshot.tick, (m) => isNoteOver(m, snapshot));
        else feeds.current.expire(snapshot.tick, (m) => isSubjectGone(m, snapshot), true);
        previous = snapshot;
      }
      if (feeds.current.version() !== renderedVersion) {
        renderedVersion = feeds.current.version();
        column.render(
          orderNotes(feeds.current.displayed()).map((m) => cardOf(m, snapshot)),
          feeds.current.tally(),
          feeds.current.level(),
        );
      }
      // The figures are painted into their cards every frame, so they move as the map's settlers do and
      // stay part of the card. A paused sim holds the tick, so they hold their frame with it.
      const { slots, box } = column.figures();
      figures.render(snapshot, slots, box, snapshot.tick, alpha);
    },
    state: () => feeds.current.state(),
    restore: (state): void => {
      feeds.restore(state);
      renderedVersion = -1;
    },
    dispose: (): void => {
      column.dispose();
    },
  };
}
