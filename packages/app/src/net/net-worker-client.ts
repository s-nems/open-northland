import type { GameSession, SessionDriver } from '@open-northland/lockstep';
import {
  type ClockState,
  type LobbyAction,
  type RelayClientView,
  type RelayLobby,
  RelayState,
} from '@open-northland/net-client';
import type {
  GovernedClock,
  RoomSummary,
  RoomView,
  ServerMessage,
  WaitedMember,
} from '@open-northland/net-protocol';
import type { CommandEnvelope, SaveGame } from '@open-northland/sim';
import type { RelayFacts, RelayRequest, ToNetWorker } from '../session/worker/net-protocol.js';

const NO_FACTS: RelayFacts = {
  tick: null,
  paused: false,
  speed: 1,
  bufferedTicks: 0,
  droppedTicks: 0,
  clickToApplyMs: null,
  resultTick: null,
  endedTick: null,
  isOutOfSync: false,
  worldId: null,
};

/**
 * The relay client as this thread sees it while the real one runs in the network worker: the lobby and
 * session state from the relay messages the worker forwards, applied in the order the worker's client
 * applied them, and the clock and world figures from the worker's facts. Requests post to the worker.
 */
export class RelayClientMirror implements RelayClientView {
  private readonly state: RelayState;
  private facts: RelayFacts = NO_FACTS;

  constructor(
    nick: string,
    private readonly post: (message: ToNetWorker<never>) => void,
    private readonly request: (request: RelayRequest) => Promise<unknown>,
  ) {
    this.state = new RelayState(nick);
  }

  /** A relay message the worker's client acted on. */
  apply(message: ServerMessage): void {
    this.state.apply(message);
  }

  follow(facts: RelayFacts): void {
    this.facts = facts;
  }

  /** The link dropped: not welcomed until the relay says so again, and out of a lobby room if `left`. */
  reset(left: boolean): void {
    this.state.welcomed = false;
    if (left) this.state.apply({ kind: 'left' });
  }

  get nick(): string {
    return this.state.nick;
  }
  get welcomed(): boolean {
    return this.state.welcomed;
  }
  get rooms(): readonly RoomSummary[] {
    return this.state.rooms;
  }
  get room(): RoomView | null {
    return this.state.room;
  }
  get session(): GameSession | null {
    return this.state.session;
  }
  get clockState(): ClockState | null {
    return this.state.clockState;
  }
  get waitingFor(): readonly WaitedMember[] {
    return this.state.waitingFor;
  }
  get delayTicks(): number | null {
    return this.state.delayTicks;
  }
  get roundTripMs(): number | null {
    return this.state.roundTripMs;
  }
  get isOutOfSync(): boolean {
    return this.facts.isOutOfSync;
  }
  get tick(): number | null {
    return this.facts.tick;
  }
  get paused(): boolean {
    return this.facts.paused;
  }
  get speed(): number {
    return this.facts.speed;
  }
  get governed(): GovernedClock | null {
    return this.state.clockState?.governed ?? null;
  }
  get bufferedTicks(): number {
    return this.facts.bufferedTicks;
  }
  get droppedTicks(): number {
    return this.facts.droppedTicks;
  }
  get latency(): { readonly clickToApplyMs: number | null } {
    return { clickToApplyMs: this.facts.clickToApplyMs };
  }
  get resultTick(): number | null {
    return this.facts.resultTick;
  }
  get endedTick(): number | null {
    return this.facts.endedTick;
  }
  get worldId(): number | null {
    return this.facts.worldId;
  }

  setPaused(paused: boolean): void {
    this.post({ kind: 'clock', paused });
  }
  setSpeed(speed: number): void {
    this.post({ kind: 'clock', speed });
  }
  submit(envelope: CommandEnvelope): void {
    this.post({ kind: 'submit', envelope });
  }
  async shareSave(to: string | null, save: SaveGame): Promise<void> {
    await this.request({ method: 'shareSave', to, save });
  }

  listRooms(): void {
    this.lobby('listRooms', []);
  }
  createRoom(...args: Parameters<RelayLobby['createRoom']>): void {
    this.lobby('createRoom', args);
  }
  joinRoom(...args: Parameters<RelayLobby['joinRoom']>): void {
    this.lobby('joinRoom', args);
  }
  leaveRoom(): void {
    this.lobby('leaveRoom', []);
  }
  claimSeat(...args: Parameters<RelayLobby['claimSeat']>): void {
    this.lobby('claimSeat', args);
  }
  setSeat(...args: Parameters<RelayLobby['setSeat']>): void {
    this.lobby('setSeat', args);
  }
  setSettings(...args: Parameters<RelayLobby['setSettings']>): void {
    this.lobby('setSettings', args);
  }
  requestInitialSave(): void {
    this.lobby('requestInitialSave', []);
  }
  requestMap(): void {
    this.lobby('requestMap', []);
  }
  setCompatibility(...args: Parameters<RelayLobby['setCompatibility']>): void {
    this.lobby('setCompatibility', args);
  }
  setReady(...args: Parameters<RelayLobby['setReady']>): void {
    this.lobby('setReady', args);
  }
  start(): void {
    this.lobby('start', []);
  }
  say(...args: Parameters<RelayLobby['say']>): void {
    this.lobby('say', args);
  }
  kick(...args: Parameters<RelayLobby['kick']>): void {
    this.lobby('kick', args);
  }
  sendBlob(...args: Parameters<RelayLobby['sendBlob']>): void {
    this.lobby('sendBlob', args);
  }

  private lobby<K extends LobbyAction>(name: K, args: Parameters<RelayLobby[K]>): void {
    this.post({ kind: 'lobby', name, args });
  }
}

/**
 * The driver the runtime runs a relayed world through: the worker session's delivery, with the relay's
 * clock. Tempo and pause read as the relay last broadcast them and change by request; the session's
 * own speed follows the speed the relay's clock runs at, governed or requested, so its interpolation
 * keeps pace.
 */
export function relayedSessionDriver(
  session: SessionDriver,
  client: Pick<RelayClientView, 'paused' | 'speed' | 'governed' | 'setPaused' | 'setSpeed'>,
): SessionDriver {
  return {
    get paused() {
      return client.paused;
    },
    get speed() {
      return client.speed;
    },
    get droppedTicks() {
      return session.droppedTicks;
    },
    maxStepsPerFrame: session.maxStepsPerFrame,
    setPaused: (paused) => client.setPaused(paused),
    setSpeed: (speed) => client.setSpeed(speed),
    advance: (elapsedMs, onTick) => {
      const running = client.governed?.speed ?? client.speed;
      if (session.speed !== running) session.setSpeed(running);
      return session.advance(elapsedMs, onTick);
    },
    submit: (envelope) => session.submit(envelope),
    captureSave: (options) => session.captureSave(options),
  };
}

/**
 * The tick the relay confirmed the match ended at, once the runtime delivered it: the facts arrive
 * ahead of the ticks a frame delivers, and the outcome is read off the delivered world with them.
 */
export function deliveredMatchEnd(
  client: Pick<RelayClientView, 'endedTick'>,
  delivered: { readonly tick: number },
): number | null {
  const ended = client.endedTick;
  return ended !== null && delivered.tick >= ended ? ended : null;
}
