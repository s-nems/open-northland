import { MAX_NICK_LENGTH, MAX_RELAY_BUILD_LENGTH, MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH } from '../limits.js';
import { asNonNegativeNumber, asString } from '../untrusted.js';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;
/** Unicode line and paragraph separators are outside the control-character categories. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;

export function parseToken(value: unknown, at: string): string {
  const token = asString(value, at, MAX_TOKEN_LENGTH);
  if (token.length < MIN_TOKEN_LENGTH || !TOKEN_SHAPE.test(token)) {
    throw new Error(`${at}: expected ${MIN_TOKEN_LENGTH} to ${MAX_TOKEN_LENGTH} url-safe characters`);
  }
  return token;
}

export function parseNick(value: unknown, at: string): string {
  return parseLine(value, at, MAX_NICK_LENGTH);
}

export function parseRelayBuild(value: unknown, at: string): string {
  return parseLine(value, at, MAX_RELAY_BUILD_LENGTH);
}

/** One printable line, trimmed and non-empty. */
export function parseLine(value: unknown, at: string, maxLength: number): string {
  const line = asString(value, at, maxLength).trim();
  if (line.length === 0) throw new Error(`${at}: empty`);
  if (!PRINTABLE.test(line)) throw new Error(`${at}: expected one printable line without control characters`);
  return line;
}

export function asTimestamp(value: unknown, at: string): number {
  return asNonNegativeNumber(value, at);
}

export function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
