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
    if (member !== this.creator()) return 'only the creator changes room settings';
    const before = this.settings;
    if (
      before.initialSave !== undefined &&
      (before.seed !== settings.seed || !sameSessionRules(before.rules, settings.rules))
    ) {
      return 'saved world seed and rules are fixed';
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

  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    if (member !== this.creator()) return 'only the creator sets up seats';
    if (this.settings.initialSave !== undefined && (change.color !== undefined || change.team !== undefined))
      return 'saved seat colors and teams are fixed';
    if (this.settings.initialSave !== undefined && change.mode === 'absent')
      return 'a saved world already places every seat';
    const before = this.seats.views().find((seat) => seat.player === player);
    const refusal = this.seats.setUp(player, change);
    if (refusal !== null) return refusal;
    const after = this.seats.views().find((seat) => seat.player === player);
    if (
      before?.mode === after?.mode &&
      before?.color === after?.color &&
      (before?.team ?? null) === (after?.team ?? null)
    )
      return null;
    this.invalidateReady();
    this.changed();
    return null;
  }

  setReady(member: Member, ready: boolean): Refusal {
    if (member.seat === null) return 'take a seat first';
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
      if (member.seat === null) return `${member.nick} has no seat`;
      if (!member.ready) return `${member.nick} is not ready`;
    }
    return null;
  }

  private compatibilityRefusal(): Refusal {
    const creator = this.creator();
    if (creator === null) return 'the room has no creator';
    const issue = compatibilityIssues([...this.members.values()], creator.nick, this.settings.initialSave)[0];
    if (issue === undefined) return null;
    return `${issue.nick}: ${issue.kind} compatibility ${issue.reason}`;
  }
}
