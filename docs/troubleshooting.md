# Troubleshooting

## Playwright CLI Wrapper Not Found

Set `PWCLI` to the wrapper path:

```bash
export PWCLI="$HOME/.agents/skills/playwright/scripts/playwright_cli.sh"
```

Then rerun `check-login` or `collect-user`.

## Login Is Missing Or Expired

Run:

```bash
node douyin-video.js check-login --account default
```

If the browser opens a QR login page, ask the user to scan it. After login completes, rerun `check-login` or continue with `collect-user`.

## User Page Collection Returns No Videos

Check these items:

- The account is logged in.
- The user page URL is a full `https://www.douyin.com/user/...` URL.
- The page has loaded the video grid.
- Douyin has not shown a verification or risk-control page.

If needed, rerun with the same `--account` after the user manually reloads the page in the opened browser.

## Audio Download Fails

The audio command only downloads direct Douyin music URLs. If a video does not expose a usable music `play_url`, the command should fail instead of extracting audio from the video file.

## Batch Download Stops

Video batch downloads ask for confirmation after every 10 successful downloads. This is expected. Rerun the command to continue later; successful prior downloads are skipped using the SQLite status tables.
