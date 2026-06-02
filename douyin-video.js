#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const readline = require('readline');
const { URL } = require('url');

const DEFAULT_BROWSER_PROFILE = path.join(process.env.HOME || '.', '.agents', 'douyin-video-downloader', 'browser-profile');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://www.douyin.com/'
};

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: options.method || 'GET',
      headers: { ...HEADERS, ...options.headers }
    }, (res) => {
      if (options.stream) {
        resolve(res);
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(options.timeout || 30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function followRedirect(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(url, { method: 'GET', headers: HEADERS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location;
        resolve(location.startsWith('http') ? location : `${parsedUrl.protocol}//${parsedUrl.host}${location}`);
      } else {
        resolve(url);
      }
      res.resume();
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Redirect timeout'));
    });
    req.end();
  });
}

async function downloadFile(url, filepath, showProgress = true) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsedUrl.protocol}//${parsedUrl.host}${res.headers.location}`;
        downloadFile(nextUrl, filepath, showProgress).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const totalSize = Number.parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastProgressBucket = -1;
      const writer = fs.createWriteStream(filepath);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (showProgress && totalSize > 0) {
          const progress = downloaded / totalSize * 100;
          const bucket = Math.min(100, Math.floor(progress / 5) * 5);
          if (bucket !== lastProgressBucket) {
            lastProgressBucket = bucket;
            process.stdout.write(`\rDownload progress: ${bucket}%`);
          }
        }
      });

      res.pipe(writer);
      writer.on('finish', () => {
        if (showProgress) console.log(`\nSaved: ${filepath}`);
        resolve(filepath);
      });
      writer.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

function readExistingMetadata(metadataPath) {
  if (!fs.existsSync(metadataPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeMergedMetadata(metadataPath, nextMetadata) {
  const existing = readExistingMetadata(metadataPath);
  const merged = {
    ...existing,
    ...nextMetadata,
    files: {
      ...(existing.files || {}),
      ...(nextMetadata.files || {})
    }
  };
  fs.writeFileSync(metadataPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function sanitizeName(value) {
  return String(value || 'douyin_video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function firstUrl(item) {
  if (!item) return null;
  if (typeof item === 'string') return item;
  if (Array.isArray(item.url_list)) return item.url_list[0] || null;
  if (typeof item.url === 'string') return item.url;
  return null;
}

function allUrls(item) {
  if (!item) return [];
  if (typeof item === 'string') return [item];
  if (Array.isArray(item.url_list)) return item.url_list.filter(Boolean);
  if (typeof item.url === 'string') return [item.url];
  return [];
}

function collectCoverVariants(video) {
  const candidates = [
    ['cover', video?.cover],
    ['raw', video?.raw_cover],
    ['origin', video?.origin_cover],
    ['dynamic', video?.dynamic_cover],
    ['animated', video?.animated_cover],
    ['gaussian', video?.gaussian_cover]
  ];
  const variants = [];
  const seen = new Set();
  const kindCounts = {};

  for (const [kind, source] of candidates) {
    for (const url of allUrls(source)) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
      const tplMatch = String(url).match(/tplv-[^~?]+/);
      const template = tplMatch ? tplMatch[0] : null;
      const width = source?.width ?? null;
      const height = source?.height ?? null;
      const sizeLabel = width && height ? `${width}x${height}` : 'unknown';
      const suffix = kindCounts[kind] > 1 ? `-${kindCounts[kind]}` : '';
      variants.push({
        index: variants.length,
        kind,
        label: `${kind}${suffix}`,
        url,
        width,
        height,
        size_label: sizeLabel,
        template
      });
    }
  }

  return variants;
}

function selectCoverVariant(variants, wanted = 'medium') {
  if (!variants.length) return null;
  const normalized = String(wanted || 'medium').toLowerCase();
  if (/^\d+$/.test(normalized) && variants[Number(normalized)]) {
    return variants[Number(normalized)];
  }
  if (normalized === 'none' || normalized === 'skip') return null;
  if (normalized === 'best' || normalized === 'large') {
    return [...variants].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
  }
  if (normalized === 'origin') {
    return variants.find(item => item.kind === 'origin') || variants[0];
  }
  if (normalized === 'raw') {
    return variants.find(item => item.kind === 'raw') || variants[0];
  }
  if (normalized === 'gaussian' || normalized === 'blur') {
    return variants.find(item => item.kind === 'gaussian') || variants[0];
  }
  if (normalized === 'dynamic' || normalized === 'animated') {
    return variants.find(item => item.kind === normalized || item.kind === 'dynamic') || variants[0];
  }
  if (normalized === 'thumb' || normalized === 'small') {
    return [...variants].sort((a, b) => (a.width || Infinity) * (a.height || Infinity) - (b.width || Infinity) * (b.height || Infinity))[0] || variants[0];
  }
  return variants.find(item => item.kind === 'cover')
    || variants[Math.floor((variants.length - 1) / 2)]
    || variants[0];
}

function compactUser(user) {
  if (!user) return null;
  return {
    uid: user.uid || null,
    sec_uid: user.sec_uid || null,
    short_id: user.short_id || null,
    unique_id: user.unique_id || null,
    nickname: user.nickname || null,
    signature: user.signature || null,
    avatar: firstUrl(user.avatar_thumb || user.avatar_medium || user.avatar_larger),
    follower_count: user.follower_count ?? null,
    following_count: user.following_count ?? null,
    total_favorited: user.total_favorited ?? null,
    aweme_count: user.aweme_count ?? null
  };
}

function compactMusic(music) {
  if (!music) return null;
  return {
    id: music.mid || music.id_str || (music.id ? String(music.id) : null),
    mid: music.mid || null,
    title: music.title || null,
    author: music.author || null,
    duration: music.duration ?? null,
    status: music.status ?? null,
    cover: firstUrl(music.cover_hd || music.cover_large || music.cover_medium || music.cover_thumb),
    play_url: firstUrl(music.play_url),
    schema_url: music.schema_url || null
  };
}

function sqliteValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqlite(dbPath, sql) {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const result = spawnSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'sqlite3 failed').trim());
  }
  return result.stdout;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
    ...options
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout;
}

function runPwcli(args, options = {}) {
  const pwcli = options.pwcli || resolvePwcliPath();
  if (!fs.existsSync(pwcli)) {
    throw new Error([
      'Playwright CLI wrapper not found.',
      'Set PWCLI to the wrapper path, or install the playwright skill under ~/.agents/skills or ~/.codex/skills.',
      'Expected wrapper: playwright/scripts/playwright_cli.sh'
    ].join('\n'));
  }
  return runCommand(pwcli, args, options);
}

function normalizeSessionName(value) {
  return String(value || 'dyvdl').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24) || 'dyvdl';
}

function resolvePwcliPath() {
  const home = process.env.HOME || '.';
  const candidates = [
    process.env.PWCLI,
    path.join(home, '.agents', 'skills', 'playwright', 'scripts', 'playwright_cli.sh'),
    path.join(home, '.codex', 'skills', 'playwright', 'scripts', 'playwright_cli.sh')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function initCollectionDb(dbPath) {
  const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
  sec_user_id TEXT PRIMARY KEY,
  uid TEXT,
  unique_id TEXT,
  nickname TEXT,
  signature TEXT,
  avatar_url TEXT,
  following_count INTEGER,
  follower_count INTEGER,
  total_favorited INTEGER,
  aweme_count INTEGER,
  raw_json TEXT,
  collected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crawl_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sec_user_id TEXT NOT NULL,
  source_file TEXT NOT NULL UNIQUE,
  status_code INTEGER,
  min_cursor INTEGER,
  max_cursor INTEGER,
  has_more INTEGER,
  item_count INTEGER,
  collected_at TEXT NOT NULL,
  raw_json TEXT,
  FOREIGN KEY(sec_user_id) REFERENCES users(sec_user_id)
);
CREATE TABLE IF NOT EXISTS videos (
  aweme_id TEXT PRIMARY KEY,
  sec_user_id TEXT NOT NULL,
  video_id TEXT,
  url TEXT NOT NULL,
  desc TEXT,
  title TEXT,
  create_time INTEGER,
  create_time_iso TEXT,
  duration_ms INTEGER,
  cover_url TEXT,
  aweme_type INTEGER,
  media_type INTEGER,
  is_top INTEGER,
  raw_json TEXT,
  collected_at TEXT NOT NULL,
  FOREIGN KEY(sec_user_id) REFERENCES users(sec_user_id)
);
CREATE TABLE IF NOT EXISTS video_stats (
  aweme_id TEXT PRIMARY KEY,
  digg_count INTEGER,
  comment_count INTEGER,
  collect_count INTEGER,
  share_count INTEGER,
  play_count INTEGER,
  download_count INTEGER,
  forward_count INTEGER,
  collected_at TEXT NOT NULL,
  FOREIGN KEY(aweme_id) REFERENCES videos(aweme_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS music (
  music_id TEXT PRIMARY KEY,
  aweme_id TEXT NOT NULL,
  mid TEXT,
  title TEXT,
  author TEXT,
  duration INTEGER,
  status INTEGER,
  play_url TEXT,
  cover_url TEXT,
  raw_json TEXT,
  collected_at TEXT NOT NULL,
  FOREIGN KEY(aweme_id) REFERENCES videos(aweme_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS video_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aweme_id TEXT NOT NULL,
  quality TEXT NOT NULL,
  status TEXT NOT NULL,
  video_path TEXT,
  metadata_path TEXT,
  error_message TEXT,
  downloaded_at TEXT NOT NULL,
  UNIQUE(aweme_id, quality),
  FOREIGN KEY(aweme_id) REFERENCES videos(aweme_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS media_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aweme_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  status TEXT NOT NULL,
  file_path TEXT,
  metadata_path TEXT,
  error_message TEXT,
  downloaded_at TEXT NOT NULL,
  UNIQUE(aweme_id, media_type),
  FOREIGN KEY(aweme_id) REFERENCES videos(aweme_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_videos_sec_user_id ON videos(sec_user_id);
CREATE INDEX IF NOT EXISTS idx_videos_create_time ON videos(create_time);
CREATE INDEX IF NOT EXISTS idx_pages_sec_user_id_cursor ON crawl_pages(sec_user_id, max_cursor);
CREATE INDEX IF NOT EXISTS idx_video_downloads_status ON video_downloads(status, quality);
CREATE INDEX IF NOT EXISTS idx_media_downloads_status ON media_downloads(status, media_type);
`;
  runSqlite(dbPath, schema);
}

function compactVideoForDb(item, fallbackSecUserId) {
  const author = compactUser(item.author) || {};
  const video = item.video || {};
  const stats = item.statistics || {};
  const music = compactMusic(item.music) || {};
  const secUserId = author.sec_uid || item.sec_user_id || fallbackSecUserId;
  const awemeId = item.aweme_id || item.aweme_id_str || item.group_id || item.id;
  if (!awemeId || !secUserId) return null;

  const createTime = item.create_time ?? null;
  const createIso = createTime ? new Date(Number(createTime) * 1000).toISOString() : null;
  return {
    user: {
      sec_user_id: secUserId,
      uid: author.uid,
      unique_id: author.unique_id,
      nickname: author.nickname,
      signature: author.signature,
      avatar_url: author.avatar,
      following_count: author.following_count,
      follower_count: author.follower_count,
      total_favorited: author.total_favorited,
      aweme_count: author.aweme_count,
      raw_json: item.author || null
    },
    video: {
      aweme_id: String(awemeId),
      sec_user_id: secUserId,
      video_id: video.id || String(awemeId),
      url: `https://www.douyin.com/video/${awemeId}`,
      desc: item.desc || null,
      title: item.desc || null,
      create_time: createTime,
      create_time_iso: createIso,
      duration_ms: video.duration ?? null,
      cover_url: firstUrl(video.cover || video.origin_cover || video.dynamic_cover),
      aweme_type: item.aweme_type ?? null,
      media_type: item.media_type ?? null,
      is_top: item.is_top ?? null,
      raw_json: item
    },
    stats: {
      aweme_id: String(awemeId),
      digg_count: stats.digg_count ?? stats.like_count ?? null,
      comment_count: stats.comment_count ?? null,
      collect_count: stats.collect_count ?? null,
      share_count: stats.share_count ?? null,
      play_count: stats.play_count ?? null,
      download_count: stats.download_count ?? null,
      forward_count: stats.forward_count ?? null
    },
    music: {
      music_id: music.id,
      aweme_id: String(awemeId),
      mid: music.mid,
      title: music.title,
      author: music.author,
      duration: music.duration,
      status: music.status,
      play_url: music.play_url,
      cover_url: music.cover,
      raw_json: item.music || null
    }
  };
}

function sqlInsertOrReplace(table, values) {
  const keys = Object.keys(values);
  return `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(key => sqliteValue(values[key])).join(', ')});`;
}

function countVideosForUser(dbPath, secUserId) {
  if (!secUserId || secUserId === 'unknown') return 0;
  const output = runSqlite(dbPath, `SELECT COUNT(*) FROM videos WHERE sec_user_id = ${sqliteValue(secUserId)};\n`);
  return Number.parseInt(output.trim() || '0', 10) || 0;
}

function importPostJsonToDb(dbPath, jsonPath, options = {}) {
  initCollectionDb(dbPath);
  const sourceFile = path.resolve(jsonPath);
  const payload = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const items = payload.aweme_list || payload.aweme_detail?.aweme_list || payload.item_list || [];
  const collectedAt = new Date().toISOString();
  const allRows = items.map(item => compactVideoForDb(item, options.secUserId)).filter(Boolean);
  const secUserId = allRows[0]?.video.sec_user_id || options.secUserId || 'unknown';
  const collectionLimit = Math.max(0, Number(options.limit ?? 100) || 0);
  const existingCount = countVideosForUser(dbPath, secUserId);
  const remainingSlots = collectionLimit > 0 ? Math.max(0, collectionLimit - existingCount) : allRows.length;
  const rows = allRows.slice(0, remainingSlots);

  const statements = ['BEGIN TRANSACTION;'];
  for (const row of rows) {
    statements.push(sqlInsertOrReplace('users', {
      ...row.user,
      raw_json: JSON.stringify(row.user.raw_json),
      collected_at: collectedAt
    }));
    statements.push(sqlInsertOrReplace('videos', {
      ...row.video,
      raw_json: JSON.stringify(row.video.raw_json),
      collected_at: collectedAt
    }));
    statements.push(sqlInsertOrReplace('video_stats', {
      ...row.stats,
      collected_at: collectedAt
    }));
    if (row.music.music_id) {
      statements.push(sqlInsertOrReplace('music', {
        ...row.music,
        raw_json: JSON.stringify(row.music.raw_json),
        collected_at: collectedAt
      }));
    }
  }
  statements.push(sqlInsertOrReplace('crawl_pages', {
    sec_user_id: secUserId,
    source_file: sourceFile,
    status_code: payload.status_code ?? null,
    min_cursor: payload.min_cursor ?? null,
    max_cursor: payload.max_cursor ?? null,
    has_more: payload.has_more ?? null,
    item_count: items.length,
    collected_at: collectedAt,
    raw_json: JSON.stringify(payload)
  }));
  statements.push('COMMIT;');
  runSqlite(dbPath, statements.join('\n'));
  return {
    imported: rows.length,
    skippedByLimit: Math.max(0, allRows.length - rows.length),
    existingBefore: existingCount,
    limit: collectionLimit,
    sourceFile,
    dbPath
  };
}

function extractRequestIndex(lines, pattern) {
  const matches = String(lines || '').split('\n').filter(line => line.includes(pattern));
  if (!matches.length) return null;
  const latest = matches[matches.length - 1];
  const match = latest.match(/^\s*(\d+):(\d+)\./) || latest.match(/^\s*(\d+)\./);
  return match ? Number(match[2] || match[1]) : null;
}

function responseLooksUsable(jsonPath) {
  if (!fs.existsSync(jsonPath) || fs.statSync(jsonPath).size <= 1) return false;
  try {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return payload.status_code === 0 && Array.isArray(payload.aweme_list);
  } catch {
    return false;
  }
}

function hasValidLoginCookies(session) {
  try {
    const cookies = runPwcli(['-s=' + session, 'cookie-list']);
    return /(^|\n)\d+:sessionid=/.test(cookies) || /(^|\n)\d+:sid_guard=/.test(cookies);
  } catch {
    return false;
  }
}

function ensureNpxAvailable() {
  const result = spawnSync('zsh', ['-lc', 'command -v npx >/dev/null 2>&1'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error([
      'Browser collection requires npx and Playwright CLI.',
      'Install Node.js/npm first, then verify with:',
      '  node --version',
      '  npm --version'
    ].join('\n'));
  }
}

function openCollectBrowser(session, userUrl, options = {}) {
  ensureNpxAvailable();
  fs.mkdirSync(options.profileDir || DEFAULT_BROWSER_PROFILE, { recursive: true });
  const profileDir = options.profileDir || DEFAULT_BROWSER_PROFILE;
  const opened = runPwcli(['-s=' + session, 'open', userUrl, '--headed', '--persistent', '--profile', profileDir], options);
  return opened;
}

function captureLatestPostResponse(session, outputDir, label = 'post') {
  const requests = runPwcli(['-s=' + session, 'requests']);
  const index = extractRequestIndex(requests, '/aweme/v1/web/aweme/post/');
  if (!index) return null;
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${label}_${index}.json`);
  const body = runPwcli(['-s=' + session, 'response-body', String(index)]);
  fs.writeFileSync(jsonPath, body, 'utf8');
  return { index, jsonPath, usable: responseLooksUsable(jsonPath) };
}

async function waitForLoginAndPost(session, outputDir, options = {}) {
  const timeoutMs = Number(options.loginTimeoutSeconds || 180) * 1000;
  const intervalMs = 5000;
  const started = Date.now();
  console.log('Current Douyin login state is not usable. Please scan the QR code or finish login in the opened browser.');

  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    if (hasValidLoginCookies(session)) {
      runPwcli(['-s=' + session, 'reload']);
      await sleep(3000);
      const captured = captureLatestPostResponse(session, outputDir, 'post');
      if (captured?.usable) return captured;
    }
  }

  throw new Error('Timed out waiting for Douyin login. Please rerun collect-user after logging in.');
}

async function collectUser(args) {
  const userUrl = args.shareLink;
  const outputDir = args.outputDir || './output';
  const debugDir = path.join(outputDir, 'debug');
  const session = normalizeSessionName(args.browserSession || 'dyvdl');
  const profileDir = args.profileDir || DEFAULT_BROWSER_PROFILE;

  if (args.reuseSession) {
    runPwcli(['-s=' + session, 'goto', userUrl]);
  } else {
    openCollectBrowser(session, userUrl, { profileDir });
  }
  await sleep(5000);

  let captured = captureLatestPostResponse(session, debugDir, 'post');
  if (!captured?.usable) {
    captured = await waitForLoginAndPost(session, debugDir, {
      loginTimeoutSeconds: args.loginTimeoutSeconds
    });
  }

  const result = importPostJsonToDb(args.dbPath, captured.jsonPath, {
    secUserId: args.secUserId,
    limit: args.limit
  });

  const exportJson = path.join(outputDir, 'videos.json');
  const exportCsv = path.join(outputDir, 'videos.csv');
  exportCollectionDb(args.dbPath, exportJson, 'json');
  exportCollectionDb(args.dbPath, exportCsv, 'csv');

  console.log(`Collected user videos from: ${userUrl}`);
  console.log(`Imported videos: ${result.imported}`);
  console.log(`Skipped by limit: ${result.skippedByLimit}`);
  console.log(`Source JSON: ${captured.jsonPath}`);
  console.log(`Collection DB: ${path.resolve(args.dbPath)}`);
  console.log(`Export JSON: ${exportJson}`);
  console.log(`Export CSV: ${exportCsv}`);
  console.log('Collection completed. No download was started. Confirm with the user before running db-download-batch.');
  return result;
}

function exportCollectionDb(dbPath, outputPath, format = 'json') {
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  const query = `
SELECT json_object(
  'aweme_id', videos.aweme_id,
  'url', videos.url,
  'title', videos.title,
  'desc', videos.desc,
  'create_time', videos.create_time,
  'create_time_iso', videos.create_time_iso,
  'duration_ms', videos.duration_ms,
  'cover_url', videos.cover_url,
  'digg_count', video_stats.digg_count,
  'comment_count', video_stats.comment_count,
  'collect_count', video_stats.collect_count,
  'share_count', video_stats.share_count,
  'play_count', video_stats.play_count,
  'download_count', video_stats.download_count,
  'forward_count', video_stats.forward_count,
  'music_id', music.music_id,
  'music_title', music.title,
  'music_author', music.author,
  'music_duration', music.duration,
  'music_play_url', music.play_url,
  'author_unique_id', users.unique_id,
  'author_nickname', users.nickname
) FROM videos
LEFT JOIN video_stats USING(aweme_id)
LEFT JOIN music USING(aweme_id)
LEFT JOIN users ON users.sec_user_id = videos.sec_user_id
ORDER BY videos.create_time DESC;
`;
  if (format === 'csv') {
    const outputForSqlite = resolvedOutput.replace(/"/g, '""');
    const csv = runSqlite(dbPath, `.headers on\n.mode csv\n.output "${outputForSqlite}"\nSELECT videos.aweme_id, videos.url, videos.title, videos.create_time_iso, videos.duration_ms, videos.cover_url, video_stats.digg_count, video_stats.comment_count, video_stats.collect_count, video_stats.share_count, video_stats.play_count, music.music_id, music.title AS music_title, music.play_url AS music_play_url, users.unique_id AS author_unique_id, users.nickname AS author_nickname FROM videos LEFT JOIN video_stats USING(aweme_id) LEFT JOIN music USING(aweme_id) LEFT JOIN users ON users.sec_user_id = videos.sec_user_id ORDER BY videos.create_time DESC;\n`);
    return { outputPath: resolvedOutput, bytes: fs.statSync(resolvedOutput).size, sqliteOutput: csv };
  }

  const lines = runSqlite(dbPath, `.headers off\n.mode list\n${query}`).split('\n').map(line => line.trim()).filter(Boolean);
  const data = lines.map(line => JSON.parse(line));
  fs.writeFileSync(resolvedOutput, JSON.stringify(data, null, 2), 'utf8');
  return { outputPath: resolvedOutput, count: data.length };
}

function listPendingVideos(dbPath, limit = 100, quality = 'best') {
  const sql = `.mode tabs
SELECT videos.aweme_id, videos.url, COALESCE(videos.title, videos.aweme_id)
FROM videos
LEFT JOIN video_downloads
  ON video_downloads.aweme_id = videos.aweme_id
  AND video_downloads.quality = ${sqliteValue(quality)}
  AND video_downloads.status = 'success'
WHERE video_downloads.aweme_id IS NULL
ORDER BY videos.create_time DESC
LIMIT ${Number(limit) || 100};
`;
  return runSqlite(dbPath, sql).split('\n').filter(Boolean).map(line => {
    const [aweme_id, url, title] = line.split('\t');
    return { aweme_id, url, title };
  });
}

function loadVideoInfoFromDb(dbPath, awemeId, quality = 'best', coverSize = 'medium') {
  const output = runSqlite(dbPath, `.headers off\n.mode json\nSELECT raw_json, url FROM videos WHERE aweme_id = ${sqliteValue(awemeId)} LIMIT 1;\n`);
  const rows = JSON.parse(output || '[]');
  if (!rows.length || !rows[0].raw_json) return null;

  const videoData = JSON.parse(rows[0].raw_json);
  if (!videoData?.video) return null;

  const variants = collectVideoVariants(videoData.video);
  const selected = selectVariant(variants, quality);
  const coverVariants = collectCoverVariants(videoData.video);
  const selectedCover = selectCoverVariant(coverVariants, coverSize);
  const shareUrl = rows[0].url || `https://www.douyin.com/video/${awemeId}`;
  const title = sanitizeName(videoData.desc || `douyin_${videoData.aweme_id || awemeId}`);

  return {
    video_id: videoData.video?.id || videoData.aweme_id || awemeId,
    aweme_id: videoData.aweme_id || awemeId,
    title,
    metadata: buildMetadata(videoData, shareUrl, variants, selected, coverVariants, selectedCover, coverSize),
    share_url: shareUrl,
    selected_quality: selected,
    selected_cover: selectedCover,
    cover_variants: coverVariants,
    variants
  };
}

function markVideoDownload(dbPath, awemeId, quality, status, result = {}) {
  const now = new Date().toISOString();
  runSqlite(dbPath, sqlInsertOrReplace('video_downloads', {
    aweme_id: awemeId,
    quality,
    status,
    video_path: result.videoPath || null,
    metadata_path: result.metadataPath || null,
    error_message: result.errorMessage || null,
    downloaded_at: now
  }));
}

function listPendingAudio(dbPath, limit = 100) {
  const sql = `.mode tabs
SELECT videos.aweme_id, videos.url, COALESCE(videos.title, videos.aweme_id), music.play_url
FROM videos
LEFT JOIN music USING(aweme_id)
LEFT JOIN media_downloads
  ON media_downloads.aweme_id = videos.aweme_id
  AND media_downloads.media_type = 'audio'
  AND media_downloads.status = 'success'
WHERE media_downloads.aweme_id IS NULL
  AND music.play_url IS NOT NULL
ORDER BY videos.create_time DESC
LIMIT ${Number(limit) || 100};
`;
  return runSqlite(dbPath, sql).split('\n').filter(Boolean).map(line => {
    const [aweme_id, url, title, play_url] = line.split('\t');
    return { aweme_id, url, title, play_url };
  });
}

function markMediaDownload(dbPath, awemeId, mediaType, status, result = {}) {
  const now = new Date().toISOString();
  runSqlite(dbPath, sqlInsertOrReplace('media_downloads', {
    aweme_id: awemeId,
    media_type: mediaType,
    status,
    file_path: result.filePath || null,
    metadata_path: result.metadataPath || null,
    error_message: result.errorMessage || null,
    downloaded_at: now
  }));
}

async function downloadAudioFromDbRow(dbPath, row, outputDir, options = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const info = loadVideoInfoFromDb(dbPath, row.aweme_id, options.quality || 'best', 'none');
  const metadataPath = path.join(outputDir, `${row.aweme_id}_metadata.json`);
  const audioUrlPath = new URL(row.play_url).pathname;
  const ext = path.extname(audioUrlPath).toLowerCase() || '.mp3';
  const audioPath = path.join(outputDir, `${row.aweme_id}${ext}`);

  await downloadFile(row.play_url, audioPath, options.showProgress !== false);
  writeMergedMetadata(metadataPath, {
    ...(info?.metadata || {}),
    audio_source: 'direct_music_url',
    files: {
      audio: audioPath,
      metadata: metadataPath
    }
  });

  return { audioPath, metadataPath };
}

async function downloadAudioBatchFromDb(args) {
  initCollectionDb(args.dbPath);
  const delaySeconds = Math.max(5, Number(args.delaySeconds) || 5);
  const totalLimit = Math.max(1, Number(args.downloadLimit) || 100);
  let totalProcessed = 0;
  let totalDownloaded = 0;

  while (true) {
    const remainingLimit = totalLimit - totalProcessed;
    if (remainingLimit <= 0) {
      console.log(`Reached audio download limit: ${totalLimit}.`);
      return;
    }

    const rows = listPendingAudio(args.dbPath, remainingLimit);
    if (!rows.length) {
      console.log(totalDownloaded ? 'All pending audio files are downloaded.' : 'No pending audio with direct music URL found in collection DB.');
      return;
    }

    console.log(`Downloading ${rows.length} audio files from collection DB...`);
    for (const row of rows) {
      console.log(`\n[${row.aweme_id}] ${row.title}`);
      try {
        const result = await downloadAudioFromDbRow(args.dbPath, row, args.outputDir, {
          quality: args.quality,
          showProgress: !args.quiet
        });
        markMediaDownload(args.dbPath, row.aweme_id, 'audio', 'success', {
          filePath: result.audioPath,
          metadataPath: result.metadataPath
        });
        totalDownloaded += 1;
      } catch (error) {
        markMediaDownload(args.dbPath, row.aweme_id, 'audio', 'failed', {
          errorMessage: error.message
        });
        console.error(`Audio download failed: ${error.message}`);
      }

      totalProcessed += 1;
      if (totalProcessed >= totalLimit) {
        console.log(`Reached audio download limit: ${totalLimit}.`);
        return;
      }
      if (row !== rows[rows.length - 1]) {
        console.log(`Waiting ${delaySeconds} seconds before the next audio...`);
        await sleep(delaySeconds * 1000);
      }
    }
  }
}

function askContinue(message) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(/^y(es)?|是|继续$/i.test(String(answer).trim()));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadBatchFromDb(args) {
  initCollectionDb(args.dbPath);
  const delaySeconds = Math.max(5, Number(args.delaySeconds) || 5);
  const confirmEvery = Math.max(1, Number(args.confirmEvery) || 10);
  const totalLimit = Math.max(1, Number(args.downloadLimit) || 100);
  let totalDownloaded = 0;
  let totalProcessed = 0;
  while (true) {
    const remainingLimit = totalLimit - totalProcessed;
    if (remainingLimit <= 0) {
      console.log(`Reached download limit: ${totalLimit}.`);
      return;
    }

    const rows = listPendingVideos(args.dbPath, remainingLimit, args.quality);
    if (!rows.length) {
      console.log(totalDownloaded ? 'All pending videos for this quality are downloaded.' : 'No pending videos found in collection DB.');
      return;
    }

    console.log(`Downloading ${rows.length} videos from collection DB...`);
    for (const row of rows) {
      console.log(`\n[${row.aweme_id}] ${row.title}`);
      console.log(`Opening: ${row.url}`);
      try {
        const info = loadVideoInfoFromDb(args.dbPath, row.aweme_id, args.quality, args.coverSize)
          || await parseShareUrl(row.url, args.quality, args.coverSize);
        const result = await downloadVideo(info, args.outputDir, {
          showProgress: !args.quiet,
          downloadCover: true
        });
        markVideoDownload(args.dbPath, row.aweme_id, args.quality, 'success', result);
        totalDownloaded += 1;
        totalProcessed += 1;
        if (totalProcessed >= totalLimit) {
          console.log(`Reached download limit: ${totalLimit}.`);
          return;
        }
        if (totalDownloaded > 0 && totalDownloaded % confirmEvery === 0) {
          const remaining = listPendingVideos(args.dbPath, 1, args.quality).length;
          if (remaining) {
            const shouldContinue = await askContinue(`Downloaded ${totalDownloaded} videos. Continue? [y/N] `);
            if (!shouldContinue) {
              console.log('Stopped after user confirmation checkpoint. Run the same command to continue later.');
              return;
            }
          }
        }
      } catch (error) {
        markVideoDownload(args.dbPath, row.aweme_id, args.quality, 'failed', {
          errorMessage: error.message
        });
        totalProcessed += 1;
        console.error(`Download failed: ${error.message}`);
        if (totalProcessed >= totalLimit) {
          console.log(`Reached download limit: ${totalLimit}.`);
          return;
        }
      }
      if (row !== rows[rows.length - 1]) {
        console.log(`Waiting ${delaySeconds} seconds before the next video...`);
        await sleep(delaySeconds * 1000);
      }
    }

    const remaining = listPendingVideos(args.dbPath, 1, args.quality).length;
    if (!remaining) {
      console.log('All pending videos for this quality are downloaded.');
      return;
    }
  }
}

async function fetchMusicDetail(musicId) {
  if (!musicId) return null;
  const apiUrl = `https://www.douyin.com/aweme/v1/web/music/detail/?music_id=${encodeURIComponent(musicId)}&aid=6383&device_platform=webapp`;
  const response = await httpRequest(apiUrl);
  return response.music_info || response.music || null;
}

async function enrichMusicPlayUrl(videoData) {
  const music = videoData?.music;
  if (!music || firstUrl(music.play_url)) return;

  const musicId = music.mid || music.id_str || music.id;
  const detail = await fetchMusicDetail(musicId);
  if (!detail) return;

  videoData.music = {
    ...music,
    ...detail,
    play_url: detail.play_url || music.play_url
  };
}

function buildMetadata(videoData, shareUrl, variants, selected, coverVariants, selectedCover, coverSize = 'medium') {
  const stats = videoData.statistics || {};
  const video = videoData.video || {};
  return {
    aweme_id: videoData.aweme_id || null,
    video_id: video.id || videoData.aweme_id || null,
    share_url: shareUrl,
    desc: videoData.desc || null,
    title: sanitizeName(videoData.desc || video.id || videoData.aweme_id),
    create_time: videoData.create_time ?? null,
    duration_ms: video.duration ?? null,
    cover: selectedCover?.url || firstUrl(video.cover || video.origin_cover || video.dynamic_cover),
    selected_cover: selectedCover,
    cover_selection: String(coverSize || 'medium').toLowerCase() === 'none' ? 'skipped' : 'selected',
    cover_variants: coverVariants,
    author: compactUser(videoData.author),
    music: compactMusic(videoData.music),
    stats: {
      digg_count: stats.digg_count ?? stats.like_count ?? null,
      comment_count: stats.comment_count ?? null,
      collect_count: stats.collect_count ?? null,
      share_count: stats.share_count ?? null,
      play_count: stats.play_count ?? null,
      download_count: stats.download_count ?? null,
      forward_count: stats.forward_count ?? null
    },
    raw_statistics: stats,
    selected_quality: selected,
    variants,
    saved_at: new Date().toISOString()
  };
}

function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s]+/);
  if (!match) throw new Error('No valid Douyin share URL found');
  return match[0];
}

function extractAwemeId(url) {
  const videoMatch = url.match(/\/video\/(\d+)/);
  if (videoMatch) return videoMatch[1];

  const noteMatch = url.match(/\/note\/(\d+)/);
  if (noteMatch) return noteMatch[1];

  const pathname = new URL(url).pathname;
  const lastPart = pathname.split('/').filter(Boolean).pop();
  if (lastPart && /^\d+$/.test(lastPart)) return lastPart;

  throw new Error('Unable to extract video ID from share URL');
}

function findVideoDataFromRouterData(pageContent) {
  const match = pageContent.match(/window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/);
  if (!match) return null;

  const jsonData = JSON.parse(match[1]);
  const loaderData = jsonData.loaderData || jsonData;
  return loaderData['video_(id)/page']?.videoInfoRes?.item_list?.[0]
    || loaderData['note_(id)/page']?.videoInfoRes?.item_list?.[0]
    || null;
}

function normalizeUrl(url) {
  if (!url) return null;
  return String(url).replace('playwm', 'play');
}

function makeVariant(source, fallbackLabel, index) {
  const urls = source?.play_addr?.url_list
    || source?.download_addr?.url_list
    || source?.url_list
    || [];
  const url = normalizeUrl(urls[0]);
  if (!url) return null;

  const width = Number(source.width || source.play_addr?.width || 0);
  const height = Number(source.height || source.play_addr?.height || 0);
  const bitRate = Number(source.bit_rate || source.bitrate || source.video_bit_rate || 0);
  const labelParts = [
    source.gear_name,
    source.quality_type,
    source.format,
    source.ratio,
    height ? `${height}p` : '',
    bitRate ? `${Math.round(bitRate / 1000)}kbps` : ''
  ].filter(Boolean);

  return {
    index,
    label: labelParts.length ? labelParts.join(' / ') : fallbackLabel,
    url,
    width,
    height,
    bit_rate: bitRate,
    ratio: source.ratio || '',
    format: source.format || '',
    gear_name: source.gear_name || ''
  };
}

function collectVideoVariants(video) {
  const variants = [];
  const seen = new Set();

  const addVariant = (variant) => {
    if (!variant || seen.has(variant.url)) return;
    seen.add(variant.url);
    variants.push({ ...variant, index: variants.length });
  };

  if (Array.isArray(video?.bit_rate)) {
    for (const item of video.bit_rate) {
      addVariant(makeVariant(item, 'bitrate', variants.length));
    }
  }

  addVariant(makeVariant(video, 'play', variants.length));
  addVariant(makeVariant({ download_addr: video?.download_addr }, 'download', variants.length));
  addVariant(makeVariant({ play_addr: video?.play_addr }, 'play_addr', variants.length));

  variants.sort((a, b) => {
    const aScore = (a.height || 0) * 100000000 + (a.bit_rate || 0);
    const bScore = (b.height || 0) * 100000000 + (b.bit_rate || 0);
    return bScore - aScore;
  });

  return variants.map((variant, index) => ({ ...variant, index }));
}

function selectVariant(variants, quality) {
  if (!variants.length) throw new Error('No downloadable video URL found');

  const wanted = String(quality || 'best').toLowerCase();
  if (wanted === 'best' || wanted === 'highest') return variants[0];
  if (wanted === 'lowest' || wanted === 'low') return variants[variants.length - 1];

  if (/^\d+$/.test(wanted)) {
    const byIndex = variants[Number(wanted)];
    if (byIndex) return byIndex;
  }

  const exactHeight = wanted.match(/^(\d+)p$/);
  if (exactHeight) {
    const height = Number(exactHeight[1]);
    const byHeight = variants.find(variant => variant.height === height);
    if (byHeight) return byHeight;
  }

  const byLabel = variants.find((variant) => {
    const haystack = [
      variant.label,
      variant.ratio,
      variant.format,
      variant.gear_name,
      variant.height ? `${variant.height}p` : ''
    ].join(' ').toLowerCase();
    return haystack.includes(wanted);
  });
  if (byLabel) return byLabel;

  throw new Error(`Quality "${quality}" not found. Run "info" to list available qualities.`);
}

async function parseShareUrl(shareText, quality = 'best', coverSize = 'medium') {
  let shareUrl = extractFirstUrl(shareText);
  if (shareUrl.includes('v.douyin.com')) {
    shareUrl = await followRedirect(shareUrl);
  }

  const awemeId = extractAwemeId(shareUrl);
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}`;
  let videoData = null;

  const apiResponse = await httpRequest(apiUrl);
  videoData = apiResponse.aweme_detail || apiResponse;

  if (!videoData?.video) {
    const pageContent = await httpRequest(shareUrl);
    if (typeof pageContent === 'string') {
      videoData = findVideoDataFromRouterData(pageContent);
    }
  }

  if (!videoData?.video) {
    throw new Error('Unable to parse video information');
  }

  await enrichMusicPlayUrl(videoData);

  const variants = collectVideoVariants(videoData.video);
  const selected = selectVariant(variants, quality);
  const coverVariants = collectCoverVariants(videoData.video);
  const selectedCover = selectCoverVariant(coverVariants, coverSize);
  const title = sanitizeName(videoData.desc || `douyin_${videoData.aweme_id || awemeId}`);

  return {
    video_id: videoData.video?.id || videoData.aweme_id || awemeId,
    aweme_id: videoData.aweme_id || awemeId,
    title,
    metadata: buildMetadata(videoData, shareUrl, variants, selected, coverVariants, selectedCover, coverSize),
    share_url: shareUrl,
    selected_quality: selected,
    selected_cover: selectedCover,
    cover_variants: coverVariants,
    variants
  };
}

async function downloadVideo(videoInfo, outputDir, options = {}) {
  const showProgress = typeof options === 'boolean' ? options : options.showProgress !== false;
  const downloadCover = typeof options === 'object' ? options.downloadCover !== false : true;
  fs.mkdirSync(outputDir, { recursive: true });
  const qualitySuffix = sanitizeName(videoInfo.selected_quality.label).replace(/\s+/g, '_');
  const outputPath = path.join(outputDir, `${videoInfo.video_id}_${qualitySuffix}.mp4`);
  const metadataPath = path.join(outputDir, `${videoInfo.video_id}_metadata.json`);
  let coverPath = null;

  if (showProgress) {
    console.log(`Downloading: ${videoInfo.title}`);
    console.log(`Quality: ${videoInfo.selected_quality.label}`);
    if (videoInfo.selected_cover) console.log(`Cover: ${videoInfo.selected_cover.label}`);
  }

  await downloadFile(videoInfo.selected_quality.url, outputPath, showProgress);
  if (downloadCover) {
    const coverResult = await downloadCoverImage(videoInfo, outputDir, {
      showProgress,
      writeMetadata: false
    });
    coverPath = coverResult.coverPath;
  }
  writeMergedMetadata(metadataPath, {
    ...videoInfo.metadata,
    files: {
      video: outputPath,
      cover: coverPath,
      metadata: metadataPath
    }
  });
  if (showProgress) {
    console.log(`Metadata saved: ${metadataPath}`);
  }
  return { videoPath: outputPath, coverPath, metadataPath };
}

async function downloadCoverImage(videoInfo, outputDir, options = {}) {
  const showProgress = options.showProgress !== false;
  const writeMetadata = options.writeMetadata !== false;
  fs.mkdirSync(outputDir, { recursive: true });
  const metadataPath = path.join(outputDir, `${videoInfo.video_id}_metadata.json`);
  const cover = videoInfo.selected_cover || null;
  if (!cover?.url) {
    throw new Error('No cover URL selected. Use --cover-size medium, best, origin, raw, dynamic, gaussian, or a cover index.');
  }

  const coverExt = path.extname(new URL(cover.url).pathname).toLowerCase() || '.jpg';
  const coverPath = path.join(outputDir, `${videoInfo.video_id}_cover_${sanitizeName(cover.label)}${coverExt}`);
  if (showProgress) {
    console.log(`Downloading cover: ${cover.label}`);
  }
  await downloadFile(cover.url, coverPath, showProgress);

  if (writeMetadata) {
    writeMergedMetadata(metadataPath, {
      ...videoInfo.metadata,
      files: {
        cover: coverPath,
        metadata: metadataPath
      }
    });
    if (showProgress) console.log(`Metadata saved: ${metadataPath}`);
  }

  return { coverPath, metadataPath, cover };
}

async function downloadAudio(videoInfo, outputDir, options = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const metadataPath = path.join(outputDir, `${videoInfo.video_id}_metadata.json`);
  const directUrl = videoInfo.metadata?.music?.play_url || null;
  if (!directUrl) {
    throw new Error('No direct audio URL found from Douyin music detail');
  }

  const audioUrlPath = new URL(directUrl).pathname;
  const ext = path.extname(audioUrlPath).toLowerCase() || '.mp3';
  const audioPath = path.join(outputDir, `${videoInfo.video_id}${ext}`);

  if (options.showProgress) {
    console.log(`Downloading direct audio URL: ${videoInfo.metadata.music.title || videoInfo.video_id}`);
  }
  await downloadFile(directUrl, audioPath, options.showProgress);

  writeMergedMetadata(metadataPath, {
    ...videoInfo.metadata,
    audio_source: 'direct_music_url',
    files: {
      audio: audioPath,
      metadata: metadataPath
    }
  });

  if (options.showProgress) {
    console.log(`Audio saved: ${audioPath}`);
    console.log(`Metadata saved: ${metadataPath}`);
  }

  return { audioPath, metadataPath, source: 'direct_music_url' };
}

function printInfo(info) {
  console.log('\n' + '='.repeat(60));
  console.log('Douyin video info');
  console.log('='.repeat(60));
  console.log(`Video ID: ${info.video_id}`);
  console.log(`Title: ${info.title}`);
  console.log(`Audio URL: ${info.metadata?.music?.play_url ? 'available' : 'not found'}`);
  console.log(`Selected: [${info.selected_quality.index}] ${info.selected_quality.label}`);
  const coverStatus = info.metadata?.cover_selection === 'skipped'
    ? 'skipped'
    : (info.selected_cover ? `[${info.selected_cover.index}] ${info.selected_cover.label}` : 'not found');
  console.log(`Selected cover: ${coverStatus}`);
  console.log('\nAvailable qualities:');
  for (const variant of info.variants) {
    const size = variant.width && variant.height ? `${variant.width}x${variant.height}` : 'unknown';
    const bitrate = variant.bit_rate ? `${Math.round(variant.bit_rate / 1000)}kbps` : 'unknown';
    console.log(`  [${variant.index}] ${variant.label} | ${size} | ${bitrate}`);
  }
  if (info.cover_variants?.length) {
    console.log('\nAvailable covers:');
    for (const cover of info.cover_variants) {
      const size = cover.width && cover.height ? `${cover.width}x${cover.height}` : 'unknown';
      console.log(`  [${cover.index}] ${cover.label} | ${size}`);
    }
  }
  console.log('='.repeat(60));
}

function parseArgs(args) {
  const hasShareLink = args[1] && !String(args[1]).startsWith('-');
  const parsed = {
    command: args[0],
    shareLink: hasShareLink ? args[1] : null,
    outputDir: './output',
    quality: 'best',
    coverSize: 'medium',
    dbPath: './douyin_collection.sqlite',
    inputPath: null,
    outputPath: null,
    format: 'json',
    downloadLimit: 100,
    limit: 100,
    delaySeconds: 5,
    confirmEvery: 10,
    quiet: false,
    browserSession: 'dyvdl',
    profileDir: DEFAULT_BROWSER_PROFILE,
    loginTimeoutSeconds: 180,
    reuseSession: false,
    secUserId: null
  };

  for (let i = hasShareLink ? 2 : 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      parsed.outputDir = args[++i];
    } else if ((arg === '-q' || arg === '--quality') && args[i + 1]) {
      parsed.quality = args[++i];
    } else if (arg === '--cover-size' && args[i + 1]) {
      parsed.coverSize = args[++i];
    } else if (arg === '--db' && args[i + 1]) {
      parsed.dbPath = args[++i];
    } else if ((arg === '-i' || arg === '--input') && args[i + 1]) {
      parsed.inputPath = args[++i];
    } else if (arg === '--format' && args[i + 1]) {
      parsed.format = args[++i];
    } else if (arg === '--download-limit' && args[i + 1]) {
      parsed.downloadLimit = Number(args[++i]) || 100;
    } else if (arg === '--limit' && args[i + 1]) {
      parsed.limit = Number(args[++i]) || 100;
    } else if (arg === '--delay-seconds' && args[i + 1]) {
      parsed.delaySeconds = Math.max(5, Number(args[++i]) || 5);
    } else if (arg === '--confirm-every' && args[i + 1]) {
      parsed.confirmEvery = Math.max(1, Number(args[++i]) || 10);
    } else if (arg === '--quiet') {
      parsed.quiet = true;
    } else if (arg === '--browser-session' && args[i + 1]) {
      parsed.browserSession = args[++i];
    } else if (arg === '--profile-dir' && args[i + 1]) {
      parsed.profileDir = args[++i];
    } else if (arg === '--login-timeout' && args[i + 1]) {
      parsed.loginTimeoutSeconds = Number(args[++i]) || 180;
    } else if (arg === '--reuse-session') {
      parsed.reuseSession = true;
    } else if (arg === '--sec-user-id' && args[i + 1]) {
      parsed.secUserId = args[++i];
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
Douyin video downloader

Usage:
  node douyin-video.js info <share-link> [--quality best] [--cover-size medium]
  node douyin-video.js download <share-link> [-o output-dir] [--quality best] [--cover-size medium]
  node douyin-video.js cover <share-link> [-o output-dir] [--cover-size medium]
  node douyin-video.js audio <share-link> [-o output-dir] [--quality best]
  node douyin-video.js db-init --db ./douyin_collection.sqlite
  node douyin-video.js collect-user <user-home-url> --db ./douyin_collection.sqlite -o ./collection [--limit 100]
  node douyin-video.js db-import-post-json --db ./douyin_collection.sqlite --input ./post.json [--limit 100]
  node douyin-video.js db-export --db ./douyin_collection.sqlite -o ./videos.json [--format json|csv]
  node douyin-video.js db-download-batch --db ./douyin_collection.sqlite -o ./videos [--quality best] [--cover-size medium] [--delay-seconds 5] [--confirm-every 10] [--download-limit 100]
  node douyin-video.js db-download-audio-batch --db ./douyin_collection.sqlite -o ./audios [--delay-seconds 5] [--download-limit 100]

Quality:
  best, lowest, 720p, 1080p, candidate index, or partial label match.

Cover:
  medium is the default. Use thumb, origin, large, dynamic, animated, none, or a cover index from info.

Audio:
  The audio command downloads the direct music URL exposed by Douyin music detail.
  It does not extract audio from video files.

Collection DB:
  The SQLite collection stores users, crawl pages, videos, stats, and music URLs.
  collect-user reuses a persistent browser profile and prompts for QR login only when needed.
  Import logged-in /aweme/v1/web/aweme/post/ JSON response bodies with db-import-post-json.
  Collection imports are capped at the first 100 videos by default and never start downloads automatically.
  Batch downloads process URLs sequentially and wait at least 5 seconds before the next URL.
  Ask the user whether to continue after every 10 successful downloads.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const linkCommands = new Set(['info', 'download', 'cover', 'audio', 'collect-user']);
  if (!args.command || (linkCommands.has(args.command) && !args.shareLink)) {
    printUsage();
    process.exit(1);
  }

  try {
    if (args.command === 'info') {
      const info = await parseShareUrl(args.shareLink, args.quality, args.coverSize);
      printInfo(info);
    } else if (args.command === 'download') {
      const info = await parseShareUrl(args.shareLink, args.quality, args.coverSize);
      printInfo(info);
      const result = await downloadVideo(info, args.outputDir, {
        showProgress: !args.quiet,
        downloadCover: true
      });
      console.log(`\nVideo saved to: ${result.videoPath}`);
      if (result.coverPath) console.log(`Cover saved to: ${result.coverPath}`);
      console.log(`Metadata saved to: ${result.metadataPath}`);
    } else if (args.command === 'cover') {
      const info = await parseShareUrl(args.shareLink, args.quality, args.coverSize);
      printInfo(info);
      const result = await downloadCoverImage(info, args.outputDir, {
        showProgress: !args.quiet,
        writeMetadata: true
      });
      console.log(`\nCover saved to: ${result.coverPath}`);
      console.log(`Metadata saved to: ${result.metadataPath}`);
    } else if (args.command === 'audio') {
      const info = await parseShareUrl(args.shareLink, args.quality, args.coverSize);
      printInfo(info);
      const result = await downloadAudio(info, args.outputDir, {
        showProgress: !args.quiet
      });
      console.log(`\nAudio saved to: ${result.audioPath}`);
      console.log(`Metadata saved to: ${result.metadataPath}`);
      console.log(`Audio source: ${result.source}`);
    } else if (args.command === 'collect-user') {
      await collectUser(args);
    } else if (args.command === 'db-init') {
      initCollectionDb(args.dbPath);
      console.log(`Collection DB initialized: ${path.resolve(args.dbPath)}`);
    } else if (args.command === 'db-import-post-json') {
      if (!args.inputPath) throw new Error('Missing --input JSON file');
      const result = importPostJsonToDb(args.dbPath, args.inputPath, {
        secUserId: args.secUserId,
        limit: args.limit
      });
      console.log(`Imported ${result.imported} videos from ${result.sourceFile}`);
      if (result.limit > 0) {
        console.log(`Collection limit: first ${result.limit} videos. Existing before import: ${result.existingBefore}. Skipped by limit: ${result.skippedByLimit}.`);
      }
      console.log(`Collection DB: ${path.resolve(result.dbPath)}`);
      console.log('Collection completed. No download was started. Confirm with the user before running db-download-batch.');
    } else if (args.command === 'db-export') {
      if (!args.outputDir) throw new Error('Missing -o output path');
      const result = exportCollectionDb(args.dbPath, args.outputDir, args.format);
      console.log(`Exported collection to: ${result.outputPath}`);
      if (result.count !== undefined) console.log(`Rows: ${result.count}`);
    } else if (args.command === 'db-download-batch') {
      await downloadBatchFromDb(args);
    } else if (args.command === 'db-download-audio-batch') {
      await downloadAudioBatchFromDb(args);
    } else {
      printUsage();
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
