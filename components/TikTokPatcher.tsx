"use client";

import { useCallback, useMemo, useState } from "react";

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

function putU32(
  view: DataView,
  offset: number,
  value: number,
) {
  view.setUint32(
    offset,
    value >>> 0,
    false,
  );
}

function putU64(
  view: DataView,
  offset: number,
  value: number,
) {
  const hi = Math.floor(
    value / 4294967296,
  );

  const lo =
    value -
    hi * 4294967296;

  view.setUint32(
    offset,
    hi >>> 0,
    false,
  );

  view.setUint32(
    offset + 4,
    lo >>> 0,
    false,
  );
}

function ascii(
  view: DataView,
  offset: number,
  length: number,
) {
  let result = "";

  for (
    let i = 0;
    i < length;
    i++
  ) {
    result += String.fromCharCode(
      view.getUint8(offset + i),
    );
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
    .slice(
      offset,
      Math.min(
        offset + 16,
        limit,
      ),
    )
    .arrayBuffer();

  const view = new DataView(
    buffer,
  );

  let size = u32(view, 0);

  const type = ascii(
    view,
    4,
    4,
  );

  let headerSize = 8;

  if (size === 1) {
    if (view.byteLength < 16) {
      return null;
    }

    const largeSize = u64(
      view,
      8,
    );

    if (
      !Number.isSafeInteger(
        largeSize,
      )
    ) {
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
  visitor: (
    box: Box,
  ) => Promise<void>,
) {
  let position = start;

  while (
    position + 8 <= end
  ) {
    const box = await readBox(
      file,
      position,
      end,
    );

    if (!box) {
      break;
    }

    await visitor(box);

    if (
      CONTAINERS.has(box.type)
    ) {
      let childStart =
        box.offset +
        box.headerSize;

      /*
       * meta is a FullBox, so its
       * version/flags occupy 4 bytes
       * before its children.
       */
      if (box.type === "meta") {
        childStart += 4;
      }

      const boxEnd =
        box.offset + box.size;

      if (
        childStart < boxEnd
      ) {
        await scanRange(
          file,
          childStart,
          boxEnd,
          visitor,
        );
      }
    }

    /*
     * IMPORTANT:
     * We do not scan mdat because it
     * is not in CONTAINERS.
     */
    position =
      box.offset + box.size;
  }
}

async function findTopLevel(
  file: File,
  wanted: string,
): Promise<Box | null> {
  let position = 0;

  while (
    position + 8 <= file.size
  ) {
    const box = await readBox(
      file,
      position,
      file.size,
    );

    if (!box) {
      break;
    }

    if (
      box.type === wanted
    ) {
      return box;
    }

    position =
      box.offset + box.size;
  }

  return null;
}

async function findMoov(
  file: File,
): Promise<Box> {
  const moov =
    await findTopLevel(
      file,
      "moov",
    );

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
      box.offset +
        box.headerSize,
      box.offset +
        box.headerSize +
        4,
    )
    .arrayBuffer();

  const view = new DataView(
    buffer,
  );

  return {
    version:
      view.getUint8(0),

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
    await readFullBox(
      file,
      box,
    );

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
      .slice(
        base,
        base + length,
      )
      .arrayBuffer();

  const view =
    new DataView(buffer);

  if (version === 1) {
    return {
      version,
      timescale: u32(
        view,
        16,
      ),
      duration: u64(
        view,
        20,
      ),
    };
  }

  return {
    version,
    timescale: u32(
      view,
      8,
    ),
    duration: u32(
      view,
      12,
    ),
  };
}

async function readMvhd(
  file: File,
  box: Box,
) {
  const { version } =
    await readFullBox(
      file,
      box,
    );

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
      .slice(
        base,
        base + length,
      )
      .arrayBuffer();

  const view =
    new DataView(buffer);

  if (version === 1) {
    return {
      version,
      timescale: u32(
        view,
        16,
      ),
      duration: u64(
        view,
        20,
      ),
    };
  }

  return {
    version,
    timescale: u32(
      view,
      8,
    ),
    duration: u32(
      view,
      12,
    ),
  };
}

async function readHandlerType(
  file: File,
  box: Box,
) {
  /*
   * hdlr:
   *
   * version/flags = 4
   * pre_defined  = 4
   * handler_type = 4
   */
  const start =
    box.offset +
    box.headerSize +
    8;

  const buffer =
    await file
      .slice(
        start,
        start + 4,
      )
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
      .slice(
        start,
        start + 4,
      )
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

/*
 * This is the important part.
 *
 * The original working PowerShell patcher
 * patches EVERY mvhd and EVERY mdhd it
 * encounters.
 *
 * It does NOT:
 *
 * - patch tkhd
 * - patch elst
 * - patch only the video mdhd
 *
 * This function mirrors that behavior.
 */
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
    );

  /*
   * FullBox:
   * version = first byte
   * flags   = next 3 bytes
   */
  const version =
    view.getUint8(
      box.headerSize,
    );

  const base =
    box.headerSize + 4;

  if (version === 0) {
    /*
     * version/flags = 4
     * creation     = 4
     * modification = 4
     * timescale    = 4
     * duration     = 4
     *
     * Relative to box start:
     *
     * timescale = +20
     * duration  = +24
     */

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
  } else if (
    version === 1
  ) {
    /*
     * version/flags = 4
     * creation     = 8
     * modification = 8
     * timescale    = 4
     * duration     = 8
     *
     * Relative to box start:
     *
     * timescale = +28
     * duration  = +32
     */

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

  /*
   * These are only used to determine
   * the source FPS for the UI and to
   * match the BAT's 60/120 behavior.
   */
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

      /*
       * IMPORTANT:
       *
       * Every mdhd is collected.
       *
       * We do NOT restrict this
       * to the video track.
       */
      if (
        box.type === "mdhd"
      ) {
        allMdhd.push(box);

        if (
          currentTrack
        ) {
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

  /*
   * Find the video track solely for
   * FPS detection.
   *
   * It is NOT used to decide which
   * mdhd boxes get patched.
   */
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

  /*
   * Patch mvhd.
   */
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

  /*
   * Patch EVERY mdhd.
   *
   * This is the critical difference
   * from the previous web version.
   */
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

  /*
   * Read original mvhd timing
   * for display purposes.
   */
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

      /*
       * Write the replacement
       * metadata box.
       */
      await writable.write(
        patch.bytes,
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

    /*
     * Convert the Uint8Array into
     * a standalone ArrayBuffer.
     *
     * This also fixes the TypeScript
     * BlobPart error from GitHub Actions.
     */
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

export default function TikTokPatcher() {
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

  const [mdhdCount, setMdhdCount] =
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
      setFile(
        selectedFile,
      );

      setFps(null);
      setDuration(null);
      setMdhdCount(null);
      setError("");

      setStatus(
        "Reading MP4 timing metadata…",
      );

      try {
        /*
         * Match the BAT:
         *
         * 120 FPS -> divider 4
         */
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

        setMdhdCount(
          result.mdhdCount,
        );

        setStatus(
          `Detected ${result.fps.toFixed(
            2,
          )} FPS • ${formatDuration(
            result.originalDuration,
          )} • ${result.mdhdCount} mdhd boxes found • ready to patch.`,
        );
      } catch {
        /*
         * If it wasn't 120 FPS,
         * try the BAT's 60 FPS path.
         */
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

          setMdhdCount(
            result.mdhdCount,
          );

          setStatus(
            `Detected ${result.fps.toFixed(
              2,
            )} FPS • ${formatDuration(
              result.originalDuration,
            )} • ${result.mdhdCount} mdhd boxes found • ready to patch.`,
          );
        } catch (
          secondError
        ) {
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
      /*
       * Match the BAT exactly:
       *
       * ~120 FPS -> 4
       * ~60 FPS  -> 2
       */
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
        `Patching mvhd + all mdhd boxes with divider ${divider}…`,
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
          `Writing ${result.patches.length} timing patches directly to disk…`,
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
        `Done • ${result.patches.length} timing boxes patched • duration ${formatDuration(
          result.outputDuration,
        )}.`,
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
            Patch the same MP4 timing metadata as the working desktop version. Your video stays local in the browser.
          </p>
        </div>

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

            if (
              droppedFile
            ) {
              void inspect(
                droppedFile,
              );
            }
          }}
          className={`rounded-2xl border p-8 transition-all md:p-12 ${
            dragging
              ? "border-primary bg-muted/70"
              : "border-border bg-background"
          }`}
        >
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-xs font-bold">
              MP4
            </div>

            <h2 className="mt-5 text-xl font-semibold">
              Drop your video here
            </h2>

            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              No re-encoding. Only MP4 timing metadata is changed.
            </p>

            <label className="mt-6 cursor-pointer rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85">
              Choose MP4

              <input
                type="file"
                accept="video/mp4,.mp4"
                className="hidden"
                onChange={(
                  event,
                ) => {
                  const selected =
                    event.target.files?.[0];

                  if (
                    selected
                  ) {
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
                {fps !== null
                  ? `${fps.toFixed(
                      2,
                    )} FPS`
                  : "Inspecting…"}

                {duration !== null
                  ? ` • ${formatDuration(
                      duration,
                    )}`
                  : ""}

                {mdhdCount !== null
                  ? ` • ${mdhdCount} mdhd`
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
                {error ||
                  status}
              </p>
            </div>
          </div>

          {file &&
            fps !== null &&
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
          <InfoCard
            title="Local"
            text="The video stays in your browser."
          />

          <InfoCard
            title="No re-encode"
            text="Only MP4 timing metadata is changed."
          />

          <InfoCard
            title="Working method"
            text="Patches mvhd and every mdhd box, without tkhd or elst changes."
          />
        </div>
      </div>
    </main>
  );
}

function InfoCard({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm font-semibold">
        {title}
      </p>

      <p className="mt-1 text-sm text-muted-foreground">
        {text}
      </p>
    </div>
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
