import { createWebHost } from './host.js';

const configuredBasePath = process.env.OPEN_NORTHLAND_BASE_PATH ?? '/';
const basePath = configuredBasePath === '/' ? '/' : configuredBasePath.replace(/\/+$/, '');
const server = createWebHost({ root: '/app/public', basePath });

server.listen(5173, '0.0.0.0', () => {
  console.log('[web-host] listening on http://0.0.0.0:5173');
});
