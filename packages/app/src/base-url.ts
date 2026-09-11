const viteBaseUrl = (import.meta as ImportMeta & { readonly env: { readonly BASE_URL: string } }).env
  .BASE_URL;

export function withBaseUrl(path: string, baseUrl: string = viteBaseUrl): string {
  if (!path.startsWith('/')) return path;
  const prefix = baseUrl.replace(/\/$/, '');
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path}`;
}
