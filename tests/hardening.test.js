'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { reliableDownload } = require('../lib/reliable-download');
const { collectPages } = require('../lib/collect-pages');
const cli = require('../douyin-video');

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-hardening-'));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, url: `http://127.0.0.1:${server.address().port}`, file: path.join(dir, 'media.bin') };
}
const fast = { showProgress: false, retryDelayMs: 0 };

test('truncated transfer retries from zero and publishes exact bytes', async t => {
  let requests = 0;
  const content = Buffer.alloc(8192, 42);
  const f = await fixture(t, (req, res) => {
    assert.equal(req.headers.range, undefined);
    res.writeHead(200, { 'Content-Length': content.length });
    if (++requests === 1) { res.write(content.subarray(0, 50)); setTimeout(() => res.destroy(), 5); }
    else res.end(content);
  });
  await reliableDownload(f.url, f.file, fast);
  assert.deepEqual(fs.readFileSync(f.file), content);
  assert.equal(requests, 2);
  assert.deepEqual(fs.readdirSync(f.dir), ['media.bin']);
});

test('exhausted retries preserve old file and remove all partials', async t => {
  let requests = 0;
  const f = await fixture(t, (_, res) => { requests++; res.writeHead(200, { 'Content-Length': 100 }); res.write('bad'); setTimeout(() => res.destroy(), 5); });
  fs.writeFileSync(f.file, 'old');
  await assert.rejects(reliableDownload(f.url, f.file, { ...fast, attempts: 3 }));
  assert.equal(requests, 3);
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(f.dir), ['media.bin']);
});

test('429 and 503 retry with bounded Retry-After and exponential backoff', async t => {
  let requests = 0;
  const waits = [];
  const f = await fixture(t, (_, res) => {
    requests++;
    if (requests === 1) { res.writeHead(429, { 'Retry-After': '1' }); res.end(); }
    else if (requests === 2) { res.writeHead(503); res.end(); }
    else res.end('media');
  });
  await reliableDownload(f.url, f.file, { ...fast, retryDelayMs: 100, maxRetryDelayMs: 500, sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [500, 200]);
  assert.equal(requests, 3);
});

for (const [name, status, type, body] of [['404', 404, 'text/plain', 'missing'], ['HTML challenge', 200, 'text/html', '<html>verify</html>'], ['JSON error', 200, 'application/json', '{}'], ['empty media', 200, 'video/mp4', '']]) {
  test(`rejects ${name} and never publishes a final file`, async t => {
    let requests = 0;
    const f = await fixture(t, (_, res) => { requests++; res.writeHead(status, { 'Content-Type': type }); res.end(body); });
    await assert.rejects(reliableDownload(f.url, f.file, { ...fast, attempts: 2 }));
    if (name !== 'empty media') assert.equal(requests, 1);
    assert.deepEqual(fs.readdirSync(f.dir), []);
  });
}

test('relative redirect and complete chunked media work', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/') { res.writeHead(302, { Location: './media' }); res.end(); }
    else { res.write('one'); res.end('two'); }
  });
  await reliableDownload(f.url, f.file, fast);
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'onetwo');
});

test('stalled body times out with a bounded retry count', async t => {
  let requests = 0;
  const f = await fixture(t, (_, res) => { requests++; res.writeHead(200, { 'Content-Length': 100 }); res.write('x'); });
  await assert.rejects(reliableDownload(f.url, f.file, { ...fast, timeoutMs: 25, attempts: 2 }));
  assert.equal(requests, 2);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

function page(ids, cursor, hasMore = 1) {
  return { payload: { status_code: 0, aweme_list: ids.map(aweme_id => ({ aweme_id })), max_cursor: cursor, has_more: hasMore } };
}
async function pagination(pages, limit = 100) {
  const ids = new Set();
  let i = 0;
  return collectPages({ firstPage: pages[0], nextPage: async () => pages[++i], limit,
    importPage: async p => { for (const item of p.payload.aweme_list) if (!limit || ids.size < limit) ids.add(item.aweme_id); return { imported: p.payload.aweme_list.length }; },
    count: () => ids.size });
}

test('pagination traverses pages with overlapping pinned videos to explicit end', async () => {
  const result = await pagination([page(['1', '2'], 10), page(['1', '3'], 20), page([], 0, 0)]);
  assert.equal(result.pages, 3);
  assert.equal(result.total, 3);
  assert.equal(result.reason, 'end');
});
test('pagination respects cap and supports unlimited mode', async () => {
  assert.equal((await pagination([page(['1'], 10), page(['2'], 20)], 2)).reason, 'limit');
  assert.equal((await pagination([page(['1'], 10), page(['2'], 20, 0)], 0)).total, 2);
});
test('repeated cursor, repeated data, invalid status and missing next page stop clearly', async () => {
  await assert.rejects(pagination([page(['1'], 10), page(['2'], 10)]), /cursor/);
  await assert.rejects(pagination([page(['1'], 10), page(['1'], 20)]), /no new/);
  await assert.rejects(pagination([{ payload: { status_code: 8 } }]), /Invalid post/);
  await assert.rejects(pagination([page(['1'], 10)]), /Timed out/);
});

test('SQLite imports fill remaining slots despite overlaps and update existing rows at cap', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-db-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'test.sqlite');
  const payload = path.join(dir, 'post.json');
  function add(ids, desc = '') {
    fs.writeFileSync(payload, JSON.stringify({ ...page(ids, 0, 0).payload, aweme_list: ids.map(aweme_id => ({ aweme_id, desc, author: { sec_uid: 'test-user', uid: 'u' }, video: {} })) }));
    cli.importPostJsonToDb(db, payload, { limit: 3 });
  }
  add(['1', '2']); add(['1', '2', '3', '4']);
  assert.equal(cli.countVideosForUser(db, 'test-user'), 3);
  add(['1'], 'updated');
  assert.equal(cli.runSqlite(db, "SELECT desc FROM videos WHERE aweme_id='1';").trim(), 'updated');
});

test('quality and cover selections retain existing behavior', () => {
  const variants = cli.collectVideoVariants({ bit_rate: [
    { height: 720, bit_rate: 500000, play_addr: { url_list: ['https://example.test/720'] } },
    { height: 1080, bit_rate: 1000000, play_addr: { url_list: ['https://example.test/1080'] } }
  ] });
  assert.equal(cli.selectVariant(variants, 'best').height, 1080);
  assert.equal(cli.selectVariant(variants, '720p').height, 720);
  assert.equal(cli.selectVariant(variants, 'lowest').height, 720);
  assert.equal(cli.selectVariant(variants, '0').height, 1080);
  const covers = [{ kind: 'cover', width: 400, height: 400 }, { kind: 'origin', width: 800, height: 800 }, { kind: 'dynamic', width: 200, height: 200 }];
  assert.equal(cli.selectCoverVariant(covers, 'medium'), covers[0]);
  assert.equal(cli.selectCoverVariant(covers, 'origin'), covers[1]);
  assert.equal(cli.selectCoverVariant(covers, 'dynamic'), covers[2]);
  assert.equal(cli.selectCoverVariant(covers, 'none'), null);
  assert.equal(cli.parseArgs(['collect-user', 'https://example.test/user', '--limit', '0']).limit, 0);
  assert.equal(cli.extractRequestIndex('0. GET https://example.test/post', '/post'), 0);
});

test('video, cover and direct audio downloads keep metadata paths merged', async t => {
  const f = await fixture(t, (_, res) => res.end('media-data'));
  const info = { video_id: 'id', title: 'test', selected_quality: { label: '1080p', url: f.url + '/video.mp4' },
    selected_cover: { label: 'medium', url: f.url + '/cover.jpg' }, metadata: { music: { play_url: f.url + '/music.mp3' } } };
  const video = await cli.downloadVideo(info, f.dir, { showProgress: false });
  const audio = await cli.downloadAudio(info, f.dir, { showProgress: false });
  const data = JSON.parse(fs.readFileSync(audio.metadataPath));
  assert.equal(data.files.video, video.videoPath);
  assert.equal(data.files.cover, video.coverPath);
  assert.equal(data.files.audio, audio.audioPath);
  assert.equal(data.audio_source, 'direct_music_url');
  const noCover = await cli.downloadVideo({ ...info, video_id: 'no-cover', selected_cover: null }, f.dir, { showProgress: false });
  assert.equal(noCover.coverPath, null);
});

test('collect-user CLI consumes prefetched and scrolled pages, saves exports, downloads nothing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-browser-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wrapper = path.join(dir, 'mock-pwcli');
  const state = path.join(dir, 'state.json');
  fs.writeFileSync(state, JSON.stringify({ navigated: false, scrolled: false }));
  fs.writeFileSync(wrapper, `#!/usr/bin/env node
const fs = require('fs');
const stateFile = process.env.DOUYIN_TEST_STATE;
const state = JSON.parse(fs.readFileSync(stateFile));
const args = process.argv.slice(2); const command = args[1];
const item = id => ({ aweme_id: id, author: { sec_uid: 'test-user', uid: 'u' }, video: {} });
if (command === 'goto') state.navigated = true;
else if (command === 'run-code') {
  if (!args[2].includes('scrollBy')) process.exit(2);
  state.scrolled = true;
} else if (command === 'requests') {
  // Index zero is a stale request from the old page. Two pages arrive before collection.
  const count = state.scrolled ? 4 : state.navigated ? 3 : 1;
  if (args.includes('--clear')) { state.cleared = true; fs.writeFileSync(stateFile, JSON.stringify(state)); console.log(JSON.stringify({ result: '' })); process.exit(0); }
  const lines = [];
  for (let i = state.cleared ? 1 : 0; i < count; i++) lines.push((state.navigated ? i : 900) + '. GET https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=test-user&max_cursor=' + (i <= 1 ? 0 : (i - 1) * 10));
  console.log(JSON.stringify({ result: lines.join('\\n') }));
} else if (command === 'response-body') {
  const index = Number(args[2]);
  const ids = index === 0 ? ['stale'] : index === 1 ? ['1', '2'] : index === 2 ? ['2', '3'] : ['4'];
  console.log(JSON.stringify({ result: JSON.stringify({ status_code: 0, aweme_list: ids.map(item), max_cursor: index * 10, has_more: index < 3 ? 1 : 0 }) }));
} else process.exit(2);
fs.writeFileSync(stateFile, JSON.stringify(state));
`);
  fs.chmodSync(wrapper, 0o755);
  const output = path.join(dir, 'collection');
  const db = path.join(dir, 'collection.sqlite');
  const result = spawnSync(process.execPath, [path.join(__dirname, '../douyin-video.js'), 'collect-user', 'https://www.douyin.com/user/test-user', '--reuse-session', '--db', db, '-o', output], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, PWCLI: wrapper, DOUYIN_TEST_STATE: state }
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(cli.countVideosForUser(db, 'test-user'), 4);
  assert.equal(cli.runSqlite(db, "SELECT count(*) FROM videos WHERE aweme_id='stale';").trim(), '0');
  assert.equal(fs.readdirSync(path.join(output, 'debug')).length, 3);
  assert.ok(fs.existsSync(path.join(output, 'videos.json')));
  assert.ok(fs.existsSync(path.join(output, 'videos.csv')));
  assert.match(result.stdout, /No download was started/);
  assert.equal(cli.runSqlite(db, 'SELECT count(*) FROM video_downloads;').trim(), '0');
});


test('pagination refuses a missing page in the request cursor chain', async () => {
  let reads = 0;
  const first = { ...page(['1'], 10), requestCursor: '0' };
  const later = { ...page(['3'], 30, 0), requestCursor: '20' };
  await assert.rejects(collectPages({ firstPage: first, nextPage: async () => later,
    importPage: async () => { reads++; return { imported: 1 }; }, count: () => reads }), /cursor chain/);
  assert.equal(reads, 1);
});

test('request entries retain cursor and owner while tolerating grouped CLI numbering', () => {
  const entries = cli.postRequestEntries('1:20. [GET] https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=owner&max_cursor=10 => [200]');
  assert.deepEqual(entries, [{ index: 20, cursor: '10', user: 'owner' }]);
});
