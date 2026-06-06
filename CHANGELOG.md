# Changelog

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
