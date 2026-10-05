import { USERS } from './users.js';

export function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/users') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(USERS));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
}
