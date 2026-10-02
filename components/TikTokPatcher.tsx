"use client";

import { useCallback, useMemo, useRef, useState } from "react";

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
      throw new Error(
        "MP4 box is too large for this browser.",
      );
    }

    size = largeSize;
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }

  if (
    size < headerSize ||
    offset + size > limit
  ) {
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
      let childStart =
        box.offset + box.headerSize;

      if (box.type === "meta") {
        childStart += 4;
      }

      const boxEnd =
        box.offset + box.size;

      if (childStart < boxEnd) {
        await scanRange(
          file,
          childStart,
          boxEnd,
          visitor,
        );
      }
    }

    position =
      box.offset + box.size;
  }
}

async function findTopLevel(
  file: File,
  wanted: string,
): Promise<Box | null> {
  let position = 0;

  while (position + 8 <= file.size) {
    const box = await readBox(
      file,
      position,
      file.size,
    );

    if (!box) {
      break;
    }

    if (box.type === wanted) {
      return box;
    }

    position =
      box.offset + box.size;
  }

  return null;
}

async function findMoov(file: File): Promise<Box> {
  const moov =
    await findTopLevel(file, "moov");

  if (!moov) {
    throw new Error(
      "Could not find an MP4 moov box.",
    );
  }

  return moov;
}

async function readFullBox(
  file: File,
  box: Box,
) {
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

async function readMdhd(
  file: File,
  box: Box,
) {
  const { version } =
    await readFullBox(file, box);

  const base =
    box.offset +
    box.headerSize +
    4;

  const length =
    version === 1
      ? 32
      : 20;

  const buffer =
    await file
      .slice(base, base + length)
      .arrayBuffer();

  const view =
    new DataView(buffer);

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

async function readMvhd(
  file: File,
  box: Box,
) {
  const { version } =
    await readFullBox(file, box);

  const base =
    box.offset +
    box.headerSize +
    4;

  const length =
    version === 1
      ? 32
      : 20;

  const buffer =
    await file
      .slice(base, base + length)
      .arrayBuffer();

  const view =
    new DataView(buffer);

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

async function readHandlerType(
  file: File,
  box: Box,
) {
  const start =
    box.offset +
    box.headerSize +
    8;

  const buffer =
    await file
      .slice(start, start + 4)
      .arrayBuffer();

  return ascii(
    new DataView(buffer),
    0,
    4,
  );
}

async function readSttsAverageFps(
  file: File,
  stts: Box,
  timescale: number,
) {
  const start =
    stts.offset +
    stts.headerSize +
    4;

  const header =
    await file
      .slice(start, start + 4)
      .arrayBuffer();

  const count =
    u32(
      new DataView(header),
      0,
    );

  if (!count) {
    return null;
  }

  let totalSamples = 0;
  let totalDuration = 0;

  const chunkSize =
    1024 * 1024;

  const entriesBytes =
    count * 8;

  if (
    !Number.isSafeInteger(
      entriesBytes,
    )
  ) {
    return null;
  }

  for (
    let offset = 0;
    offset < entriesBytes;
    offset += chunkSize
  ) {
    const length =
      Math.min(
        chunkSize,
        entriesBytes - offset,
      );

    const buffer =
      await file
        .slice(
          start + 4 + offset,
          start +
            4 +
            offset +
            length,
        )
        .arrayBuffer();

    const view =
      new DataView(buffer);

    for (
      let position = 0;
      position + 8 <= length;
      position += 8
    ) {
      const sampleCount =
        u32(
          view,
          position,
        );

      const sampleDelta =
        u32(
          view,
          position + 4,
        );

      totalSamples +=
        sampleCount;

      totalDuration +=
        sampleDelta *
        sampleCount;
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
    (totalSamples *
      timescale) /
    totalDuration
  );
}

async function patchTimingBox(
  file: File,
  box: Box,
  divider: number,
): Promise<Patch | null> {
  if (
    box.type !== "mvhd" &&
    box.type !== "mdhd"
  ) {
    return null;
  }

  const bytes =
    new Uint8Array(
      await file
        .slice(
          box.offset,
          box.offset + box.size,
        )
        .arrayBuffer(),
    );

  const view =
    new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );

  const version =
    view.getUint8(
      box.headerSize,
    );

  const base =
    box.headerSize + 4;

  if (version === 0) {
    const timescaleOffset =
      base + 12;

    const durationOffset =
      base + 16;

    const oldTimescale =
      u32(
        view,
        timescaleOffset,
      );

    const oldDuration =
      u32(
        view,
        durationOffset,
      );

    const newTimescale =
      Math.max(
        1,
        Math.floor(
          oldTimescale /
            divider,
        ),
      );

    const newDuration =
      Math.floor(
        oldDuration /
          divider,
      );

    putU32(
      view,
      timescaleOffset,
      newTimescale,
    );

    putU32(
      view,
      durationOffset,
      newDuration,
    );
  } else if (version === 1) {
    const timescaleOffset =
      base + 24;

    const durationOffset =
      base + 28;

    const oldTimescale =
      u32(
        view,
        timescaleOffset,
      );

    const oldDuration =
      u64(
        view,
        durationOffset,
      );

    const newTimescale =
      Math.max(
        1,
        Math.floor(
          oldTimescale /
            divider,
        ),
      );

    const newDuration =
      Math.floor(
        oldDuration /
          divider,
      );

    putU32(
      view,
      timescaleOffset,
      newTimescale,
    );

    putU64(
      view,
      durationOffset,
      newDuration,
    );
  } else {
    return null;
  }

  return {
    offset: box.offset,
    bytes,
    label: box.type,
  };
}

async function inspectAndBuildPatch(
  file: File,
  divider: number,
) {
  const moov =
    await findMoov(file);

  let mvhd:
    Box | undefined;

  const allMdhd: Box[] = [];

  const tracks: TrackInfo[] = [];

  let currentTrack:
    TrackInfo | null = null;

  await scanRange(
    file,
    moov.offset +
      moov.headerSize,
    moov.offset +
      moov.size,
    async (box) => {
      if (
        box.type === "mvhd"
      ) {
        mvhd = box;
      }

      if (
        box.type === "mdhd"
      ) {
        allMdhd.push(box);

        if (currentTrack) {
          currentTrack.mdhd =
            box;

          const md =
            await readMdhd(
              file,
              box,
            );

          currentTrack.timescale =
            md.timescale;
        }
      }

      if (
        box.type === "trak"
      ) {
        currentTrack = {};
        tracks.push(
          currentTrack,
        );
      }

      if (
        currentTrack &&
        box.type === "hdlr"
      ) {
        currentTrack.handler =
          await readHandlerType(
            file,
            box,
          );
      }

      if (
        currentTrack &&
        box.type === "stts"
      ) {
        currentTrack.stts =
          box;
      }
    },
  );

  if (!mvhd) {
    throw new Error(
      "Could not find mvhd.",
    );
  }

  if (
    allMdhd.length === 0
  ) {
    throw new Error(
      "Could not find any mdhd timing boxes.",
    );
  }

  const videoTrack =
    tracks.find(
      (track) =>
        track.handler ===
          "vide" &&
        track.mdhd &&
        track.stts &&
        track.timescale,
    );

  if (
    !videoTrack ||
    !videoTrack.stts ||
    !videoTrack.timescale
  ) {
    throw new Error(
      "Could not determine the video FPS.",
    );
  }

  const fps =
    await readSttsAverageFps(
      file,
      videoTrack.stts,
      videoTrack.timescale,
    );

  if (!fps) {
    throw new Error(
      "Could not determine the source FPS.",
    );
  }

  const expected =
    divider === 4
      ? 120
      : 60;

  if (
    Math.abs(
      fps - expected,
    ) > 5
  ) {
    throw new Error(
      `Detected approximately ${fps.toFixed(
        3,
      )} FPS, not ${expected} FPS.`,
    );
  }

  const patches: Patch[] =
    [];

  const mvPatch =
    await patchTimingBox(
      file,
      mvhd,
      divider,
    );

  if (mvPatch) {
    patches.push(
      mvPatch,
    );
  }

  for (
    const mdhd of allMdhd
  ) {
    const patch =
      await patchTimingBox(
        file,
        mdhd,
        divider,
      );

    if (patch) {
      patches.push(
        patch,
      );
    }
  }

  patches.sort(
    (a, b) =>
      a.offset - b.offset,
  );

  const mv =
    await readMvhd(
      file,
      mvhd,
    );

  const originalDuration =
    mv.duration /
    mv.timescale;

  const newMvTimescale =
    Math.max(
      1,
      Math.floor(
        mv.timescale /
          divider,
      ),
    );

  const newMvDuration =
    Math.floor(
      mv.duration /
        divider,
    );

  const outputDuration =
    newMvDuration /
    newMvTimescale;

  return {
    patches,
    fps,
    originalDuration,
    outputDuration,
    divider,
    mdhdCount:
      allMdhd.length,
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
      ) => Promise<any>;
    }
  ).showSaveFilePicker;

  if (!picker) {
    return false;
  }

  const handle =
    await picker({
      suggestedName: name,

      types: [
        {
          description:
            "MP4 video",

          accept: {
            "video/mp4": [
              ".mp4",
            ],
          },
        },
      ],
    });

  const writable =
    await handle.createWritable();

  let sourcePosition = 0;

  const CHUNK_SIZE =
    32 * 1024 * 1024;

  try {
    for (
      const patch of patches
    ) {
      while (
        sourcePosition <
        patch.offset
      ) {
        const end =
          Math.min(
            patch.offset,
            sourcePosition +
              CHUNK_SIZE,
          );

        const chunk =
          await file
            .slice(
              sourcePosition,
              end,
            )
            .arrayBuffer();

        await writable.write(
          chunk,
        );

        sourcePosition =
          end;
      }

      await writable.write(
        patch.bytes.buffer.slice(
          patch.bytes.byteOffset,
          patch.bytes.byteOffset +
            patch.bytes.byteLength,
        ) as ArrayBuffer,
      );

      sourcePosition =
        patch.offset +
        patch.bytes.byteLength;
    }

    while (
      sourcePosition <
      file.size
    ) {
      const end =
        Math.min(
          file.size,
          sourcePosition +
            CHUNK_SIZE,
        );

      const chunk =
        await file
          .slice(
            sourcePosition,
            end,
          )
          .arrayBuffer();

      await writable.write(
        chunk,
      );

      sourcePosition =
        end;
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
  const parts: BlobPart[] =
    [];

  let position = 0;

  for (
    const patch of patches
  ) {
    if (
      position <
      patch.offset
    ) {
      parts.push(
        file.slice(
          position,
          patch.offset,
        ),
      );
    }

    const bytes =
      new Uint8Array(
        patch.bytes,
      );

    const buffer =
      new ArrayBuffer(
        bytes.byteLength,
      );

    new Uint8Array(
      buffer,
    ).set(bytes);

    parts.push(buffer);

    position =
      patch.offset +
      patch.bytes.byteLength;
  }

  if (
    position <
    file.size
  ) {
    parts.push(
      file.slice(
        position,
      ),
    );
  }

  return new Blob(
    parts,
    {
      type: "video/mp4",
    },
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
  let index = 0;

  while (
    value >= 1024 &&
    index <
      units.length - 1
  ) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(
    value >= 100 ||
      index === 0
      ? 0
      : 2,
  )} ${units[index]}`;
}

function formatDuration(
  seconds: number,
) {
  const totalSeconds =
    Math.max(
      0,
      Math.round(seconds),
    );

  const hours =
    Math.floor(
      totalSeconds / 3600,
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) /
        60,
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
  ).padStart(
    2,
    "0",
  )}`;
}

export default function TikTokPatcher() {
  const inputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const [file, setFile] =
    useState<File | null>(
      null,
    );

  const [fps, setFps] =
    useState<number | null>(
      null,
    );

  const [duration, setDuration] =
    useState<number | null>(
      null,
    );

  const [status, setStatus] =
    useState(
      "Drop a 60 or 120 FPS MP4 to begin.",
    );

  const [error, setError] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [dragging, setDragging] =
    useState(false);

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
    async (
      selectedFile: File,
    ) => {
      if (
        !selectedFile.name
          .toLowerCase()
          .endsWith(".mp4")
      ) {
        setError(
          "Please choose an MP4 file.",
        );

        return;
      }

      setFile(
        selectedFile,
      );

      setFps(null);
      setDuration(null);
      setError("");

      setStatus(
        "Reading MP4 metadata…",
      );

      try {
        const result =
          await inspectAndBuildPatch(
            selectedFile,
            4,
          );

        setFps(
          result.fps,
        );

        setDuration(
          result.originalDuration,
        );

        setStatus(
          "Ready to patch.",
        );
      } catch {
        try {
          const result =
            await inspectAndBuildPatch(
              selectedFile,
              2,
            );

          setFps(
            result.fps,
          );

          setDuration(
            result.originalDuration,
          );

          setStatus(
            "Ready to patch.",
          );
        } catch (
          secondError
        ) {
          setFps(null);
          setDuration(null);

          setError(
            secondError instanceof
              Error
              ? secondError.message
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
    if (
      !file ||
      fps === null
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const divider =
        Math.abs(
          fps - 120,
        ) < 0.5
          ? 4
          : Math.abs(
                fps - 60,
              ) < 0.5
            ? 2
            : 0;

      if (divider === 0) {
        throw new Error(
          "This patcher supports 60 or 120 FPS.",
        );
      }

      setStatus(
        "Patching MP4 timing metadata…",
      );

      const result =
        await inspectAndBuildPatch(
          file,
          divider,
        );

      const baseName =
        file.name.replace(
          /\.mp4$/i,
          "",
        );

      const outputName =
        `${baseName}_metadata_output.mp4`;

      if (
        supportsDirectSave
      ) {
        setStatus(
          "Writing patched MP4 to disk…",
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

        const blob =
          makeBlob(
            file,
            result.patches,
          );

        const url =
          URL.createObjectURL(
            blob,
          );

        const anchor =
          document.createElement(
            "a",
          );

        anchor.href =
          url;

        anchor.download =
          outputName;

        document.body.appendChild(
          anchor,
        );

        anchor.click();

        anchor.remove();

        setTimeout(
          () => {
            URL.revokeObjectURL(
              url,
            );
          },
          60000,
        );
      }

      setStatus(
        `Done • ${formatDuration(
          result.outputDuration,
        )}`,
      );
    } catch (
      patchError
    ) {
      setError(
        patchError instanceof
          Error
          ? patchError.message
          : "Patch failed.",
      );

      setStatus(
        "Patch failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function clearFile() {
    setFile(null);
    setFps(null);
    setDuration(null);
    setError("");
    setStatus(
      "Drop a 60 or 120 FPS MP4 to begin.",
    );

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const ready =
    file &&
    fps !== null &&
    !busy &&
    !error;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          MP4 Metadata Patcher
        </h1>

        <p className="mt-1.5 text-sm text-muted-foreground">
          60 / 120 FPS timing metadata
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-background">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {file
                  ? file.name
                  : "Choose an MP4"}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {file
                  ? `${formatBytes(
                      file.size,
                    )}${
                      fps !== null
                        ? ` · ${fps.toFixed(
                            2,
                          )} FPS`
                        : ""
                    }${
                      duration !== null
                        ? ` · ${formatDuration(
                            duration,
                          )}`
                        : ""
                    }`
                  : "Local processing · no re-encoding"}
              </p>
            </div>

            {file && (
              <button
                type="button"
                onClick={clearFile}
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {!file ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => {
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);

              const droppedFile =
                event.dataTransfer.files?.[0];

              if (droppedFile) {
                void inspect(
                  droppedFile,
                );
              }
            }}
            className={`m-4 flex min-h-[270px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors sm:m-5 ${
              dragging
                ? "border-foreground bg-muted/50"
                : "border-border hover:border-foreground/30"
            }`}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted text-[10px] font-bold tracking-tight">
              MP4
            </div>

            <p className="mt-4 text-sm font-medium">
              Drop your MP4 here
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              60 or 120 FPS
            </p>

            <label className="mt-5 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85">
              Choose MP4

              <input
                ref={inputRef}
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
                }}
              />
            </label>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="rounded-xl border border-border bg-muted/30">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {file.name}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(
                      file.size,
                    )}

                    {fps !== null
                      ? ` · ${fps.toFixed(
                          2,
                        )} FPS`
                      : ""}

                    {duration !== null
                      ? ` · ${formatDuration(
                          duration,
                        )}`
                      : ""}
                  </p>
                </div>

                <div className="text-xs text-muted-foreground">
                  {busy
                    ? "Processing…"
                    : error
                      ? "Error"
                      : status}
                </div>
              </div>

              {error && (
                <div className="border-t border-border px-4 py-3 text-xs text-red-500">
                  {error}
                </div>
              )}

              <div className="border-t border-border p-4">
                <button
                  type="button"
                  onClick={() =>
                    void patch()
                  }
                  disabled={
                    !ready
                  }
                  className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy
                    ? "Patching…"
                    : supportsDirectSave
                      ? "Patch & Save MP4"
                      : "Patch & Download MP4"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>60 / 120 FPS</span>
            <span aria-hidden="true">•</span>
            <span>No re-encoding</span>
            <span aria-hidden="true">•</span>
            <span>Processed locally</span>
          </div>
        </div>
      </section>
    </main>
  );
}
