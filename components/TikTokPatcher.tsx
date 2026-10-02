"use client";

import { useCallback, useMemo, useState } from "react";

type Box = { offset: number; size: number; headerSize: number; type: string };
type Patch = { offset: number; bytes: Uint8Array; label: string };
type TrackInfo = {
  handler?: string;
  mdhd?: Box;
  timescale?: number;
  stts?: Box;
};

const CONTAINERS = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "dinf",
  "edts",
  "udta",
]);

function u32(view: DataView, o: number) {
  return view.getUint32(o, false);
}

function u64(view: DataView, o: number): number {
  const hi = view.getUint32(o, false);
  const lo = view.getUint32(o + 4, false);
  return hi * 4294967296 + lo;
}

function putU32(view: DataView, o: number, v: number) {
  view.setUint32(o, v >>> 0, false);
}

function putU64(view: DataView, o: number, v: number) {
  const hi = Math.floor(v / 4294967296);
  const lo = v - hi * 4294967296;

  view.setUint32(o, hi >>> 0, false);
  view.setUint32(o + 4, lo >>> 0, false);
}

function ascii(view: DataView, o: number, n: number) {
  let s = "";

  for (let i = 0; i < n; i++) {
    s += String.fromCharCode(view.getUint8(o + i));
  }

  return s;
}

async function readBox(
  file: File,
  offset: number,
  limit: number,
): Promise<Box | null> {
  if (offset + 8 > limit) return null;

  const buf = await file
    .slice(offset, Math.min(offset + 16, limit))
    .arrayBuffer();

  const view = new DataView(buf);

  let size = u32(view, 0);
  const type = ascii(view, 4, 4);
  let headerSize = 8;

  if (size === 1) {
    if (view.byteLength < 16) return null;

    const large = u64(view, 8);

    if (!Number.isSafeInteger(large)) {
      throw new Error("MP4 box is too large for this browser.");
    }

    size = large;
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }

  if (size < headerSize || offset + size > limit) {
    return null;
  }

  return {
    offset,
    size,
    headerSize,
    type,
  };
}

async function scanRange(
  file: File,
  start: number,
  end: number,
  visitor: (box: Box) => Promise<void>,
) {
  let pos = start;

  while (pos + 8 <= end) {
    const box = await readBox(file, pos, end);

    if (!box) break;

    await visitor(box);

    if (CONTAINERS.has(box.type)) {
      const childStart =
        box.offset +
        box.headerSize +
        (box.type === "meta" ? 4 : 0);

      if (childStart < box.offset + box.size) {
        await scanRange(
          file,
          childStart,
          box.offset + box.size,
          visitor,
        );
      }
    }

    pos = box.offset + box.size;
  }
}

async function findMoov(file: File): Promise<Box> {
  const box = await findTopLevel(file, "moov");

  if (!box) {
    throw new Error("Could not find an MP4 moov box.");
  }

  return box;
}

async function findTopLevel(
  file: File,
  wanted: string,
): Promise<Box | null> {
  let pos = 0;

  while (pos + 8 <= file.size) {
    const box = await readBox(file, pos, file.size);

    if (!box) break;

    if (box.type === wanted) {
      return box;
    }

    pos = box.offset + box.size;
  }

  return null;
}

async function readFullBox(file: File, box: Box) {
  const buf = await file
    .slice(
      box.offset + box.headerSize,
      box.offset + box.headerSize + 4,
    )
    .arrayBuffer();

  const view = new DataView(buf);

  return {
    version: view.getUint8(0),
    flags:
      (view.getUint8(1) << 16) |
      (view.getUint8(2) << 8) |
      view.getUint8(3),
  };
}

async function readMdhd(file: File, box: Box) {
  const { version } = await readFullBox(file, box);

  const base = box.offset + box.headerSize + 4;
  const len = version === 1 ? 32 : 20;

  const buf = await file.slice(base, base + len).arrayBuffer();
  const view = new DataView(buf);

  if (version === 1) {
    return {
      version,
      timescale: u32(view, 16),
      duration: u64(view, 20),
    };
  }

  return {
    version,
    timescale: u32(view, 8),
    duration: u32(view, 12),
  };
}

async function readMvhd(file: File, box: Box) {
  const { version } = await readFullBox(file, box);

  const base = box.offset + box.headerSize + 4;
  const len = version === 1 ? 32 : 20;

  const buf = await file.slice(base, base + len).arrayBuffer();
  const view = new DataView(buf);

  if (version === 1) {
    return {
      version,
      timescale: u32(view, 16),
      duration: u64(view, 20),
    };
  }

  return {
    version,
    timescale: u32(view, 8),
    duration: u32(view, 12),
  };
}

async function readHandlerType(file: File, box: Box) {
  // hdlr full box:
  // version/flags, pre_defined, handler_type
  const start = box.offset + box.headerSize + 8;

  const buf = await file
    .slice(start, start + 4)
    .arrayBuffer();

  return ascii(new DataView(buf), 0, 4);
}

async function readSttsAverageFps(
  file: File,
  stts: Box,
  timescale: number,
) {
  const start = stts.offset + stts.headerSize + 4;

  const header = await file
    .slice(start, start + 4)
    .arrayBuffer();

  const count = u32(new DataView(header), 0);

  if (!count) return null;

  let totalSamples = 0;
  let totalDuration = 0;

  const chunkSize = 1024 * 1024;
  const entriesBytes = count * 8;

  if (entriesBytes > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  // stts is normally tiny; read in bounded chunks.
  for (let off = 0; off < entriesBytes; off += chunkSize) {
    const len = Math.min(
      chunkSize,
      entriesBytes - off,
    );

    const buf = await file
      .slice(
        start + 4 + off,
        start + 4 + off + len,
      )
      .arrayBuffer();

    const view = new DataView(buf);

    for (let p = 0; p + 8 <= len; p += 8) {
      const sampleCount = u32(view, p);
      const sampleDelta = u32(view, p + 4);

      totalSamples += sampleCount;
      totalDuration += sampleDelta * sampleCount;
    }
  }

  if (
    !totalDuration ||
    !totalSamples ||
    !timescale
  ) {
    return null;
  }

  return (
    (totalSamples * timescale) /
    totalDuration
  );
}

async function buildPatch(
  file: File,
  divider: number,
) {
  const moov = await findMoov(file);

  let mvhd: Box | undefined;
  const tracks: TrackInfo[] = [];

  // First pass:
  // identify mvhd and each track's
  // mdhd / handler / stts.
  let currentTrack: TrackInfo | null = null;

  await scanRange(
    file,
    moov.offset + moov.headerSize,
    moov.offset + moov.size,
    async (box) => {
      if (box.type === "mvhd") {
        mvhd = box;
      }

      if (box.type === "trak") {
        currentTrack = {};
        tracks.push(currentTrack);
      }

      if (currentTrack && box.type === "mdhd") {
        currentTrack.mdhd = box;

        const md = await readMdhd(file, box);
        currentTrack.timescale = md.timescale;
      }

      if (currentTrack && box.type === "hdlr") {
        currentTrack.handler =
          await readHandlerType(file, box);
      }

      if (currentTrack && box.type === "stts") {
        currentTrack.stts = box;
      }
    },
  );

  if (!mvhd) {
    throw new Error("Could not find mvhd.");
  }

  const mv = await readMvhd(file, mvhd);

  const video = tracks.find(
    (t) =>
      t.handler === "vide" &&
      t.mdhd &&
      t.stts,
  );

  if (
    !video ||
    !video.mdhd ||
    !video.timescale ||
    !video.stts
  ) {
    throw new Error(
      "Could not identify the video track / frame timing.",
    );
  }

  const fps = await readSttsAverageFps(
    file,
    video.stts,
    video.timescale,
  );

  if (!fps) {
    throw new Error(
      "Could not determine the source FPS.",
    );
  }

  const expected =
    divider === 4 ? 120 : 60;

  if (Math.abs(fps - expected) > 5) {
    throw new Error(
      `Detected approximately ${fps.toFixed(
        3,
      )} FPS, not ${expected} FPS.`,
    );
  }

  const patches: Patch[] = [];

  // Read and modify only the small mvhd box.
  const mvBytes = new Uint8Array(
    await file
      .slice(
        mvhd.offset,
        mvhd.offset + mvhd.size,
      )
      .arrayBuffer(),
  );

  const mvView = new DataView(
    mvBytes.buffer,
  );

  const mvBase =
    mvhd.headerSize + 4;

  const mvTs =
    mv.version === 1
      ? mvBase + 16
      : mvBase + 8;

  const mvDur =
    mv.version === 1
      ? mvBase + 20
      : mvBase + 12;

  const newMvTs = Math.max(
    1,
    Math.floor(mv.timescale / divider),
  );

  const newMvDur = Math.max(
    1,
    Math.floor(mv.duration / divider),
  );

  putU32(
    mvView,
    mvTs,
    newMvTs,
  );

  if (mv.version === 1) {
    putU64(
      mvView,
      mvDur,
      newMvDur,
    );
  } else {
    putU32(
      mvView,
      mvDur,
      newMvDur,
    );
  }

  patches.push({
    offset: mvhd.offset,
    bytes: mvBytes,
    label: "mvhd",
  });

  const md = await readMdhd(
    file,
    video.mdhd,
  );

  const mdBytes = new Uint8Array(
    await file
      .slice(
        video.mdhd.offset,
        video.mdhd.offset +
          video.mdhd.size,
      )
      .arrayBuffer(),
  );

  const mdView = new DataView(
    mdBytes.buffer,
  );

  const mdBase =
    video.mdhd.headerSize + 4;

  const mdTs =
    md.version === 1
      ? mdBase + 16
      : mdBase + 8;

  const mdDur =
    md.version === 1
      ? mdBase + 20
      : mdBase + 12;

  const newMdTs = Math.max(
    1,
    Math.floor(md.timescale / divider),
  );

  const newMdDur = Math.max(
    1,
    Math.floor(md.duration / divider),
  );

  putU32(
    mdView,
    mdTs,
    newMdTs,
  );

  if (md.version === 1) {
    putU64(
      mdView,
      mdDur,
      newMdDur,
    );
  } else {
    putU32(
      mdView,
      mdDur,
      newMdDur,
    );
  }

  patches.push({
    offset: video.mdhd.offset,
    bytes: mdBytes,
    label: "mdhd",
  });

  patches.sort(
    (a, b) => a.offset - b.offset,
  );

  const originalDuration =
    mv.duration / mv.timescale;

  const outputDuration =
    newMvDur / newMvTs;

  return {
    patches,
    fps,
    originalDuration,
    outputDuration,
    divider,
  };
}

async function saveWithFileSystemAccess(
  file: File,
  patches: Patch[],
  name: string,
) {
  const picker = (
    window as any
  ).showSaveFilePicker;

  if (!picker) {
    return false;
  }

  const handle = await picker({
    suggestedName: name,
    types: [
      {
        description: "MP4 video",
        accept: {
          "video/mp4": [".mp4"],
        },
      },
    ],
  });

  const writable =
    await handle.createWritable();

  let sourcePos = 0;

  const CHUNK =
    32 * 1024 * 1024;

  try {
    for (const patch of patches) {
      while (
        sourcePos < patch.offset
      ) {
        const end = Math.min(
          patch.offset,
          sourcePos + CHUNK,
        );

        await writable.write(
          await file
            .slice(sourcePos, end)
            .arrayBuffer(),
        );

        sourcePos = end;
      }

      await writable.write(
        patch.bytes,
      );

      sourcePos =
        patch.offset +
        patch.bytes.byteLength;
    }

    while (
      sourcePos < file.size
    ) {
      const end = Math.min(
        file.size,
        sourcePos + CHUNK,
      );

      await writable.write(
        await file
          .slice(sourcePos, end)
          .arrayBuffer(),
      );

      sourcePos = end;
    }

    await writable.close();

    return true;
  } catch (e) {
    try {
      await writable.abort();
    } catch {}

    throw e;
  }
}

function makeBlob(
  file: File,
  patches: Patch[],
) {
  const parts: BlobPart[] = [];
  let pos = 0;

  for (const patch of patches) {
    if (pos < patch.offset) {
      parts.push(
        file.slice(
          pos,
          patch.offset,
        ),
      );
    }

    /*
     * Convert the Uint8Array into a plain
     * ArrayBuffer so newer TypeScript /
     * DOM typings accept it as a BlobPart.
     */
    const bytes = new Uint8Array(
      patch.bytes,
    );

    const buffer =
      new ArrayBuffer(
        bytes.byteLength,
      );

    new Uint8Array(buffer).set(
      bytes,
    );

    parts.push(buffer);

    pos =
      patch.offset +
      patch.bytes.byteLength;
  }

  if (pos < file.size) {
    parts.push(
      file.slice(pos),
    );
  }

  return new Blob(parts, {
    type: "video/mp4",
  });
}

export default function TikTokPatcher() {
  const [file, setFile] =
    useState<File | null>(null);

  const [fps, setFps] =
    useState<number | null>(null);

  const [duration, setDuration] =
    useState<number | null>(null);

  const [status, setStatus] =
    useState(
      "Drop a 60 or 120 FPS MP4 to begin.",
    );

  const [busy, setBusy] =
    useState(false);

  const [dragging, setDragging] =
    useState(false);

  const [error, setError] =
    useState("");

  const supportsDirectSave =
    useMemo(
      () =>
        typeof window !==
          "undefined" &&
        "showSaveFilePicker" in
          window,
      [],
    );

  const inspect = useCallback(
    async (selected: File) => {
      setError("");
      setFile(selected);
      setFps(null);
      setDuration(null);

      setStatus(
        "Reading MP4 timing metadata…",
      );

      try {
        const probe =
          await buildPatch(
            selected,
            4,
          );

        setFps(probe.fps);
        setDuration(
          probe.originalDuration,
        );

        setStatus(
          `Detected ${probe.fps.toFixed(
            2,
          )} FPS • ${formatDuration(
            probe.originalDuration,
          )} • ready to patch.`,
        );
      } catch (e) {
        // If 120 fails, try 60.
        try {
          const probe =
            await buildPatch(
              selected,
              2,
            );

          setFps(probe.fps);
          setDuration(
            probe.originalDuration,
          );

          setStatus(
            `Detected ${probe.fps.toFixed(
              2,
            )} FPS • ${formatDuration(
              probe.originalDuration,
            )} • ready to patch.`,
          );
        } catch {
          setError(
            e instanceof Error
              ? e.message
              : "Could not inspect this MP4.",
          );

          setStatus(
            "Could not inspect the file.",
          );
        }
      }
    },
    [],
  );

  async function patch() {
    if (!file || !fps) {
      return;
    }

    setBusy(true);
    setError("");
    setStatus(
      "Preparing patch…",
    );

    try {
      const divider =
        Math.abs(fps - 120) < 5
          ? 4
          : 2;

      const result =
        await buildPatch(
          file,
          divider,
        );

      const base =
        file.name.replace(
          /\.mp4$/i,
          "",
        );

      const name = `${base}_metadata_output.mp4`;

      if (supportsDirectSave) {
        setStatus(
          "Writing patched MP4 directly to disk…",
        );

        await saveWithFileSystemAccess(
          file,
          result.patches,
          name,
        );
      } else {
        setStatus(
          "Preparing browser download…",
        );

        const blob = makeBlob(
          file,
          result.patches,
        );

        const url =
          URL.createObjectURL(
            blob,
          );

        const a =
          document.createElement(
            "a",
          );

        a.href = url;
        a.download = name;
        a.click();

        setTimeout(
          () =>
            URL.revokeObjectURL(
              url,
            ),
          60000,
        );
      }

      setStatus(
        `Done • ${formatDuration(
          result.outputDuration,
        )} duration preserved.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Patch failed.",
      );

      setStatus(
        "Patch failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-14 md:py-20">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-10">
          <p className="text-sm font-medium text-muted-foreground">
            MP4 metadata utility
          </p>

          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            TikTok Metadata Patcher
          </h1>

          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Patch the working 60/120 FPS timing signal locally in your browser. Your video is never uploaded.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() =>
            setDragging(false)
          }
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);

            const dropped =
              e.dataTransfer.files?.[0];

            if (dropped) {
              void inspect(dropped);
            }
          }}
          className={`rounded-2xl border p-8 transition-all md:p-12 ${
            dragging
              ? "border-primary bg-muted/70"
              : "border-border bg-background"
          }`}
        >
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-xl">
              MP4
            </div>

            <h2 className="mt-5 text-xl font-semibold">
              Drop your video here
            </h2>

            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Large files are handled without loading the entire video into memory. Chrome/Edge can write the output directly to disk.
            </p>

            <label className="mt-6 cursor-pointer rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85">
              Choose MP4

              <input
                type="file"
                accept="video/mp4,.mp4"
                className="hidden"
                onChange={(e) => {
                  const selected =
                    e.target.files?.[0];

                  if (selected) {
                    void inspect(
                      selected,
                    );
                  }
                }}
              />
            </label>
          </div>
        </div>

        {file && (
          <div className="mt-5 rounded-xl border border-border bg-muted/40 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {file.name}
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {formatBytes(
                    file.size,
                  )}
                </p>
              </div>

              <div className="text-sm text-muted-foreground">
                {fps
                  ? `${fps.toFixed(
                      2,
                    )} FPS`
                  : "Inspecting…"}

                {duration !== null
                  ? ` • ${formatDuration(
                      duration,
                    )}`
                  : ""}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl border border-border p-5">
          <div className="flex items-start gap-3">
            <div
              className={`mt-1 h-2.5 w-2.5 rounded-full ${
                error
                  ? "bg-red-500"
                  : busy
                    ? "bg-yellow-500"
                    : "bg-green-500"
              }`}
            />

            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {error
                  ? "Error"
                  : busy
                    ? "Working"
                    : "Status"}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {error || status}
              </p>
            </div>
          </div>

          {file &&
            fps &&
            !busy &&
            !error && (
              <button
                type="button"
                onClick={() =>
                  void patch()
                }
                className="mt-5 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-85"
              >
                {supportsDirectSave
                  ? "Patch & Save MP4"
                  : "Patch & Download MP4"}
              </button>
            )}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            [
              "Local",
              "The video stays in your browser.",
            ],
            [
              "No re-encode",
              "Only MP4 timing metadata is changed.",
            ],
            [
              "Large-file ready",
              "Uses chunked disk writes where supported.",
            ],
          ].map(
            ([title, text]) => (
              <div
                key={title}
                className="rounded-xl border border-border p-4"
              >
                <p className="text-sm font-semibold">
                  {title}
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {text}
                </p>
              </div>
            ),
          )}
        </div>
      </div>
    </main>
  );
}

function formatBytes(
  bytes: number,
) {
  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let value = bytes;
  let i = 0;

  while (
    value >= 1024 &&
    i < units.length - 1
  ) {
    value /= 1024;
    i++;
  }

  return `${value.toFixed(
    value >= 100 || i === 0
      ? 0
      : 2,
  )} ${units[i]}`;
}

function formatDuration(
  seconds: number,
) {
  const s = Math.max(
    0,
    Math.round(seconds),
  );

  const h = Math.floor(
    s / 3600,
  );

  const m = Math.floor(
    (s % 3600) / 60,
  );

  const sec = s % 60;

  return h
    ? `${h}:${String(m).padStart(
        2,
        "0",
      )}:${String(sec).padStart(
        2,
        "0",
      )}`
    : `${m}:${String(sec).padStart(
        2,
        "0",
      )}`;
}
