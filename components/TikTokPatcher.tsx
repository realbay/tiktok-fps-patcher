"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Box = {
  offset: number;
  size: number;
  headerSize: number;
  type: string;
};

type Patch = {
  offset: number;
  bytes: Uint8Array;
  label: string;
};

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
  "edts",
  "dinf",
  "mvex",
  "moof",
  "traf",
  "meta",
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

async function findMoov(file: File): Promise<Box> {
  const box = await findTopLevel(file, "moov");

  if (!box) {
    throw new Error("Could not find an MP4 moov box.");
  }

  return box;
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

  const buf = await file
    .slice(base, base + len)
    .arrayBuffer();

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

  const buf = await file
    .slice(base, base + len)
    .arrayBuffer();

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

  // stts is normally tiny; read it in bounded chunks.
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

function toStandaloneArrayBuffer(
  bytes: Uint8Array,
): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
}

async function inspectAndBuildPatch(
  file: File,
  divider: number,
) {
  const moov = await findMoov(file);

  let mvhd: Box | undefined;

  const tracks: TrackInfo[] = [];

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

      if (
        currentTrack &&
        box.type === "mdhd"
      ) {
        currentTrack.mdhd = box;

        const md = await readMdhd(file, box);

        currentTrack.timescale = md.timescale;
      }

      if (
        currentTrack &&
        box.type === "hdlr"
      ) {
        currentTrack.handler =
          await readHandlerType(file, box);
      }

      if (
        currentTrack &&
        box.type === "stts"
      ) {
        currentTrack.stts = box;
      }
    },
  );

  if (!mvhd) {
    throw new Error("Could not find mvhd.");
  }

  const mv = await readMvhd(file, mvhd);

  const video = tracks.find(
    (track) =>
      track.handler === "vide" &&
      track.mdhd &&
      track.timescale &&
      track.stts,
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

  const expected = divider === 4 ? 120 : 60;

  if (Math.abs(fps - expected) > 5) {
    throw new Error(
      `Detected approximately ${fps.toFixed(
        3,
      )} FPS, not ${expected} FPS.`,
    );
  }

  const patches: Patch[] = [];

  /*
   * IMPORTANT:
   *
   * This intentionally patches ONLY:
   *   - mvhd
   *   - every mdhd
   *
   * It does NOT touch:
   *   - tkhd
   *   - elst
   *
   * This preserves the working V1 timing method.
   */

  // -------------------------
  // mvhd
  // -------------------------

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

  const mvBase = mvhd.headerSize + 4;

  const mvTimescaleOffset =
    mv.version === 1
      ? mvBase + 16
      : mvBase + 8;

  const mvDurationOffset =
    mv.version === 1
      ? mvBase + 20
      : mvBase + 12;

  const newMvTimescale = Math.max(
    1,
    Math.floor(
      mv.timescale / divider,
    ),
  );

  const newMvDuration = Math.max(
    1,
    Math.floor(
      mv.duration / divider,
    ),
  );

  putU32(
    mvView,
    mvTimescaleOffset,
    newMvTimescale,
  );

  if (mv.version === 1) {
    putU64(
      mvView,
      mvDurationOffset,
      newMvDuration,
    );
  } else {
    putU32(
      mvView,
      mvDurationOffset,
      newMvDuration,
    );
  }

  patches.push({
    offset: mvhd.offset,
    bytes: mvBytes,
    label: "mvhd",
  });

  // -------------------------
  // Every mdhd
  // -------------------------

  let mdhdCount = 0;

  for (const track of tracks) {
    if (!track.mdhd || !track.timescale) {
      continue;
    }

    const md = await readMdhd(
      file,
      track.mdhd,
    );

    const mdBytes = new Uint8Array(
      await file
        .slice(
          track.mdhd.offset,
          track.mdhd.offset +
            track.mdhd.size,
        )
        .arrayBuffer(),
    );

    const mdView = new DataView(
      mdBytes.buffer,
    );

    const mdBase =
      track.mdhd.headerSize + 4;

    const mdTimescaleOffset =
      md.version === 1
        ? mdBase + 16
        : mdBase + 8;

    const mdDurationOffset =
      md.version === 1
        ? mdBase + 20
        : mdBase + 12;

    const newMdTimescale = Math.max(
      1,
      Math.floor(
        md.timescale / divider,
      ),
    );

    const newMdDuration = Math.max(
      1,
      Math.floor(
        md.duration / divider,
      ),
    );

    putU32(
      mdView,
      mdTimescaleOffset,
      newMdTimescale,
    );

    if (md.version === 1) {
      putU64(
        mdView,
        mdDurationOffset,
        newMdDuration,
      );
    } else {
      putU32(
        mdView,
        mdDurationOffset,
        newMdDuration,
      );
    }

    patches.push({
      offset: track.mdhd.offset,
      bytes: mdBytes,
      label: "mdhd",
    });

    mdhdCount++;
  }

  patches.sort(
    (a, b) => a.offset - b.offset,
  );

  const originalDuration =
    mv.duration / mv.timescale;

  const outputDuration =
    newMvDuration / newMvTimescale;

  return {
    patches,
    fps,
    originalDuration,
    outputDuration,
    divider,
    mdhdCount,
  };
}

async function saveWithFileSystemAccess(
  file: File,
  patches: Patch[],
  name: string,
) {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (
        options?: unknown,
      ) => Promise<{
        createWritable: () => Promise<{
          write: (
            data:
              | ArrayBuffer
              | Uint8Array,
          ) => Promise<void>;
          close: () => Promise<void>;
          abort: () => Promise<void>;
        }>;
      }>;
    }
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
        toStandaloneArrayBuffer(
          patch.bytes,
        ),
      );

      sourcePos =
        patch.offset +
        patch.bytes.byteLength;
    }

    while (sourcePos < file.size) {
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
  } catch (error) {
    try {
      await writable.abort();
    } catch {}

    throw error;
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

    parts.push(
      toStandaloneArrayBuffer(
        patch.bytes,
      ),
    );

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

  const [resolution, setResolution] =
    useState<string | null>(null);

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null);

  const [mdhdCount, setMdhdCount] =
    useState<number | null>(null);

  const [status, setStatus] = useState(
    "Drop a 60 or 120 FPS MP4 to begin.",
  );

  const [busy, setBusy] =
    useState(false);

  const [dragging, setDragging] =
    useState(false);

  const [error, setError] =
    useState("");

  const supportsDirectSave = useMemo(
    () =>
      typeof window !== "undefined" &&
      "showSaveFilePicker" in window,
    [],
  );

  /*
   * Create a lightweight browser preview.
   * This does NOT load the entire video into memory.
   */
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setResolution(null);
      return;
    }

    const url =
      URL.createObjectURL(file);

    setPreviewUrl(url);

    const video =
      document.createElement("video");

    video.preload = "metadata";

    const handleMetadata = () => {
      if (
        video.videoWidth &&
        video.videoHeight
      ) {
        setResolution(
          `${video.videoWidth} × ${video.videoHeight}`,
        );
      }
    };

    video.addEventListener(
      "loadedmetadata",
      handleMetadata,
    );

    video.src = url;

    return () => {
      video.removeEventListener(
        "loadedmetadata",
        handleMetadata,
      );

      video.removeAttribute("src");
      video.load();

      URL.revokeObjectURL(url);
    };
  }, [file]);

  const inspect = useCallback(
    async (selected: File) => {
      if (
        !selected.name
          .toLowerCase()
          .endsWith(".mp4")
      ) {
        setError(
          "Please choose an MP4 file.",
        );
        setStatus(
          "Unsupported file type.",
        );
        return;
      }

      setError("");
      setFile(selected);
      setFps(null);
      setDuration(null);
      setMdhdCount(null);
      setStatus(
        "Reading MP4 timing metadata…",
      );

      try {
        /*
         * Divider 4 = working 120 FPS method.
         */
        const probe =
          await inspectAndBuildPatch(
            selected,
            4,
          );

        setFps(probe.fps);
        setDuration(
          probe.originalDuration,
        );
        setMdhdCount(
          probe.mdhdCount,
        );

        setStatus(
          `Detected ${probe.fps.toFixed(
            2,
          )} FPS • ${formatDuration(
            probe.originalDuration,
          )} • ready to patch.`,
        );
      } catch (firstError) {
        /*
         * If 120 FPS fails, try the 60 FPS
         * divider-2 method.
         */
        try {
          const probe =
            await inspectAndBuildPatch(
              selected,
              2,
            );

          setFps(probe.fps);
          setDuration(
            probe.originalDuration,
          );
          setMdhdCount(
            probe.mdhdCount,
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
            firstError instanceof Error
              ? firstError.message
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

  function removeFile() {
    if (busy) return;

    setFile(null);
    setFps(null);
    setDuration(null);
    setResolution(null);
    setMdhdCount(null);
    setPreviewUrl(null);
    setError("");
    setStatus(
      "Drop a 60 or 120 FPS MP4 to begin.",
    );
  }

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
      /*
       * V1:
       * 120 FPS -> divider 4
       * 60 FPS  -> divider 2
       */
      const divider =
        Math.abs(fps - 120) < 5
          ? 4
          : 2;

      const result =
        await inspectAndBuildPatch(
          file,
          divider,
        );

      const base =
        file.name.replace(
          /\.mp4$/i,
          "",
        );

      const name =
        `${base}_metadata_output.mp4`;

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
          URL.createObjectURL(blob);

        const a =
          document.createElement("a");

        a.href = url;
        a.download = name;

        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60000);
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
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 md:py-12">
      <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        {/* Tool header */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">
              TikTok FPS Patcher
            </h1>

            <p className="mt-0.5 text-xs text-muted-foreground">
              60 / 120 FPS MP4 timing metadata
            </p>
          </div>

          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-xs font-medium">
              Runs locally
            </p>

            <p className="mt-0.5 text-[11px] text-muted-foreground">
              No upload required
            </p>
          </div>
        </div>

        {/* Upload / selected state */}
        {!file ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => {
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);

              const dropped =
                event.dataTransfer.files?.[0];

              if (dropped) {
                void inspect(dropped);
              }
            }}
            className={`m-4 rounded-xl border border-dashed p-8 text-center transition sm:m-5 sm:p-12 ${
              dragging
                ? "border-primary bg-muted/60"
                : "border-border hover:bg-muted/20"
            }`}
          >
            {/* Upload icon */}
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M5 20h14" />
              </svg>
            </div>

            <h2 className="mt-5 text-lg font-semibold">
              Drop your 60 or 120 FPS MP4 here
            </h2>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              Use the MP4 you exported from Blur or
              your normal editing workflow. We only
              change the timing metadata — the video
              itself is not re-encoded.
            </p>

            <label className="mt-6 inline-flex cursor-pointer items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85">
              Choose MP4

              <input
                type="file"
                accept="video/mp4,.mp4"
                className="hidden"
                onChange={(event) => {
                  const selected =
                    event.target.files?.[0];

                  if (selected) {
                    void inspect(selected);
                  }

                  event.currentTarget.value = "";
                }}
              />
            </label>

            <p className="mt-4 text-xs text-muted-foreground">
              MP4 only · 60 / 120 FPS
            </p>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
                {/* Preview */}
                <div className="aspect-video bg-black md:aspect-auto md:min-h-[180px]">
                  {previewUrl ? (
                    <video
                      src={previewUrl}
                      controls
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-white/60">
                      Loading preview…
                    </div>
                  )}
                </div>

                {/* File information */}
                <div className="min-w-0 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {file.name}
                      </p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatBytes(file.size)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={removeFile}
                      disabled={busy}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
                    <InfoItem
                      label="FPS"
                      value={
                        fps
                          ? fps.toFixed(2)
                          : "Reading…"
                      }
                    />

                    <InfoItem
                      label="Duration"
                      value={
                        duration !== null
                          ? formatDuration(
                              duration,
                            )
                          : "Reading…"
                      }
                    />

                    <InfoItem
                      label="Resolution"
                      value={
                        resolution ??
                        "Reading…"
                      }
                    />

                    <InfoItem
                      label="Size"
                      value={formatBytes(
                        file.size,
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* Status / action */}
              <div className="border-t border-border bg-muted/20 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          error
                            ? "bg-red-500"
                            : busy
                              ? "bg-yellow-500"
                              : fps
                                ? "bg-green-500"
                                : "bg-muted-foreground"
                        }`}
                      />

                      <p className="text-sm font-medium">
                        {error
                          ? "Error"
                          : busy
                            ? "Working"
                            : fps
                              ? "Ready"
                              : "Inspecting"}
                      </p>
                    </div>

                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {error || status}
                    </p>

                    {mdhdCount !== null &&
                      !error && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {mdhdCount} mdhd timing{" "}
                          {mdhdCount === 1
                            ? "box"
                            : "boxes"}{" "}
                          will be patched.
                        </p>
                      )}
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
                        className="shrink-0 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85"
                      >
                        {supportsDirectSave
                          ? "Patch & Save MP4"
                          : "Patch & Download MP4"}
                      </button>
                    )}
                </div>

                {error && !busy && (
                  <button
                    type="button"
                    onClick={() =>
                      void inspect(file)
                    }
                    className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>

            {/* Small explanation */}
            <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                No video frames are re-encoded.
              </span>

              <span>
                Large files are processed in chunks.
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-medium">
        {value}
      </p>
    </div>
  );
}

function formatBytes(bytes: number) {
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
    value >= 100 || i === 0 ? 0 : 2,
  )} ${units[i]}`;
}

function formatDuration(seconds: number) {
  const s = Math.max(
    0,
    Math.round(seconds),
  );

  const h = Math.floor(s / 3600);
  const m = Math.floor(
    (s % 3600) / 60,
  );
  const sec = s % 60;

  if (h) {
    return `${h}:${String(m).padStart(
      2,
      "0",
    )}:${String(sec).padStart(2, "0")}`;
  }

  return `${m}:${String(sec).padStart(
    2,
    "0",
  )}`;
}
