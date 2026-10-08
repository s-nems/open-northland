import type { SpriteSheet } from '@open-northland/render';
import {
  type EntitySnapshot,
  entityById,
  type HalfCellNode,
  type Paper,
  type SimEvent,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { professionDefForJob } from '../../../catalog/professions.js';
import { isFemale, isPalisade, isRoadSite, num, type SnapshotEntity } from '../../../game/snapshot.js';
import type { ViewerSeat } from '../../../game/viewer-seat.js';
import { bcp47Tag, formatMessage, messages, professionLabel } from '../../../i18n/index.js';
import type { BuildingThumbs } from '../../dom/building-thumb.js';
import { diplomacyStanceText, playerLabel } from '../../dom/diplomacy-window/model.js';
import { createNoticeArt, noticeTint } from '../../dom/notice-art.js';
import {
  createNoticeColumn,
  type NoticeCardView,
  type NoticeMemberView,
  type NoticeStackView,
} from '../../dom/notice-column.js';
import type { FigureFrames } from '../../figures/figure-frames.js';
import type { PanelContext } from '../context.js';
import { noticeThumb } from './cards.js';
import { type MessageFeedState, takeRaised } from './feed.js';
import { FightAreas, shownFightAt } from './fight-areas.js';
import { type NoticeFigureSlot, NoticeFigures } from './figures.js';
import { createDiplomacyMessageSource, type MetSeat } from './from-diplomacy.js';
import { type BuildingTrades, messagesFromEvents, type VehicleSiteTest } from './from-events.js';
import { createSnapshotMessageSource, SNAPSHOT_SWEEP_INTERVAL_TICKS } from './from-snapshot.js';
import { galleryMessages, galleryStackMessages, type NoticeGallery } from './gallery.js';
import {
  groupBreakdown,
  groupMixesLines,
  groupNotes,
  MIN_STACK_MEMBERS,
  type NoticeGroup,
} from './groups.js';
import type { MessageNaming, RaisedMessage } from './raise.js';
import { isSubjectGone, NoteRetirement } from './retire.js';
import { createSeatFeeds } from './seat-feeds.js';
import type { SiteSeam } from './site-shortages.js';
import { composeMessageText, fightSummary } from './text.js';
import type { PendingMessage, UserMessage } from './types.js';
import type { WorkshopSeam } from './workshop-stalls.js';

export type { MessageFeedState } from './feed.js';
export type { MetSeat } from './from-diplomacy.js';
export { NOTICE_GALLERY_DEBUG_FLAG, type NoticeGallery } from './gallery.js';
export type { SiteSeam } from './site-shortages.js';
export type { WorkshopSeam } from './workshop-stalls.js';

/** A note this young slides in as it arrives; an older one (a restored feed) simply stands. */
const FRESH_NOTE_TICKS = 2 * TICKS_PER_SECOND;
/** The building body's canvas box on a note (design px): the thumbnail's content height at rest;
 *  `object-fit: contain` fits it to whatever the padding leaves. */
const NOTICE_THUMB_BOX_PX = 40;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const TICKS_PER_MINUTE = SECONDS_PER_MINUTE * TICKS_PER_SECOND;

/** Where a note's press centres the view: the subject while it lives, else the spot it was raised at. */
export interface MessageTarget {
  readonly entity: number | null;
  readonly at: HalfCellNode | null;
}

export interface MessageCenterDeps {
  readonly ctx: PanelContext;
  readonly settlerName: (entity: SnapshotEntity) => string;
  /** The DOM plane the column mounts on. */
  readonly plane: HTMLElement;
  /** Design px the column keeps clear above the plane's bottom edge, for the minimap. */
  readonly bottomInset: number | (() => number);
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
  /** A discoverable's name, or undefined when no catalog names it; such an entry is left out. */
  readonly technologyName: (kind: 'job' | 'good' | 'house', typeId: number) => string | undefined;
  /** The trades a construction-menu building employs, which pick the building an unlock note pictures. */
  readonly buildingTrades: BuildingTrades;
  /** The vehicle build sites, which an unlock note lists as vehicles; absent, none are. */
  readonly isVehicleSite?: VehicleSiteTest | undefined;
  /** The seat's workshops and the sim's diagnosis of their workers; absent, no stall note is raised. */
  readonly workshops?: WorkshopSeam | undefined;
  /** The sim's read of the seat's building sites' supply; absent, no shortage note is raised. */
  readonly sites?: SiteSeam | undefined;
  readonly playerLabel: (player: number) => string | null;
  /** The seats this player has met, as the diplomacy roster lists them; a first contact and a seat that
   *  changed its stance toward this one each become a note. Read once per tick. */
  readonly metSeats: () => readonly MetSeat[];
  readonly onSelect: (target: MessageTarget) => void;
  /** An attack note just shown as a new card, at its hit: the minimap's alarm follows the column. */
  readonly onAttackShown?: ((at: HalfCellNode) => void) | undefined;
  readonly initial?: MessageFeedState | undefined;
  /** Set, raises one note of every type on the seat's own actors once a sweep (the `notices` debug flag). */
  readonly gallery?: NoticeGallery | undefined;
}

/** The message centre: the feed and the notification column that shows it. */
export interface MessageCenter {
  /** Per frame: raise this frame's events and a due snapshot sweep as notes, retire the stale ones,
   *  redraw what changed and paint the figures; `alpha` is the frame's inter-tick fraction, as the map
   *  draws with. */
  present(
    snapshot: WorldSnapshot,
    events: readonly SimEvent[],
    departed: readonly EntitySnapshot[],
    alpha: number,
  ): void;
  state(): MessageFeedState;
  /** Adopt another mount's feed, so a HUD rescale keeps the notes and the level. */
  restore(state: MessageFeedState): void;
  dispose(): void;
}

function makeNaming(deps: MessageCenterDeps): MessageNaming {
  return {
    settler: (e: SnapshotEntity) => {
      const s = e.components.Settler as { tribe?: unknown; jobType?: unknown } | undefined;
      const jobType = num(s?.jobType);
      const young = e.components.Age !== undefined;
      const female = isFemale(e);
      const name = deps.settlerName(e);
      // The original appends the trade for a grown man with one; women and children go by name alone.
      const def = young || female ? undefined : professionDefForJob(jobType);
      return { name, jobLabel: def === undefined ? null : professionLabel(def.key), female };
    },
    building: (e) => {
      const unnamed = messages().userMessages.unnamed;
      if (isPalisade(e)) return unnamed.wall;
      if (isRoadSite(e)) return unnamed.road;
      const typeId = num((e.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
      const label = typeId === undefined ? undefined : deps.buildingLabel(typeId);
      return label ?? unnamed.building;
    },
    vehicle: (e) => {
      const typeId = num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
      const label = typeId === undefined ? undefined : deps.vehicleLabel(typeId);
      return label ?? messages().userMessages.unnamed.vehicle;
    },
    // The numbered fallback keeps a note about a nameless seat from losing its subject.
    player: (player) => playerLabel(deps.ctx.uiString, player, deps.playerLabel(player)),
    stance: (state) => diplomacyStanceText(deps.ctx.uiString, state),
    paper: deps.paperLabel,
    technology: deps.technologyName,
    text: (type, parts) => composeMessageText(type, parts, messages().userMessages),
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

function vehicleOnMapIn(snapshot: WorldSnapshot): (entity: number) => boolean {
  return (entity) => entityById(snapshot, entity)?.components.Position !== undefined;
}

/** How long ago a note was raised, as a row shows it: now, in minutes, then in hours. */
function ageLabel(ticks: number): string {
  const copy = messages().hud.notices;
  const minutes = Math.floor(ticks / TICKS_PER_MINUTE);
  if (minutes < 1) return copy.ageNow;
  if (minutes < MINUTES_PER_HOUR) return formatMessage(copy.ageMinutes, { count: minutes });
  return formatMessage(copy.ageHours, { count: Math.floor(minutes / MINUTES_PER_HOUR) });
}

/** The tick a note raised at `raised` changes its age label after `now`: the next minute, past an hour
 *  the next hour. */
function nextAgeChange(raised: number, now: number): number {
  const minutes = Math.floor((now - raised) / TICKS_PER_MINUTE);
  const step = minutes < MINUTES_PER_HOUR ? 1 : MINUTES_PER_HOUR;
  return raised + (Math.floor(minutes / step) + 1) * step * TICKS_PER_MINUTE;
}

function cardOf(m: UserMessage, snapshot: WorldSnapshot): NoticeCardView {
  return {
    id: m.id,
    level: m.priority,
    short: m.text.short,
    full: m.text.full,
    thumb: noticeThumb(m, buildingTypeIn(snapshot), vehicleOnMapIn(snapshot)),
    canGo: m.subject !== null || m.at !== null,
    fresh: snapshot.tick - m.tick < FRESH_NOTE_TICKS,
  };
}

export function createMessageCenter(deps: MessageCenterDeps): MessageCenter {
  const { ctx } = deps;
  const feeds = createSeatFeeds(deps.viewer.seat(), deps.initial);
  const naming = makeNaming(deps);
  const snapshotSourceOf = (seat: number | null) =>
    seat === null ? null : createSnapshotMessageSource(seat, deps.workshops, deps.sites);
  let snapshotSource = snapshotSourceOf(feeds.seat);
  let diplomacySource = createDiplomacyMessageSource(deps.metSeats);
  let fights = FightAreas.adopt(deps.initial);
  // Keyed by note id, so it starts over with every feed it serves.
  let retirement = new NoteRetirement(
    fights,
    snapshotSource?.stalls,
    snapshotSource?.shortages,
    snapshotSource?.idleReasons,
  );
  // The tick of the last presented snapshot, which a dismissal is stamped with.
  let presentedTick = 0;
  const select = (m: UserMessage): void => deps.onSelect({ entity: m.subject?.entity ?? null, at: m.at });
  // The stack listed in the column, the stacks last shown by key (a card's dismissal takes the members
  // it showed), each listed note's subject name, named once, and the tick a listed row's age next reads
  // differently.
  let openKey: string | null = null;
  let shownGroups = new Map<string, NoticeGroup>();
  const subjectNames = new Map<number, string>();
  let ageChangeTick = Number.POSITIVE_INFINITY;
  /** Who a row is about: the subject's name, kept once named; a fight's strikers and hits; else the
   *  note's whole message, which a revised note changes. */
  const rowLabel = (m: UserMessage, snapshot: WorldSnapshot): string => {
    const known = subjectNames.get(m.id);
    if (known !== undefined) return known;
    const e = m.subject === null ? undefined : entityById(snapshot, m.subject.entity);
    if (e !== undefined && m.subject !== null) {
      const { kind } = m.subject;
      const name =
        kind === 'settler'
          ? naming.settler(e, snapshot).name
          : kind === 'building'
            ? naming.building(e)
            : naming.vehicle(e);
      subjectNames.set(m.id, name);
      return name;
    }
    if (m.fight !== undefined) {
      const { buildings, walls, settlers, vehicles, seats, wild } = m.fight;
      const enemies = seats.map((seat) => naming.player(seat));
      return fightSummary({ buildings, walls, settlers, vehicles, enemies, wild }, messages().userMessages);
    }
    return m.text.full;
  };
  const membersOf = (group: NoticeGroup, snapshot: WorldSnapshot): NoticeMemberView[] => {
    const mixed = groupMixesLines(group);
    const listed = new Set(group.members.map((m) => m.id));
    for (const id of subjectNames.keys()) if (!listed.has(id)) subjectNames.delete(id);
    return group.members.map((m) => {
      ageChangeTick = Math.min(ageChangeTick, nextAgeChange(m.tick, snapshot.tick));
      const card = cardOf(m, snapshot);
      return {
        id: m.id,
        level: m.priority,
        label: rowLabel(m, snapshot),
        detail: mixed ? m.text.short : '',
        age: ageLabel(snapshot.tick - m.tick),
        full: card.full,
        thumb: card.thumb,
        canGo: card.canGo,
      };
    });
  };
  const stackOf = (group: NoticeGroup, snapshot: WorldSnapshot): NoticeStackView => {
    const [first] = group.members;
    if (first === undefined) throw new Error('message centre: an empty notice group');
    const count = group.members.length;
    const stacked = count >= MIN_STACK_MEMBERS;
    return {
      key: group.key,
      lead: { ...cardOf(first, snapshot), fresh: snapshot.tick - group.newest.tick < FRESH_NOTE_TICKS },
      count,
      breakdown: stacked ? groupBreakdown(group, messages().hud.notices, bcp47Tag()) : '',
      members: stacked && group.key === openKey ? membersOf(group, snapshot) : null,
    };
  };
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
      feeds.current.remove(id, presentedTick);
    },
    // Member by member, so each stays dismissed only while its own cause lasts.
    onDismissGroup: (key) => {
      const group = shownGroups.get(key);
      if (group === undefined) return;
      ctx.cue('confirm');
      feeds.current.removeMany(new Set(group.members.map((m) => m.id)), presentedTick);
    },
    onOpen: (key, source) => {
      if (source === 'press') ctx.cue('confirm');
      openKey = key;
      renderedVersion = -1;
    },
    onDismissAll: () => {
      ctx.cue('confirm');
      feeds.current.removeAll(presentedTick);
    },
  });
  const figures = new NoticeFigures(deps.sheet, deps.figureFrames, deps.playerColourOf);
  const unpictured = (slot: NoticeFigureSlot): void => column.unpicture(slot.canvas);
  let previous: WorldSnapshot | null = null;
  let renderedVersion = -1;
  // The sources start over with the seat, since the idle streaks and the met seats they remember are
  // the last seat's.
  const switchSeat = (seat: number | null): void => {
    if (!feeds.switchTo(seat)) return;
    snapshotSource = snapshotSourceOf(seat);
    diplomacySource = createDiplomacyMessageSource(deps.metSeats);
    fights = FightAreas.adopt(feeds.current.state());
    retirement = new NoteRetirement(
      fights,
      snapshotSource?.stalls,
      snapshotSource?.shortages,
      snapshotSource?.idleReasons,
    );
    previous = null;
    renderedVersion = -1;
  };
  const take = (raised: RaisedMessage, tick: number): void => {
    const feed = feeds.current;
    const fightAt = shownFightAt(feed, raised.pending, takeRaised(feed, raised, tick));
    if (fightAt !== null) deps.onAttackShown?.(fightAt);
  };
  const dismissed = (pending: PendingMessage): boolean => feeds.current.dismissed(pending);
  let lastGalleryTick: number | null = null;
  const galleryDue = (tick: number): boolean => {
    if (lastGalleryTick !== null && tick - lastGalleryTick < SNAPSHOT_SWEEP_INTERVAL_TICKS) return false;
    lastGalleryTick = tick;
    return true;
  };

  return {
    present: (snapshot, events, departed, alpha): void => {
      const seat = deps.viewer.seat();
      if (seat !== feeds.seat) switchSeat(seat);
      presentedTick = snapshot.tick;
      // The same snapshot object means no tick ran, so nothing was raised and nothing aged.
      if (snapshot !== previous) {
        if (seat !== null && events.length > 0) {
          for (const raised of messagesFromEvents(
            events,
            snapshot,
            departed,
            seat,
            naming,
            deps.buildingTrades,
            fights,
            deps.isVehicleSite,
          )) {
            take(raised, snapshot.tick);
          }
        }
        for (const raised of snapshotSource?.sweep(snapshot, naming, dismissed) ?? []) {
          take(raised, snapshot.tick);
        }
        if (seat !== null) {
          for (const raised of diplomacySource.poll(naming)) {
            feeds.current.add(raised.pending, snapshot.tick, raised.compose);
          }
        }
        if (seat !== null && deps.gallery !== undefined && galleryDue(snapshot.tick)) {
          for (const raised of galleryMessages(
            snapshot,
            seat,
            naming,
            deps.metSeats(),
            deps.gallery,
            deps.buildingTrades,
          )) {
            feeds.current.add(raised.pending, snapshot.tick, raised.compose, true);
          }
          for (const raised of galleryStackMessages(snapshot, seat, naming)) {
            feeds.current.add(raised.pending, snapshot.tick, raised.compose, true);
          }
        }
        // The gallery's notes have no cause in the sim to check against, so they stand until dismissed or
        // their subject is gone; retiring them would bring each back a sweep later as a new card.
        if (deps.gallery === undefined) {
          feeds.current.expire(snapshot.tick, (m) => retirement.isOver(m, snapshot));
          retirement.endPass();
        } else feeds.current.expire(snapshot.tick, (m) => isSubjectGone(m, snapshot), true);
        previous = snapshot;
      }
      if (
        feeds.current.version() !== renderedVersion ||
        (openKey !== null && snapshot.tick >= ageChangeTick)
      ) {
        renderedVersion = feeds.current.version();
        ageChangeTick = Number.POSITIVE_INFINITY;
        const groups = groupNotes(feeds.current.displayed());
        shownGroups = new Map(groups.map((group) => [group.key, group]));
        if ((shownGroups.get(openKey ?? '')?.members.length ?? 0) < MIN_STACK_MEMBERS) openKey = null;
        column.render(
          groups.map((group) => stackOf(group, snapshot)),
          feeds.current.tally(),
          feeds.current.level(),
          openKey,
        );
      }
      // The figures are painted into their cards every frame, so they move as the map's settlers do and
      // stay part of the card. A paused sim holds the tick, so they hold their frame with it.
      const { slots, box } = column.figures();
      figures.render(snapshot, slots, box, snapshot.tick, alpha, unpictured);
    },
    state: () => feeds.current.state(),
    restore: (state): void => {
      feeds.restore(state);
      fights = FightAreas.adopt(state);
      retirement = new NoteRetirement(
        fights,
        snapshotSource?.stalls,
        snapshotSource?.shortages,
        snapshotSource?.idleReasons,
      );
      renderedVersion = -1;
    },
    dispose: (): void => {
      column.dispose();
    },
  };
}
