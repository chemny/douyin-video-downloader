# Agent Bootstrap

Use this project through `douyin-video.js`; do not reimplement parsing logic in the agent.

## Default Order

1. For a single video, run `info` first when the user needs quality or cover choices.
2. Download video with `download`; it should also download a cover unless the user says otherwise.
3. Download audio with `audio`; only use direct Douyin music URLs.
4. For a user page, run `check-login --account <name>` when login state is uncertain.
5. Run `collect-user` to store metadata in SQLite and export JSON/CSV.
6. Tell the user collection is complete and ask before running batch downloads.
7. Use `db-download-batch` for videos/covers and `db-download-audio-batch` for direct audio.

## Hard Rules

- Do not use ffmpeg to generate audio from video.
- Do not start batch downloads automatically after collection.
- Do not bypass login, platform restrictions, or verification flows.
- Do not scrape more than the requested limit; default collection limit is 100.
- Keep at least 5 seconds between batch items.
- Ask whether to continue after every 10 successful video downloads.

## Login Handling

Prefer `--account <name>` over manually passing profile paths. If the user has already logged in with that account and cookies are valid, continue without asking for another scan. If login is missing or expired, open the browser, show or describe the QR login state, wait for user login, then continue.
