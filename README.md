# TikTok Metadata Patcher — Web

A client-side Next.js MP4 metadata patcher based on the working FAST/V1 approach:
only `mvhd` and the video track's `mdhd` timing metadata are changed.

## Important

- The video is processed locally in the browser.
- No upload/server API is used.
- It does not decode or re-encode the video.
- 60 FPS uses divider 2.
- 120 FPS uses divider 4.
- The implementation uses 64-bit MP4 offsets and skips the huge `mdat` during inspection.
- On Chromium browsers with the File System Access API, output is streamed directly to disk in 32 MiB chunks. This is the recommended path for multi-GB files.
- Other browsers fall back to a Blob download, which can have browser-specific size limits.

## Run locally

```bash
npm install
npm run dev
```

## GitHub Pages

Push to a GitHub repository on `main`, enable **Settings → Pages → Source: GitHub Actions**, and the included workflow will build/deploy the static Next.js export.

The workflow automatically sets the repository-name base path.

## Caveat

This intentionally reproduces the working metadata approach rather than attempting the V2 `tkhd`/`elst` changes that caused mobile slow-motion in testing.
