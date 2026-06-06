#!/usr/bin/env node

import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'SKILL.md',
  'README.md',
  'README.en.md',
  'LICENSE',
  'SECURITY.md',
  'CHANGELOG.md',
  'douyin-video.js',
  'package.json',
  'docs/agent-bootstrap.md',
  'docs/browser-login.md',
  'docs/cli-contract.md',
  'docs/runtime-requirements.md',
  'docs/troubleshooting.md',
  'scripts/examples/single_download.sh',
  'scripts/examples/collect_user.sh',
  'scripts/examples/batch_download.sh'
];

const errors = [];

async function mustExist(relativePath) {
  try {
    await access(path.join(repoRoot, relativePath), constants.R_OK);
  } catch {
    errors.push(`Missing required file: ${relativePath}`);
  }
}

for (const file of requiredFiles) {
  await mustExist(file);
}

const read = relativePath => readFile(path.join(repoRoot, relativePath), 'utf8');
const skill = await read('SKILL.md');
if (!/^---\n[\s\S]*?\n---/.test(skill)) errors.push('SKILL.md is missing YAML frontmatter');
if (!/^name:\s*douyin-video-downloader/m.test(skill)) errors.push('SKILL.md frontmatter name is not douyin-video-downloader');
if (!/^description:\s*\S+/m.test(skill)) errors.push('SKILL.md frontmatter description is missing');

const readmeZh = await read('README.md');
const readmeEn = await read('README.en.md');
if (!readmeZh.includes('[English](./README.en.md)')) errors.push('README.md does not link to README.en.md');
if (!readmeEn.includes('[中文](./README.md)')) errors.push('README.en.md does not link to README.md');

const nodeCheck = spawnSync('node', ['--check', 'douyin-video.js'], { cwd: repoRoot, encoding: 'utf8' });
if (nodeCheck.status !== 0) errors.push(`node --check failed: ${(nodeCheck.stderr || nodeCheck.stdout).trim()}`);

const examplesDir = path.join(repoRoot, 'scripts', 'examples');
for (const file of await readdir(examplesDir)) {
  if (!file.endsWith('.sh')) continue;
  const bashCheck = spawnSync('bash', ['-n', path.join('scripts', 'examples', file)], { cwd: repoRoot, encoding: 'utf8' });
  if (bashCheck.status !== 0) errors.push(`bash -n failed for ${file}: ${(bashCheck.stderr || bashCheck.stdout).trim()}`);
}

if (errors.length) {
  console.error('FAIL smoke-test');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('PASS smoke-test');
