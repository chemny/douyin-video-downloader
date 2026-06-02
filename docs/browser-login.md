# Browser Login

`collect-user` needs a browser context for Douyin user pages because list APIs usually require signed browser parameters and a valid login state.

## Login Flow

1. Reuse the persistent local browser profile under `~/.agents/douyin-video-downloader/browser-profile`.
2. Open the user home page.
3. Check whether login cookies such as `sessionid` or `sid_guard` are available.
4. Check whether the `/aweme/v1/web/aweme/post/` response contains usable `aweme_list` data.
5. If login is unavailable, show a QR-login prompt and wait for the user to log in.
6. After login, continue collection and save the response JSON to the output directory.

## Playwright CLI

Browser collection is optional. Single video, cover, audio, database import, export, and batch downloads from an existing database do not require Playwright.

For browser collection, set `PWCLI` if the wrapper is not installed under a common skill path:

```bash
export PWCLI="$HOME/.agents/skills/playwright/scripts/playwright_cli.sh"
```
