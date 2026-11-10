import {
  type BlobUpload,
  type ChatLine,
  type ClientMessage,
  type HallChatLine,
  type LobbyCompatibility,
  type LobbySettings,
  type OnlinePlayer,
  type PlayerFlag,
  PROTOCOL_VERSION,
  type RecentPlayer,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomSummary,
  type RoomView,
  type SignalNode,
  withFlag,
} from '@open-northland/net-protocol';
import { RelayState } from './relay-state.js';

type SeatChange = Omit<Extract<ClientMessage, { kind: 'setSeat' }>, 'kind' | 'player'>;

export class RelayLobby {
  readonly token: string;
  /** The flag this client says `hello` with; none when absent. */
  readonly flag: PlayerFlag | undefined;
  protected readonly state: RelayState;
  protected send: (message: ClientMessage) => void = () => {
    throw new Error(`${this.nick} is not attached to a network`);
  };

  constructor(token: string, nick: string, flag?: PlayerFlag) {
    this.token = token;
    this.flag = flag;
    this.state = new RelayState(nick);
  }

  get nick(): string {
    return this.state.nick;
  }

  get welcomed(): boolean {
    return this.state.welcomed;
  }

  set welcomed(welcomed: boolean) {
    this.state.welcomed = welcomed;
  }

  get rooms(): readonly RoomSummary[] {
    return this.state.rooms;
  }

  get room(): RoomView | null {
    return this.state.room;
  }

  get chat(): readonly ChatLine[] {
    return this.state.chat;
  }

  get online(): readonly OnlinePlayer[] {
    return this.state.online;
  }

  get recent(): readonly RecentPlayer[] {
    return this.state.recent;
  }

  get hallChat(): readonly HallChatLine[] {
    return this.state.hallChat;
  }

  get relayBuild(): string | null {
    return this.state.relayBuild;
  }

  attach(send: (message: ClientMessage) => void): void {
    this.send = send;
  }

  hello(): void {
    this.send({
      kind: 'hello',
      protocol: PROTOCOL_VERSION,
      token: this.token,
      nick: this.nick,
      ...withFlag(this.flag),
    });
  }

  listRooms(): void {
    this.send({ kind: 'listRooms' });
  }

  /** `password` locks the room: every later join must name it. */
  createRoom(settings: RoomSettings, seats: readonly RoomSeatSetup[], password?: string): void {
    this.send({ kind: 'createRoom', settings, seats, ...(password === undefined ? {} : { password }) });
  }

  joinRoom(roomId: string, password?: string): void {
    this.send({ kind: 'joinRoom', roomId, ...(password === undefined ? {} : { password }) });
  }

  leaveRoom(): void {
    this.send({ kind: 'leaveRoom' });
  }

  claimSeat(player: number | null): void {
    this.send({ kind: 'claimSeat', player });
  }

  moveMember(nick: string, player: number | null): void {
    this.send({ kind: 'moveMember', nick, player });
  }

  /** The creator's: remove the member and keep it out of the room. */
  banMember(nick: string): void {
    this.send({ kind: 'banMember', nick });
  }

  setSeat(player: number, change: SeatChange): void {
    this.send({ kind: 'setSeat', player, ...change });
  }

  setSettings(settings: LobbySettings): void {
    this.send({ kind: 'setSettings', settings });
  }

  requestInitialSave(): void {
    this.send({ kind: 'requestInitialSave' });
  }

  requestMap(): void {
    this.send({ kind: 'requestMap' });
  }

  setCompatibility(compatibility: LobbyCompatibility | null): void {
    this.send({ kind: 'setCompatibility', compatibility });
  }

  setReady(ready: boolean): void {
    this.send({ kind: 'setReady', ready });
  }

  start(): void {
    this.send({ kind: 'start' });
  }

  setClock(change: { readonly speed?: number; readonly paused?: boolean }): void {
    this.send({ kind: 'clock', ...change });
  }

  say(text: string): void {
    this.send({ kind: 'chat', text });
  }

  /** Point the members in seats `to` at the half-cell node `at`. */
  signal(at: SignalNode, to: readonly number[]): void {
    this.send({ kind: 'signal', at, to });
  }

  /** A line for the relay's own chat, said outside a room. */
  sayInHall(text: string): void {
    this.send({ kind: 'hallChat', text });
  }

  /** How far this client's boot is, in whole percent, before its world reports `loaded`. */
  reportLoading(progress: number): void {
    this.send({ kind: 'loading', progress });
  }

  /** A yes towards kicking the member in seat `player`, or with `yes` false the withdrawal of one. */
  kick(player: number, yes: boolean): void {
    this.send({ kind: 'kick', player, yes });
  }

  sendBlob(upload: BlobUpload): void {
    this.send({ kind: 'blob', ...upload });
  }
}
