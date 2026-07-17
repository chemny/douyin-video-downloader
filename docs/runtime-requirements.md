# Runtime Requirements

## Required

- Node.js 18 or newer.
- System `sqlite3` command for collection database operations. On Windows, install `sqlite3.exe` and add it to `PATH`.
- Network access to Douyin pages and CDN media URLs.

## Optional

Browser collection requires the local Playwright skill CLI wrapper. Set `PWCLI` if it is not installed in a default location:

```bash
export PWCLI="$HOME/.agents/skills/playwright/scripts/playwright_cli.sh"
```

On Windows, `PWCLI` may point to `playwright_cli.cmd` or `playwright_cli.ps1`.

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

## Windows Notes

- Single video, cover, and direct audio commands support native Windows Node.js.
- SQLite workflows require `sqlite3.exe` in `PATH`.
- Browser collection requires a compatible Playwright CLI wrapper; set `PWCLI` to the `.cmd` or `.ps1` wrapper.
- PowerShell examples are available under `scripts/examples/*.ps1`.
