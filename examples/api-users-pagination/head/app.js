import { USERS } from './users.js';

const PAGE_SIZE = Number(process.env.USERS_PAGE_SIZE ?? 2);

/** Returns one page of users starting after `cursor` (a user id). */
function pageOfUsers(cursor, limit) {
  const start = cursor ? USERS.findIndex((u) => u.id === cursor) + 1 : 0;
  const items = USERS.slice(start, start + limit);
  const last = items.at(-1);
  const hasMore = start + limit < USERS.length;
  return { items, nextCursor: hasMore && last ? last.id : null };
}

export function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/users') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? PAGE_SIZE), 50);
    const cursor = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : undefined;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(pageOfUsers(cursor, limit)));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
}
