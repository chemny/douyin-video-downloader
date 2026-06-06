#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const warnings = [];

function addFail(message) {
  fail.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(path.relative(repoRoot, fullPath));
    }
  }
  return files;
}

const required = ['SKILL.md', 'README.md', 'README.en.md', 'LICENSE', '.gitignore', 'package.json', 'douyin-video.js'];
for (const file of required) {
  if (!existsSync(path.join(repoRoot, file))) addFail(`Missing required file: ${file}`);
}

if (existsSync(path.join(repoRoot, 'README.zh.md'))) {
  addFail('README.zh.md still exists; publisher convention expects README.md + README.en.md');
}

const packageJson = JSON.parse(await read('package.json'));
if (!packageJson.scripts?.['smoke-test']) addFail('package.json missing scripts.smoke-test');
if (!packageJson.scripts?.['publish-check']) addFail('package.json missing scripts.publish-check');

const readme = await read('README.md');
const readmeEn = await read('README.en.md');
if (!readme.includes('[English](./README.en.md)')) addFail('README.md missing English language switch');
if (!readmeEn.includes('[中文](./README.md)')) addFail('README.en.md missing Chinese language switch');
if (!readme.includes('https://github.com/chemny/douyin-video-downloader.git')) addWarning('README.md clone URL is not the target GitHub repository');
if (!readmeEn.includes('https://github.com/chemny/douyin-video-downloader.git')) addWarning('README.en.md clone URL is not the target GitHub repository');

const skill = await read('SKILL.md');
if (!/^---\n[\s\S]*?\n---/.test(skill)) addFail('SKILL.md missing YAML frontmatter');
if (!/^name:\s*douyin-video-downloader/m.test(skill)) addFail('SKILL.md name mismatch');
if (!/^description:\s*\S+/m.test(skill)) addFail('SKILL.md description missing');

const allFiles = await walk(repoRoot);
const textExtensions = new Set(['.md', '.js', '.mjs', '.json', '.sh', '.gitignore']);
const suspiciousPatterns = [
  { name: 'local absolute path', pattern: new RegExp('(/(Users|Volumes|home)/|(^|[\\s"\'`(])[A-Za-z]:[\\\\/])') },
  { name: 'private token marker', pattern: new RegExp(`(${['gh', 'p_'].join('')}|${['github', '_pat_'].join('')}|sk-(proj|live|test)-[A-Za-z0-9]|Bearer\\s+[A-Za-z0-9._-]{20,})`) },
  { name: 'environment secret assignment', pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9._-]{16,}/i },
  { name: 'real Douyin cookie value', pattern: /(sessionid|sid_guard)\s*[:=]\s*['"][^'"]{12,}/i }
];

for (const file of allFiles) {
  const ext = path.extname(file);
  if (!textExtensions.has(ext) && !['LICENSE', 'README', '.gitignore'].includes(path.basename(file))) continue;
  const body = await read(file);
  for (const check of suspiciousPatterns) {
    if (check.pattern.test(body)) addFail(`${check.name} found in ${file}`);
  }
}

for (const generated of ['output', 'downloads', 'audios', 'collection', 'debug', 'browser-profile', 'accounts']) {
  const target = path.join(repoRoot, generated);
  if (!existsSync(target)) continue;
  const info = await stat(target);
  if (info.isDirectory()) addWarning(`Local generated directory exists and should not be committed: ${generated}/`);
}

const smoke = spawnSync('node', ['scripts/smoke-test.mjs'], { cwd: repoRoot, encoding: 'utf8' });
if (smoke.status !== 0) addFail(`smoke-test failed: ${(smoke.stderr || smoke.stdout).trim()}`);

if (fail.length) {
  console.error('FAIL publish-check');
  for (const item of fail) console.error(`- ${item}`);
  if (warnings.length) {
    console.error('Warnings:');
    for (const item of warnings) console.error(`- ${item}`);
  }
  process.exit(1);
}

if (warnings.length) {
  console.log('WARNING publish-check');
  for (const item of warnings) console.log(`- ${item}`);
  process.exit(0);
}

console.log('PASS publish-check');
