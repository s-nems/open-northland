import {
  compatibilityIssues,
  type LobbyCompatibility,
  type LobbySettings,
  type RoomSettings,
  sameCompatibility,
  sameLobbySettings,
  sameSessionRules,
} from '@open-northland/net-protocol';
import type { Member, Refusal } from './member.js';
import type { SeatChange, SeatTable } from './seats.js';

export class Lobby {
  constructor(
    public settings: RoomSettings,
    private readonly seats: SeatTable,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly creator: () => Member | null,
    private readonly changed: () => void,
  ) {}

  invalidateReady(): void {
    for (const member of this.members.values()) member.ready = false;
  }

  setCompatibility(member: Member, compatibility: LobbyCompatibility | null): Refusal {
    if (sameCompatibility(member.compatibility, compatibility)) return null;
    member.compatibility = compatibility;
    this.invalidateReady();
    this.changed();
    return null;
  }

  setSettings(member: Member, settings: LobbySettings): Refusal {
    if (member !== this.creator()) return { code: 'creatorOnly' };
    const before = this.settings;
    if (
      before.initialSave !== undefined &&
      (before.seed !== settings.seed || !sameSessionRules(before.rules, settings.rules))
    ) {
      return { code: 'savedRulesFixed' };
    }
    if (sameLobbySettings(before, settings)) return null;
    this.settings = {
      ...settings,
      world: before.world,
      ...(before.initialSave === undefined ? {} : { initialSave: before.initialSave }),
      ...(before.mapOrigin === undefined ? {} : { mapOrigin: before.mapOrigin }),
    };
    this.invalidateReady();
    this.changed();
    return null;
  }

  claimSeat(member: Member, player: number | null): Refusal {
    if (member.seat === player) return null;
    if (player === null) this.seats.standUp(member);
    else {
      const refusal = this.seats.claim(member, player);
      if (refusal !== null) return refusal;
    }
    this.invalidateReady();
    this.changed();
    return null;
  }

  /** The creator sets up any seat; a seated member may choose only its own seat's tribe. */
  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    const ownTribe =
      member.seat === player &&
      change.tribe !== undefined &&
      change.mode === undefined &&
      change.color === undefined &&
      change.team === undefined &&
      change.difficulty === undefined;
    if (member !== this.creator() && !ownTribe) return { code: 'creatorOnly' };
    if (
      this.settings.initialSave !== undefined &&
      (change.color !== undefined ||
        change.team !== undefined ||
        change.tribe !== undefined ||
        change.difficulty !== undefined)
    )
      return { code: 'savedSeatsFixed' };
    if (this.settings.initialSave !== undefined && change.mode === 'absent')
      return { code: 'savedSeatsFixed' };
    const before = this.seats.views().find((seat) => seat.player === player);
    const refusal = this.seats.setUp(player, change);
    if (refusal !== null) return refusal;
    const after = this.seats.views().find((seat) => seat.player === player);
    if (
      before?.mode === after?.mode &&
      before?.color === after?.color &&
      (before?.team ?? null) === (after?.team ?? null) &&
      before?.tribe === after?.tribe &&
      before?.difficulty === after?.difficulty
    )
      return null;
    this.invalidateReady();
    this.changed();
    return null;
  }

  setReady(member: Member, ready: boolean): Refusal {
    if (member.seat === null) return { code: 'seatRequired' };
    if (ready) {
      const refusal = this.compatibilityRefusal();
      if (refusal !== null) return refusal;
    }
    if (member.ready === ready) return null;
    member.ready = ready;
    this.changed();
    return null;
  }

  startRefusal(): Refusal {
    const compatibility = this.compatibilityRefusal();
    if (compatibility !== null) return compatibility;
    for (const member of this.members.values()) {
      if (member.seat === null) return { code: 'memberUnseated', nick: member.nick };
      if (!member.ready) return { code: 'memberNotReady', nick: member.nick };
    }
    return null;
  }

  private compatibilityRefusal(): Refusal {
    const creator = this.creator();
    if (creator === null) return { code: 'noCreator' };
    const issue = compatibilityIssues([...this.members.values()], creator.nick, this.settings.initialSave)[0];
    if (issue === undefined) return null;
    return { code: 'incompatible', ...issue };
  }
}
