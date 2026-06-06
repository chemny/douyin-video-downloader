# Runtime Requirements

## Required

- Node.js 18 or newer.
- System `sqlite3` command for collection database operations.
- Network access to Douyin pages and CDN media URLs.

## Optional

Browser collection requires the local Playwright skill CLI wrapper. Set `PWCLI` if it is not installed in a default location:

```bash
export PWCLI="$HOME/.agents/skills/playwright/scripts/playwright_cli.sh"
```

Single video info, video download, cover download, audio download, database import/export, and batch downloads from an existing SQLite database do not require Playwright.

## Local State

Default local state lives under:

```text
~/.agents/douyin-video-downloader/
```

Account-scoped browser profiles live under:

```text
~/.agents/douyin-video-downloader/accounts/<account>/browser-profile
```

Do not commit browser profiles, cookies, SQLite databases, downloaded media, or debug response bodies.
