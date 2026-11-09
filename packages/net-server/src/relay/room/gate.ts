import { createHash, timingSafeEqual } from 'node:crypto';

/** Who may come into a room: its password, kept only as a digest, and the tokens and peer addresses
 *  its creator banned, kept for the room's life. An address ban turns away newcomers from there, not
 *  the members it found inside, such as a creator behind the banned player's router. */
export class RoomGate {
  private readonly digest: Buffer | null;
  private readonly bannedTokens = new Set<string>();
  private readonly bannedAddresses = new Set<string>();
  private readonly spared = new Set<string>();

  constructor(password: string | undefined) {
    this.digest = password === undefined ? null : digestOf(password);
  }

  get locked(): boolean {
    return this.digest !== null;
  }

  /** Whether `password` opens the room; an unlocked room ignores it. */
  opens(password: string | undefined): boolean {
    if (this.digest === null) return true;
    return password !== undefined && timingSafeEqual(digestOf(password), this.digest);
  }

  bars(token: string, address: string | undefined): boolean {
    if (this.bannedTokens.has(token)) return true;
    return address !== undefined && this.bannedAddresses.has(address) && !this.spared.has(token);
  }

  /** Bars `token` and `address`; the tokens `inside` keep their way back through that address. */
  ban(token: string, address: string | undefined, inside: Iterable<string>): void {
    this.bannedTokens.add(token);
    if (address === undefined) return;
    this.bannedAddresses.add(address);
    for (const kept of inside) this.spared.add(kept);
  }
}

function digestOf(password: string): Buffer {
  return createHash('sha256').update(password).digest();
}
