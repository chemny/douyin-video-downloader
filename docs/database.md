# SQLite Database

The collection database is local SQLite. It stores metadata and file paths only; downloaded media stays on disk.

## Tables

- `users`: user profile fields returned by Douyin.
- `crawl_pages`: raw `/aweme/v1/web/aweme/post/` response pages.
- `videos`: video title, URL, cover URL, duration, creation time, and raw item JSON.
- `video_stats`: likes, comments, collects, shares, plays, downloads, and forwards.
- `music`: music ID, title, author, duration, direct audio URL, and raw music JSON.
- `video_downloads`: video download status, selected quality, video path, metadata path, and errors.
- `media_downloads`: audio download status, file path, metadata path, and errors.

## Design Notes

- Keep raw JSON in `crawl_pages.raw_json`, `videos.raw_json`, and `music.raw_json` so future parser changes can reprocess old captures.
- Do not store video, audio, or cover binary data in SQLite.
- Use `aweme_id` as the stable video key.
