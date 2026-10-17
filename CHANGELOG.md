# Changelog

## 0.2.2

- Normalize bilingual README layout and Skill version metadata; align packaging checks and add a labelled workflow illustration.

- Live verification fixes: normalize structured CLI results and cookie-list output, clear stale requests before navigation, require the first request cursor to be zero, and match each subsequent request to the prior response cursor.
- Poll initial post responses before prompting for login; add regressions for reset request numbering and missing cursor links.

- Add automatic browser-list pagination with prefetched page ordering, cursor/data stagnation guards, limits and partial-result exports.
- Fix overlapping-page imports and allow existing rows to update at the collection cap; support `--limit 0`.
- Validate complete, non-empty media transfers and advertised lengths before publishing temporary files.
- Add bounded retries with backoff for network interruptions, timeouts and transient HTTP failures; preserve existing final files on failure.
- Retain quality, cover and direct audio selection; fix video download with `--cover-size none`.
- Add offline HTTP, pagination, SQLite and CLI integration regressions via `npm test`.

## 0.2.1

- Improved Windows compatibility for home directory detection, `npx` checks, `sqlite3` checks, and Playwright wrapper resolution.
- Added PowerShell example scripts for single download, user collection, and batch download flows.
- Updated smoke tests to skip bash-only checks when bash is unavailable.
- Documented Windows requirements for SQLite and browser collection.

## 0.2.0

- Added `check-login` to validate Douyin browser login state before collection.
- Added `--account` browser profile isolation for collection and login checks.
- Added CLI contract, runtime requirements, troubleshooting, and agent bootstrap docs.
- Added shell examples for single download, user collection, and batch download workflows.
- Reworked bilingual README structure around audience value, install, quick start, core workflows, command reference, and safety rules.

## 0.1.0

- Added single Douyin video parsing and quality selection.
- Added MP4 video download with cover image download.
- Added direct music audio download without ffmpeg extraction.
- Added SQLite collection database for users, pages, videos, stats, music, and download state.
- Added user-list JSON import, JSON/CSV export, and browser-assisted `collect-user`.
- Added batch video and batch audio download from the collection database.
- Added login-state reuse and QR login waiting for user-page collection.
