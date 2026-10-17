'use strict';

// Browser transport is injected so pagination boundaries can be tested offline.
async function collectPages({ firstPage, nextPage, importPage, count, limit = 100, maxPages = 1000 }) {
  let page = firstPage;
  let pages = 0;
  let imported = 0;
  const cursors = new Set();
  const ids = new Set();
  let expectedCursor = '0';
  while (page) {
    if (page.requestCursor !== undefined && String(page.requestCursor) !== expectedCursor) throw new Error('Pagination request cursor chain is broken; collection stopped.');
    const payload = page.payload;
    if (payload?.status_code !== 0 || !Array.isArray(payload.aweme_list)) throw new Error('Invalid post response; collection stopped. Check login or verification in the browser.');
    const result = await importPage(page);
    pages++;
    imported += result.imported;
    const total = await count();
    if (limit > 0 && total >= limit) return { pages, imported, total, reason: 'limit' };
    if (payload.has_more === false || payload.has_more === 0 || payload.has_more === '0') return { pages, imported, total, reason: 'end' };
    if (![true, 1, '1'].includes(payload.has_more)) throw new Error('Missing or invalid has_more; collection stopped.');
    const cursor = String(payload.max_cursor ?? '');
    const newIds = payload.aweme_list.map(item => String(item.aweme_id || '')).filter(id => id && !ids.has(id));
    if (!cursor || cursor === '0' || cursors.has(cursor)) throw new Error('Pagination cursor did not advance; collected pages are saved.');
    if (!newIds.length) throw new Error('Pagination returned no new videos; collected pages are saved.');
    expectedCursor = cursor;
    cursors.add(cursor);
    for (const id of newIds) ids.add(id);
    if (pages >= maxPages) throw new Error('Pagination safety limit reached; collected pages are saved.');
    page = await nextPage(page);
    if (!page) throw new Error('Timed out waiting for the next post page; collected pages are saved.');
  }
  throw new Error('No post response available');
}

module.exports = { collectPages };
