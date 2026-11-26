/**
 * What a report must not carry: the player's account name in file paths, the query values that act
 * as keys (a relay room to join, a token), and the nicks of the player and of everyone in their room.
 * The report keeps a parameter and says it was removed, so a reader still sees how the page was opened.
 */
import { REPORT_LIMITS } from '@open-northland/data';

export const REDACTED = '[redacted]';

/** A parameter whose name says it holds a credential. */
const SECRET_PARAM_NAME = /token|secret|key|pass|auth|invite|sig|session|cred/i;
/** The player's own name on a relay. */
const PERSONAL_PARAMS: ReadonlySet<string> = new Set(['nick']);
/** A relay room id is the key that joins it; only the value that creates a room says nothing. */
const ROOM_PARAM = 'room';
const NEW_ROOM = 'new';
const URL_PROTOCOLS: readonly string[] = ['http:', 'https:', 'ws:', 'wss:'];
/** Shorter key values are too common to scrub from free text as substrings; a nick, scrubbed as a
 *  whole word, has no such floor. */
const MIN_SCRUBBED_LENGTH = 4;

const POSIX_HOME = /(\/(?:Users|home)\/)[^/\s"'\\:]+/g;
const WINDOWS_HOME = /([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s"':]+/gi;
const HOME_MARK = '~';

/** A `key=value` pair of a query or fragment inside free text, such as a logged page address. */
const QUERY_PAIR = /([?&#;])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g;
/** The `user:password@` part of an address. */
const USER_INFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@"'<>]+@/gi;

function secretParam(key: string, value: string): boolean {
  return (
    SECRET_PARAM_NAME.test(key) || PERSONAL_PARAMS.has(key) || (key === ROOM_PARAM && value !== NEW_ROOM)
  );
}

/** `/Users/<name>/`, `/home/<name>/` and `C:\Users\<name>\` with the account name taken out. */
export function redactHomePaths(text: string): string {
  return text.replace(POSIX_HOME, `$1${HOME_MARK}`).replace(WINDOWS_HOME, `$1${HOME_MARK}`);
}

/** An absolute web or socket address without its user, query and fragment; null for anything else. */
export function addressWithoutSecrets(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!URL_PROTOCOLS.includes(url.protocol)) return null;
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export interface RedactedRoute {
  readonly params: Record<string, string>;
  /** The removed values in the spellings a log line may quote them in, longest first. */
  readonly secrets: readonly string[];
  /** Removed nicks, which free text loses only as whole words. */
  readonly names: readonly string[];
}

/** What `scrubText` takes out besides home paths and secret query pairs. */
export interface ReportSecrets {
  /** Taken out wherever they occur. */
  readonly values: readonly string[];
  /** Nicks, taken out where one stands as a whole word, so `Ola` leaves `Olaf` and `violation` be. */
  readonly names: RegExp | null;
}

export const NO_SECRETS: ReportSecrets = { values: [], names: null };

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
/** Neither side of a scrubbed nick may continue a word. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

export function reportSecrets(values: readonly string[], names: readonly string[]): ReportSecrets {
  // Names reach here from a settings handover as well as the route; a handover that missed its nick
  // must not crash the whole report, so anything that is not a text never becomes a scrub target.
  const words = [
    ...new Set(names.filter((name): name is string => typeof name === 'string' && name !== '')),
  ].sort((a, b) => b.length - a.length);
  return {
    values: [...new Set(values)].sort((a, b) => b.length - a.length),
    names:
      words.length === 0
        ? null
        : new RegExp(
            `(?<!${WORD_CHAR})(?:${words.map((word) => word.replace(REGEX_SPECIAL, '\\$&')).join('|')})(?!${WORD_CHAR})`,
            'gu',
          ),
  };
}

/** A URL value of a parameter loses only what can carry a credential, and only when it has one. */
function withoutCredentials(value: string): string | null {
  const address = addressWithoutSecrets(value);
  if (address === null) return null;
  const url = new URL(value);
  return url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' ? address : null;
}

function spellings(key: string, value: string): string[] {
  const form = new URLSearchParams({ [key]: value }).toString().slice(key.length + 1);
  return [value, encodeURIComponent(value), form];
}

/** The query as a report may show it. */
export function redactRouteParams(params: URLSearchParams): RedactedRoute {
  const shown: Record<string, string> = {};
  const secrets = new Set<string>();
  const names = new Set<string>();
  for (const [key, value] of [...params].slice(0, REPORT_LIMITS.routeParams)) {
    let kept = value;
    if (secretParam(key, value)) kept = value === '' ? '' : REDACTED;
    else kept = withoutCredentials(value) ?? value;
    if (kept !== value) {
      for (const spelling of spellings(key, value)) {
        if (PERSONAL_PARAMS.has(key)) names.add(spelling);
        else if (spelling.length >= MIN_SCRUBBED_LENGTH && !kept.includes(spelling)) secrets.add(spelling);
      }
    }
    shown[key.slice(0, REPORT_LIMITS.label)] = kept.slice(0, REPORT_LIMITS.text);
  }
  return {
    params: shown,
    secrets: [...secrets].sort((a, b) => b.length - a.length),
    names: [...names],
  };
}

/**
 * Free text with home paths, credentials in addresses, secret query values (whatever page the
 * document showed when the text was logged) and the given secret values taken out.
 */
export function scrubText(text: string, secrets: ReportSecrets): string {
  let scrubbed = redactHomePaths(text)
    .replace(USER_INFO, '$1')
    .replace(QUERY_PAIR, (pair, mark: string, key: string, value: string) =>
      value !== '' && secretParam(key, value) ? `${mark}${key}=${REDACTED}` : pair,
    );
  for (const secret of secrets.values) scrubbed = scrubbed.replaceAll(secret, REDACTED);
  return secrets.names === null ? scrubbed : scrubbed.replace(secrets.names, REDACTED);
}

/** `value` with every string in it scrubbed; non-JSON values are the caller's to have removed. */
export function scrubJson(value: unknown, secrets: ReportSecrets): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => scrubJson(item, secrets));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = scrubJson(item, secrets);
    return out;
  }
  return value;
}
