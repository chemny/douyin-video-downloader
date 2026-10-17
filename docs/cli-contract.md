# CLI Contract

The CLI entrypoint is:

```bash
node douyin-video.js <command> [arguments] [options]
```

## Single Video Commands

```bash
node douyin-video.js info <share-link> [--quality best] [--cover-size medium]
node douyin-video.js download <share-link> -o <output-dir> [--quality best] [--cover-size medium]
node douyin-video.js cover <share-link> -o <output-dir> [--cover-size medium]
node douyin-video.js audio <share-link> -o <output-dir>
```

`download` always downloads a cover unless `--cover-size none` is used. `audio` only uses direct Douyin music URLs and never extracts audio from video files.

## Login And Collection Commands

```bash
node douyin-video.js check-login [--account <name>] [--profile-dir <path>] [--reuse-session]
node douyin-video.js collect-user <user-home-url> --db <sqlite-path> -o <collection-dir> [--account <name>] [--limit 100]
```

`check-login` checks whether the browser profile has usable Douyin login cookies. It exits with:

- `0`: login appears valid.
- `2`: login is missing or expired.
- `1`: command error, missing dependency, or unexpected failure.

`collect-user` automatically traverses post pages, stores each raw response, imports video metadata into SQLite, and exports JSON/CSV. The default cap is 100 videos; `--limit 0` removes the item cap with a 1,000-page safety cap. Existing rows do not consume new slots. Later-page errors preserve and export already collected rows. It must not start downloads automatically after collection.

## Account Isolation

Use `--account <name>` for repeatable browser state. Without an explicit `--profile-dir`, account profiles are stored under:

```text
~/.agents/douyin-video-downloader/accounts/<account>/browser-profile
```

If `--browser-session` is not provided, the account name is used to derive a stable Playwright session name.

## Database Commands

```bash
node douyin-video.js db-init --db <sqlite-path>
node douyin-video.js db-import-post-json --db <sqlite-path> --input <post-json> [--limit 100]
node douyin-video.js db-export --db <sqlite-path> -o <output-path> [--format json|csv]
```

Imports are capped at the first 100 videos by default. Existing `aweme_id` rows are updated instead of duplicated.

## Batch Download Commands

```bash
node douyin-video.js db-download-batch --db <sqlite-path> -o <output-dir> [--quality best] [--cover-size medium] [--delay-seconds 5] [--confirm-every 10] [--download-limit 100]
node douyin-video.js db-download-audio-batch --db <sqlite-path> -o <output-dir> [--delay-seconds 5] [--download-limit 100]
```

Batch downloads process videos sequentially, wait at least 5 seconds between items, skip successful prior downloads, and require user confirmation after every 10 successful video downloads.

## Transfer guarantees

All three media commands share four bounded attempts with 1/2/4 second backoff for transient failures. Retry-After is honored up to 30 seconds. Each attempt restarts in a unique temporary file. Only a non-empty complete HTTP transfer with matching Content-Length (when present) replaces the final file. Without a source length, only HTTP stream completeness is known; no codec or checksum validation is performed. Failures clean up temporary files and preserve old final files.
