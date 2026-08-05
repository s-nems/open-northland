const viteBaseUrl = (import.meta as ImportMeta & { readonly env: { readonly BASE_URL: string } }).env
  .BASE_URL;

export function withBaseUrl(path: string, baseUrl: string = viteBaseUrl): string {
  if (!path.startsWith('/')) return path;
  return baseUrl === '/' ? path : `${baseUrl.replace(/\/$/, '')}${path}`;
}
