import { resolve } from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数。');
const app = createApp({
  dataDir: resolve(process.env.DATA_DIR || 'data'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  secureCookies: process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE === undefined && process.env.NODE_ENV === 'production'),
});
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`简序 V2 已启动：http://${process.env.HOST || '127.0.0.1'}:${port}`);
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
