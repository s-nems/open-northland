import {
  type ClientMessage,
  type LobbyCompatibility,
  type LobbySettings,
  PROTOCOL_VERSION,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomSummary,
  type RoomView,
} from '@open-northland/net-protocol';

type SeatChange = Omit<Extract<ClientMessage, { kind: 'setSeat' }>, 'kind' | 'player'>;
type BlobUpload = Omit<Extract<ClientMessage, { kind: 'blob' }>, 'kind'>;

export class RelayLobby {
  readonly token: string;
  nick: string;
  welcomed = false;
  rooms: readonly RoomSummary[] = [];
  room: RoomView | null = null;
  protected send: (message: ClientMessage) => void = () => {
    throw new Error(`${this.nick} is not attached to a network`);
  };

  constructor(token: string, nick: string) {
    this.token = token;
    this.nick = nick;
  }

  attach(send: (message: ClientMessage) => void): void {
    this.send = send;
  }

  hello(): void {
    this.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token: this.token, nick: this.nick });
  }

  listRooms(): void {
    this.send({ kind: 'listRooms' });
  }

  createRoom(settings: RoomSettings, seats: readonly RoomSeatSetup[]): void {
    this.send({ kind: 'createRoom', settings, seats });
  }

  joinRoom(roomId: string): void {
    this.send({ kind: 'joinRoom', roomId });
  }

  leaveRoom(): void {
    this.send({ kind: 'leaveRoom' });
  }

  claimSeat(player: number | null): void {
    this.send({ kind: 'claimSeat', player });
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

  kick(player: number): void {
    this.send({ kind: 'kick', player });
  }

  sendBlob(upload: BlobUpload): void {
    this.send({ kind: 'blob', ...upload });
  }
}
