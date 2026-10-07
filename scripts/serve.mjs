// Tiny static server for previewing dist/ locally: node scripts/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url);
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (path === '' || path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(new URL(path, DIST));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(new URL('404.html', DIST)).catch(() => 'Not found'));
  }
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}/`));
