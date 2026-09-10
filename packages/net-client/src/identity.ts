/** Random bytes in a token: 24 bytes is 32 URL-safe characters, inside the protocol's bounds. */
const TOKEN_BYTES = 24;

/** A fresh identity token: the secret a client stores and introduces itself with from then on. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
