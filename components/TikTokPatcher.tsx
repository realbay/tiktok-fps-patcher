"use client";

import {
  Check,
  FileVideo,
  HardDrive,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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
  mdhd?: Box;
  timescale?: number;
  handler?: string;
  stts?: Box;
};

type ProbeResult = {
  patches: Patch[];
  fps: number;
  originalDuration: number;
  outputDuration: number;
  divider: number;
  mdhdCount: number;
  width: number | null;
  height: number | null;
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

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, false);
}

function u64(view: DataView, offset: number): number {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  return hi * 4294967296 + lo;
}

function putU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, false);
}

function putU64(view: DataView, offset: number, value: number) {
  const hi = Math.floor(value / 4294967296);
  const lo = value - hi * 4294967296;

  view.setUint32(offset, hi >>> 0, false);
  view.setUint32(offset + 4, lo >>> 0, false);
}

function ascii(view: DataView, offset: number, length: number) {
  let result = "";

  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(view.getUint8(offset + i));
  }

  return result;
}

async function readBox(
  file: File,
  offset: number,
  limit: number,
): Promise<Box | null> {
  if (offset + 8 > limit) {
    return null;
  }

  const buffer = await file
    .slice(offset, Math.min(offset + 16, limit))
    .arrayBuffer();

  const view = new DataView(buffer);

  let size = u32(view, 0);
  const type = ascii(view, 4, 4);
  let headerSize = 8;

  if (size === 1) {
    if (view.byteLength < 16) {
      return null;
    }

    const largeSize = u64(view, 8);

    if (!Number.isSafeInteger(largeSize)) {
      throw new Error("MP4 box is too large for this browser.");
    }

    size = largeSize;
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
  let position = start;

  while (position + 8 <= end) {
    const box = await readBox(file, position, end);

    if (!box) {
      break;
    }

    await visitor(box);

    if (CONTAINERS.has(box.type)) {
      const childStart =
        box.offset +
        box.headerSize +
        (box.type === "meta" ? 4 : 0);

      const childEnd = box.offset + box.size;

      if (childStart < childEnd) {
        await scanRange(file, childStart, childEnd, visitor);
      }
    }

    position = box.offset + box.size;
  }
}

async function findTopLevel(
  file: File,
  wanted: string,
): Promise<Box | null> {
  let position = 0;

  while (position + 8 <= file.size) {
    const box = await readBox(file, position, file.size);

    if (!box) {
      break;
    }

    if (box.type === wanted) {
      return box;
    }

    position = box.offset + box.size;
  }

  return null;
}

async function findMoov(file: File) {
  const moov = await findTopLevel(file, "moov");

  if (!moov) {
    throw new Error("Could not find an MP4 moov box.");
  }

  return moov;
}

async function readFullBox(file: File, box: Box) {
  const buffer = await file
    .slice(
      box.offset + box.headerSize,
      box.offset + box.headerSize + 4,
    )
    .arrayBuffer();

  const view = new DataView(buffer);

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

  if (version === 1) {
    const buffer = await file
      .slice(base, base + 32)
      .arrayBuffer();

    const view = new DataView(buffer);

    return {
      version,
      timescale: u32(view, 16),
      duration: u64(view, 20),
    };
  }

  const buffer = await file
    .slice(base, base + 20)
    .arrayBuffer();

  const view = new DataView(buffer);

  return {
    version,
    timescale: u32(view, 8),
    duration: u32(view, 12),
  };
}

async function readMvhd(file: File, box: Box) {
  const { version } = await readFullBox(file, box);

  const base = box.offset + box.headerSize + 4;

  if (version === 1) {
    const buffer = await file
      .slice(base, base + 32)
      .arrayBuffer();

    const view = new DataView(buffer);

    return {
      version,
      timescale: u32(view, 16),
      duration: u64(view, 20),
    };
  }

  const buffer = await file
    .slice(base, base + 20)
    .arrayBuffer();

  const view = new DataView(buffer);

  return {
    version,
    timescale: u32(view, 8),
    duration: u32(view, 12),
  };
}

async function readHandlerType(file: File, box: Box) {
  // hdlr:
  // version/flags = 4 bytes
  // pre_defined = 4 bytes
  // handler_type = 4 bytes
  const start = box.offset + box.headerSize + 8;

  const buffer = await file
    .slice(start, start + 4)
    .arrayBuffer();

  return ascii(new DataView(buffer), 0, 4);
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

  if (!count) {
    return null;
  }

  let totalSamples = 0;
  let totalDuration = 0;

  const chunkSize = 1024 * 1024;
  const entriesBytes = count * 8;

  if (!Number.isSafeInteger(entriesBytes)) {
    return null;
  }

  for (
    let offset = 0;
    offset < entriesBytes;
    offset += chunkSize
  ) {
    const length = Math.min(
      chunkSize,
      entriesBytes - offset,
    );

    const buffer = await file
      .slice(
        start + 4 + offset,
        start + 4 + offset + length,
      )
      .arrayBuffer();

    const view = new DataView(buffer);

    for (let position = 0; position + 8 <= length; position += 8) {
      const sampleCount = u32(view, position);
      const sampleDelta = u32(view, position + 4);

      totalSamples += sampleCount;
      totalDuration += sampleCount * sampleDelta;
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

async function getTopLevelMoovChildren(
  file: File,
  moov: Box,
) {
  const children: Box[] = [];

  let position = moov.offset + moov.headerSize;

  while (position + 8 <= moov.offset + moov.size) {
    const box = await readBox(
      file,
      position,
      moov.offset + moov.size,
    );

    if (!box) {
      break;
    }

    children.push(box);
    position = box.offset + box.size;
  }

  return children;
}

async function inspectTrack(
  file: File,
  trak: Box,
): Promise<TrackInfo> {
  const track: TrackInfo = {};

  await scanRange(
    file,
    trak.offset + trak.headerSize,
    trak.offset + trak.size,
    async (box) => {
      if (box.type === "mdhd") {
        track.mdhd = box;

        const mdhd = await readMdhd(file, box);
        track.timescale = mdhd.timescale;
      }

      if (box.type === "hdlr") {
        track.handler = await readHandlerType(file, box);
      }

      if (box.type === "stts") {
        track.stts = box;
      }
    },
  );

  return track;
}

async function buildPatch(
  file: File,
  divider: number,
): Promise<ProbeResult> {
  const moov = await findMoov(file);

  const moovChildren = await getTopLevelMoovChildren(
    file,
    moov,
  );

  const mvhd = moovChildren.find(
    (box) => box.type === "mvhd",
  );

  if (!mvhd) {
    throw new Error("Could not find mvhd.");
  }

  const trakBoxes = moovChildren.filter(
    (box) => box.type === "trak",
  );

  const tracks: TrackInfo[] = [];

  for (const trak of trakBoxes) {
    tracks.push(
      await inspectTrack(file, trak),
    );
  }

  const allMdhd = tracks
    .map((track) => track.mdhd)
    .filter((box): box is Box => Boolean(box));

  if (!allMdhd.length) {
    throw new Error("Could not find any mdhd boxes.");
  }

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

  const mv = await readMvhd(file, mvhd);

  const patches: Patch[] = [];

  // Patch mvhd.
  {
    const bytes = new Uint8Array(
      await file
        .slice(
          mvhd.offset,
          mvhd.offset + mvhd.size,
        )
        .arrayBuffer(),
    );

    const view = new DataView(bytes.buffer);
    const base = mvhd.headerSize + 4;

    const timescaleOffset =
      mv.version === 1
        ? base + 16
        : base + 8;

    const durationOffset =
      mv.version === 1
        ? base + 20
        : base + 12;

    const newTimescale = Math.max(
      1,
      Math.floor(mv.timescale / divider),
    );

    const newDuration = Math.max(
      1,
      Math.floor(mv.duration / divider),
    );

    putU32(
      view,
      timescaleOffset,
      newTimescale,
    );

    if (mv.version === 1) {
      putU64(
        view,
        durationOffset,
        newDuration,
      );
    } else {
      putU32(
        view,
        durationOffset,
        newDuration,
      );
    }

    patches.push({
      offset: mvhd.offset,
      bytes,
      label: "mvhd",
    });
  }

  // Patch EVERY mdhd.
  for (const mdhd of allMdhd) {
    const metadata = await readMdhd(
      file,
      mdhd,
    );

    const bytes = new Uint8Array(
      await file
        .slice(
          mdhd.offset,
          mdhd.offset + mdhd.size,
        )
        .arrayBuffer(),
    );

    const view = new DataView(bytes.buffer);
    const base = mdhd.headerSize + 4;

    const timescaleOffset =
      metadata.version === 1
        ? base + 16
        : base + 8;

    const durationOffset =
      metadata.version === 1
        ? base + 20
        : base + 12;

    const newTimescale = Math.max(
      1,
      Math.floor(
        metadata.timescale / divider,
      ),
    );

    const newDuration = Math.max(
      1,
      Math.floor(
        metadata.duration / divider,
      ),
    );

    putU32(
      view,
      timescaleOffset,
      newTimescale,
    );

    if (metadata.version === 1) {
      putU64(
        view,
        durationOffset,
        newDuration,
      );
    } else {
      putU32(
        view,
        durationOffset,
        newDuration,
      );
    }

    patches.push({
      offset: mdhd.offset,
      bytes,
      label: "mdhd",
    });
  }

  patches.sort(
    (a, b) => a.offset - b.offset,
  );

  const newMvTimescale = Math.max(
    1,
    Math.floor(mv.timescale / divider),
  );

  const newMvDuration = Math.max(
    1,
    Math.floor(mv.duration / divider),
  );

  return {
    patches,
    fps,
    originalDuration:
      mv.duration / mv.timescale,
    outputDuration:
      newMvDuration / newMvTimescale,
    divider,
    mdhdCount: allMdhd.length,
    width: null,
    height: null,
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
            data: ArrayBuffer | Uint8Array,
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

  let sourcePosition = 0;
  const chunkSize =
    32 * 1024 * 1024;

  try {
    for (const patch of patches) {
      while (
        sourcePosition < patch.offset
      ) {
        const end = Math.min(
          patch.offset,
          sourcePosition + chunkSize,
        );

        await writable.write(
          await file
            .slice(sourcePosition, end)
            .arrayBuffer(),
        );

        sourcePosition = end;
      }

      await writable.write(patch.bytes);

      sourcePosition =
        patch.offset +
        patch.bytes.byteLength;
    }

    while (
      sourcePosition < file.size
    ) {
      const end = Math.min(
        file.size,
        sourcePosition + chunkSize,
      );

      await writable.write(
        await file
          .slice(sourcePosition, end)
          .arrayBuffer(),
      );

      sourcePosition = end;
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

function copyForBlob(
  bytes: Uint8Array,
): ArrayBuffer {
  const copy = new Uint8Array(
    bytes.byteLength,
  );

  copy.set(bytes);

  return copy.buffer;
}

function makeBlob(
  file: File,
  patches: Patch[],
) {
  const parts: BlobPart[] = [];

  let position = 0;

  for (const patch of patches) {
    if (position < patch.offset) {
      parts.push(
        file.slice(
          position,
          patch.offset,
        ),
      );
    }

    parts.push(
      copyForBlob(patch.bytes),
    );

    position =
      patch.offset +
      patch.bytes.byteLength;
  }

  if (position < file.size) {
    parts.push(
      file.slice(position),
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

  const [mdhdCount, setMdhdCount] =
    useState<number | null>(null);

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null);

  const [status, setStatus] = useState(
    "Drop your 60 or 120 FPS MP4 here.",
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

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url =
      URL.createObjectURL(file);

    setPreviewUrl(url);

    return () => {
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
      setResolution(null);
      setMdhdCount(null);
      setStatus(
        "Reading MP4 timing metadata…",
      );

      try {
        const probe = await buildPatch(
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
        try {
          const probe = await buildPatch(
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

      const outputName =
        `${base}_metadata_output.mp4`;

      if (supportsDirectSave) {
        setStatus(
          "Writing patched MP4 directly to disk…",
        );

        await saveWithFileSystemAccess(
          file,
          result.patches,
          outputName,
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

        const anchor =
          document.createElement("a");

        anchor.href = url;
        anchor.download = outputName;
        anchor.click();

        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60_000);
      }

      setStatus(
        `Done • ${formatDuration(
          result.outputDuration,
        )} duration preserved • ${
          result.mdhdCount
        } mdhd boxes patched.`,
      );
    } catch (patchError) {
      setError(
        patchError instanceof Error
          ? patchError.message
          : "Patch failed.",
      );

      setStatus("Patch failed.");
    } finally {
      setBusy(false);
    }
  }

  const handleVideoMetadata = (
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) => {
    const video = event.currentTarget;

    if (
      video.videoWidth &&
      video.videoHeight
    ) {
      setResolution(
        `${video.videoWidth} × ${video.videoHeight}`,
      );
    }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#111214] px-4 py-8 text-[#f2f3f5] sm:px-6 md:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#949ba4]">
            Local MP4 utility
          </p>

          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                TikTok FPS Patcher
              </h1>

              <p className="mt-1 text-sm text-[#b5bac1]">
                Patch 60 / 120 FPS timing metadata
                without re-encoding.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#18191c] px-3 py-1.5 text-xs text-[#b5bac1]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Runs locally
            </div>
          </div>
        </div>

        <section
          className={`overflow-hidden rounded-2xl border border-white/[0.08] bg-[#18191c] shadow-2xl shadow-black/20 ${
            dragging
              ? "ring-2 ring-white/20"
              : ""
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() =>
            setDragging(false)
          }
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);

            const dropped =
              event.dataTransfer.files?.[0];

            if (dropped) {
              void inspect(dropped);
            }
          }}
        >
          <div className="flex min-h-[430px] items-center p-5 sm:p-8">
            {!file ? (
              <div
                className={`flex min-h-[350px] w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center transition-colors ${
                  dragging
                    ? "border-white/30 bg-white/[0.04]"
                    : "border-white/[0.10] bg-[#1e1f22]/60"
                }`}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#18191c]">
                  <FileVideo className="h-6 w-6 text-[#b5bac1]" />
                </div>

                <h2 className="mt-5 text-lg font-semibold">
                  Drop your 60 or 120 FPS MP4 here
                </h2>

                <p className="mt-2 max-w-lg text-sm leading-6 text-[#949ba4]">
                  Use the MP4 you exported from Blur
                  or your usual editing workflow.
                  Only the timing metadata is changed.
                  The video is never re-encoded.
                </p>

                <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#f2f3f5] px-4 py-2.5 text-sm font-semibold text-[#111214] transition hover:bg-white">
                  <Upload className="h-4 w-4" />
                  Choose MP4

                  <input
                    type="file"
                    accept="video/mp4,.mp4"
                    className="hidden"
                    onChange={(event) => {
                      const selected =
                        event.target.files?.[0];

                      if (selected) {
                        void inspect(
                          selected,
                        );
                      }

                      event.target.value =
                        "";
                    }}
                  />
                </label>

                <p className="mt-3 text-xs text-[#727780]">
                  MP4 only · 60 / 120 FPS
                </p>
              </div>
            ) : (
              <div className="grid w-full items-center gap-8 md:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
                <div className="w-full">
                  <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black">
                    {previewUrl ? (
                      <video
                        src={previewUrl}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={
                          handleVideoMetadata
                        }
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-[#949ba4]" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">
                        {file.name}
                      </p>

                      <p className="mt-1 text-sm text-[#949ba4]">
                        {formatBytes(
                          file.size,
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-full border border-white/[0.07] bg-[#1e1f22] px-3 py-1 text-xs text-[#b5bac1]">
                      MP4
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2">
                    <InfoItem
                      label="FPS"
                      value={
                        fps
                          ? `${fps.toFixed(
                              2,
                            )}`
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
                      label="Metadata"
                      value={
                        mdhdCount !== null
                          ? `${mdhdCount} mdhd`
                          : "Reading…"
                      }
                    />
                  </div>

                  <div className="mt-5 rounded-xl border border-white/[0.07] bg-[#1e1f22]/70 p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          error
                            ? "bg-red-500/10 text-red-400"
                            : busy
                              ? "bg-yellow-500/10 text-yellow-400"
                              : fps
                                ? "bg-green-500/10 text-green-400"
                                : "bg-white/5 text-[#949ba4]"
                        }`}
                      >
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : error ? (
                          <span className="text-xs">
                            !
                          </span>
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {error
                            ? "Error"
                            : busy
                              ? "Working"
                              : "Status"}
                        </p>

                        <p className="mt-1 text-xs leading-5 text-[#949ba4]">
                          {error ||
                            status}
                        </p>
                      </div>
                    </div>
                  </div>

                  {fps &&
                    !busy &&
                    !error && (
                      <button
                        type="button"
                        onClick={() =>
                          void patch()
                        }
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#f2f3f5] px-5 py-3 text-sm font-semibold text-[#111214] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <HardDrive className="h-4 w-4" />
                        {supportsDirectSave
                          ? "Patch & Save MP4"
                          : "Patch & Download MP4"}
                      </button>
                    )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-white/[0.07] bg-[#18191c] px-5 py-4 text-xs text-[#727780] sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <span>
              No video frames are re-encoded.
            </span>

            <span>
              Large files are processed in chunks.
            </span>
          </div>
        </section>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Feature
            title="Local"
            description="Your MP4 stays in your browser."
          />

          <Feature
            title="No re-encode"
            description="Only MP4 timing metadata is changed."
          />

          <Feature
            title="Large-file ready"
            description="Chrome/Edge can write directly to disk."
          />
        </div>
      </div>
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
    <div className="rounded-lg border border-white/[0.06] bg-[#1e1f22] px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#727780]">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-medium text-[#dcdee1]">
        {value}
      </p>
    </div>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#18191c] px-4 py-3">
      <p className="text-sm font-medium text-[#dcdee1]">
        {title}
      </p>

      <p className="mt-1 text-xs leading-5 text-[#727780]">
        {description}
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
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(
    value >= 100 || index === 0
      ? 0
      : 2,
  )} ${units[index]}`;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(
    0,
    Math.round(seconds),
  );

  const hours = Math.floor(
    totalSeconds / 3600,
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  );

  const remainingSeconds =
    totalSeconds % 60;

  if (hours) {
    return `${hours}:${String(
      minutes,
    ).padStart(
      2,
      "0",
    )}:${String(
      remainingSeconds,
    ).padStart(
      2,
      "0",
    )}`;
  }

  return `${minutes}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}
