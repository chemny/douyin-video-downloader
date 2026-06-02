# Batch Download

Batch video and audio downloads are driven by the SQLite collection database.

## Video

```bash
node douyin-video.js db-download-batch \
  --db ./douyin_collection.sqlite \
  -o ./videos \
  --quality best \
  --cover-size medium \
  --delay-seconds 5 \
  --confirm-every 10 \
  --download-limit 100
```

- Uses `videos.raw_json` first to avoid reparsing video pages.
- Downloads video and cover together.
- Skips already successful downloads for the same quality.
- Waits at least 5 seconds between items.
- Asks whether to continue after every 10 successful downloads in an interactive terminal.

## Audio

```bash
node douyin-video.js db-download-audio-batch \
  --db ./douyin_collection.sqlite \
  -o ./audios \
  --delay-seconds 5 \
  --download-limit 100
```

- Uses `music.play_url` directly.
- Does not extract audio from video files.
- Records state in `media_downloads`.
