/** Scripted `fetch` doubles for the mod download. */

/** A fetch stub scripted per URL; unlisted URLs fail the test. */
export function fetchStub(routes: Record<string, () => Response>): typeof fetch {
  return (input) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch ${url}`);
    return Promise.resolve(route());
  };
}

export const fileResponse = (bytes: Uint8Array, url: string): Response => {
  const response = new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
    headers: { 'content-type': 'application/zip', 'content-length': String(bytes.length) },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
