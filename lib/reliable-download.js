'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

function failure(message, retryable = true) {
  return Object.assign(new Error(message), { retryable });
}

function responseFor(url, headers, timeout, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) return reject(failure('Unsupported download protocol', false));
    const req = (target.protocol === 'https:' ? https : http).get(target, { headers }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (!res.headers.location || redirects >= 5) return reject(failure('Invalid or excessive download redirects', false));
        responseFor(new URL(res.headers.location, target).href, headers, timeout, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        const error = failure(`HTTP ${res.statusCode}`, [408, 425, 429].includes(res.statusCode) || res.statusCode >= 500);
        const retryAfter = res.headers['retry-after'];
        if (retryAfter) {
          const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
          if (Number.isFinite(seconds)) error.retryAfterMs = Math.max(0, seconds * 1000);
        }
        reject(error);
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(failure('Download inactivity timeout')));
  });
}

// Retry from byte zero deliberately: no unvalidated Range appends or stale partials.
async function reliableDownload(url, filepath, options = {}) {
  const { headers = {}, showProgress = true, attempts = 4, timeoutMs = 60000,
    retryDelayMs = 1000, maxRetryDelayMs = 30000, sleep = delay } = options;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');
  fs.mkdirSync(path.dirname(path.resolve(filepath)), { recursive: true });
  const partial = `${filepath}.${randomUUID()}.part`;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response;
      try {
        response = await responseFor(url, { ...headers, 'Accept-Encoding': 'identity' }, timeoutMs);
        const type = String(response.headers['content-type'] || '').toLowerCase();
        if (/text\/html|application\/(?:json|xhtml)/.test(type)) throw failure('Server returned a page or JSON instead of media', false);
        const rawLength = response.headers['content-length'];
        const expected = rawLength === undefined ? null : Number(rawLength);
        if (expected !== null && (!Number.isSafeInteger(expected) || expected <= 0)) throw failure('Invalid or empty media length');
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw failure('Unexpected encoded media response', false);
        let received = 0;
        let bucket = -1;
        response.on('data', chunk => {
          received += chunk.length;
          if (showProgress && expected) {
            const next = Math.min(100, Math.floor(received / expected * 20) * 5);
            if (next !== bucket) {
              bucket = next;
              process.stdout.write(`\rDownload progress: ${next}%`);
            }
          }
        });
        await pipeline(response, fs.createWriteStream(partial, { flags: 'w' }));
        const actual = fs.statSync(partial).size;
        if (!response.complete || actual === 0 || actual !== received || (expected !== null && actual !== expected)) {
          throw failure(`Incomplete media: received ${actual}, expected ${expected ?? 'complete HTTP stream'}`);
        }
        // Publish only a verified complete transfer; failures preserve any old final file.
        fs.renameSync(partial, filepath);
        if (showProgress) console.log(`\nSaved: ${filepath}`);
        return filepath;
      } catch (error) {
        response?.destroy();
        fs.rmSync(partial, { force: true });
        const localFailure = ['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOENT', 'EISDIR'].includes(error.code);
        if (localFailure || error.retryable === false || attempt === attempts) throw error;
        const wait = Math.min(maxRetryDelayMs, Math.max(retryDelayMs * 2 ** (attempt - 1), error.retryAfterMs || 0));
        if (showProgress) console.error(`\nDownload attempt ${attempt}/${attempts} failed: ${error.message}. Retrying in ${wait}ms.`);
        await sleep(wait);
      }
    }
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

module.exports = { reliableDownload };
