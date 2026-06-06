# Browser Login

`collect-user` needs a browser context for Douyin user pages because list APIs usually require signed browser parameters and a valid login state.

## Login Flow

1. Reuse the persistent local browser profile. With `--account <name>`, the profile is `~/.agents/douyin-video-downloader/accounts/<name>/browser-profile`; otherwise it is `~/.agents/douyin-video-downloader/browser-profile`.
2. Open the user home page.
3. Check whether login cookies such as `sessionid` or `sid_guard` are available.
4. Check whether the `/aweme/v1/web/aweme/post/` response contains usable `aweme_list` data.
5. If login is unavailable, show a QR-login prompt and wait for the user to log in.
6. After login, continue collection and save the response JSON to the output directory.

## Check Login First

```bash
node douyin-video.js check-login --account default
```

`check-login` opens or reuses the account browser profile and checks Douyin login cookies. It does not collect user pages or download media.

Exit codes:

- `0`: login appears valid.
- `2`: login is missing or expired.
- `1`: dependency or runtime error.

## Playwright CLI

Browser collection is optional. Single video, cover, audio, database import, export, and batch downloads from an existing database do not require Playwright.

For browser collection, set `PWCLI` if the wrapper is not installed under a common skill path:

```bash
export PWCLI="$HOME/.agents/skills/playwright/scripts/playwright_cli.sh"
```
