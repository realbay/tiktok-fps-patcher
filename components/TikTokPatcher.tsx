"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  FileVideo,
  HardDrive,
  Loader2,
  Upload,
  X,
} from "lucide-react";

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
  if (
    offset + 8 >
    limit
  ) {
    return null;
  }

  const buffer =
    await file
      .slice(
        offset,
        Math.min(
          offset + 16,
          limit,
        ),
      )
      .arrayBuffer();

  const view =
    new DataView(buffer);

  let size =
    u32(view, 0);

  const type =
    ascii(
      view,
      4,
      4,
    );

  let headerSize = 8;

  if (size === 1) {
    if (
      view.byteLength <
      16
    ) {
      return null;
    }

    const largeSize =
      u64(
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

    size =
      largeSize;

    headerSize =
      16;
  } else if (
    size === 0
  ) {
    size =
      limit - offset;
  }

  if (
    size <
      headerSize ||
    offset + size >
      limit
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
  let position =
    start;

  while (
    position + 8 <=
    end
  ) {
    const box =
      await readBox(
        file,
        position,
        end,
      );

    if (!box) {
      break;
    }

    await visitor(box);

    if (
      CONTAINERS.has(
        box.type,
      )
    ) {
      let childStart =
        box.offset +
        box.headerSize;

      if (
        box.type ===
        "meta"
      ) {
        childStart += 4;
      }

      const boxEnd =
        box.offset +
        box.size;

      if (
        childStart <
        boxEnd
      ) {
        await scanRange(
          file,
          childStart,
          boxEnd,
          visitor,
        );
      }
    }

    position =
      box.offset +
      box.size;
  }
}

async function findTopLevel(
  file: File,
  wanted: string,
): Promise<Box | null> {
  let position = 0;

  while (
    position + 8 <=
    file.size
  ) {
    const box =
      await readBox(
        file,
        position,
        file.size,
      );

    if (!box) {
      break;
    }

    if (
      box.type ===
      wanted
    ) {
      return box;
    }

    position =
      box.offset +
      box.size;
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
  const buffer =
    await file
      .slice(
        box.offset +
          box.headerSize,
        box.offset +
          box.headerSize +
          4,
      )
      .arrayBuffer();

  const view =
    new DataView(buffer);

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

  if (
    version === 1
  ) {
    return {
      version,
      timescale:
        u32(view, 16),
      duration:
        u64(view, 20),
    };
  }

  return {
    version,
    timescale:
      u32(view, 8),
    duration:
      u32(view, 12),
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

  if (
    version === 1
  ) {
    return {
      version,
      timescale:
        u32(view, 16),
      duration:
        u64(view, 20),
    };
  }

  return {
    version,
    timescale:
      u32(view, 8),
    duration:
      u32(view, 12),
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
        entriesBytes -
          offset,
      );

    const buffer =
      await file
        .slice(
          start +
            4 +
            offset,
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
      position + 8 <=
      length;
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
          box.offset +
            box.size,
        )
        .arrayBuffer(),
    );

  const view =
    new DataView(
      bytes.buffer,
    );

  const version =
    view.getUint8(
      box.headerSize,
    );

  const base =
    box.headerSize + 4;

  if (
    version === 0
  ) {
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
    offset:
      box.offset,
    bytes,
    label:
      box.type,
  };
}

async function inspectAndBuildPatch(
  file: File,
  divider: number,
) {
  const moov =
    await findMoov(file);

  let mvhd:
    | Box
    | undefined;

  const allMdhd:
    Box[] = [];

  const tracks:
    TrackInfo[] = [];

  let currentTrack:
    TrackInfo | null =
    null;

  await scanRange(
    file,
    moov.offset +
      moov.headerSize,
    moov.offset +
      moov.size,
    async (box) => {
      if (
        box.type ===
        "mvhd"
      ) {
        mvhd = box;
      }

      if (
        box.type ===
        "trak"
      ) {
        currentTrack = {};
        tracks.push(
          currentTrack,
        );
      }

      if (
        box.type ===
        "mdhd"
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
        currentTrack &&
        box.type ===
        "hdlr"
      ) {
        currentTrack.handler =
          await readHandlerType(
            file,
            box,
          );
      }

      if (
        currentTrack &&
        box.type ===
        "stts"
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

  const patches:
    Patch[] = [];

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
      a.offset -
      b.offset,
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
      suggestedName:
        name,

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

      const patchBuffer =
        new ArrayBuffer(
          patch.bytes.byteLength,
        );

      new Uint8Array(
        patchBuffer,
      ).set(
        patch.bytes,
      );

      await writable.write(
        patchBuffer,
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
  const parts:
    BlobPart[] = [];

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

    const buffer =
      new ArrayBuffer(
        patch.bytes.byteLength,
      );

    new Uint8Array(
      buffer,
    ).set(
      patch.bytes,
    );

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

function createThumbnail(
  file: File,
): Promise<string | null> {
  return new Promise(
    (resolve) => {
      const video =
        document.createElement(
          "video",
        );

      const url =
        URL.createObjectURL(
          file,
        );

      video.preload =
        "metadata";
      video.muted = true;
      video.playsInline =
        true;

      const cleanup =
        () => {
          video.remove();
          URL.revokeObjectURL(
            url,
          );
        };

      video.onloadedmetadata =
        () => {
          const targetTime =
            Math.min(
              0.25,
              Math.max(
                0,
                video.duration /
                  10,
              ),
            );

          video.currentTime =
            Number.isFinite(
              targetTime,
            )
              ? targetTime
              : 0;
        };

      video.onseeked =
        () => {
          try {
            const width =
              video.videoWidth ||
              640;

            const height =
              video.videoHeight ||
              360;

            const scale =
              Math.min(
                1,
                640 / width,
              );

            const canvas =
              document.createElement(
                "canvas",
              );

            canvas.width =
              Math.max(
                1,
                Math.round(
                  width * scale,
                ),
              );

            canvas.height =
              Math.max(
                1,
                Math.round(
                  height * scale,
                ),
              );

            const context =
              canvas.getContext(
                "2d",
              );

            if (!context) {
              cleanup();
              resolve(
                null,
              );
              return;
            }

            context.drawImage(
              video,
              0,
              0,
              canvas.width,
              canvas.height,
            );

            const thumbnail =
              canvas.toDataURL(
                "image/jpeg",
                0.82,
              );

            cleanup();
            resolve(
              thumbnail,
            );
          } catch {
            cleanup();
            resolve(
              null,
            );
          }
        };

      video.onerror =
        () => {
          cleanup();
          resolve(
            null,
          );
        };

      video.src =
        url;
    },
  );
}

export default function TikTokPatcher() {
  const [
    file,
    setFile,
  ] =
    useState<File | null>(
      null,
    );

  const [
    thumbnail,
    setThumbnail,
  ] =
    useState<string | null>(
      null,
    );

  const [
    fps,
    setFps,
  ] =
    useState<number | null>(
      null,
    );

  const [
    duration,
    setDuration,
  ] =
    useState<number | null>(
      null,
    );

  const [
    mdhdCount,
    setMdhdCount,
  ] =
    useState<number | null>(
      null,
    );

  const [
    status,
    setStatus,
  ] =
    useState(
      "Choose a video to begin.",
    );

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    dragging,
    setDragging,
  ] =
    useState(false);

  const inputRef =
    useRef<HTMLInputElement>(
      null,
    );

  const supportsDirectSave =
    typeof window !==
      "undefined" &&
    "showSaveFilePicker" in
      window;

  useEffect(() => {
    return () => {
      if (thumbnail) {
        // Thumbnail is a data URL, so
        // there is nothing to revoke.
      }
    };
  }, [thumbnail]);

  const inspect =
    useCallback(
      async (
        selectedFile: File,
      ) => {
        setFile(
          selectedFile,
        );

        setThumbnail(
          null,
        );

        setFps(
          null,
        );

        setDuration(
          null,
        );

        setMdhdCount(
          null,
        );

        setError("");

        setStatus(
          "Reading video metadata…",
        );

        void createThumbnail(
          selectedFile,
        ).then(
          setThumbnail,
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

          setMdhdCount(
            result.mdhdCount,
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

            setMdhdCount(
              result.mdhdCount,
            );

            setStatus(
              "Ready to patch.",
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
              "Could not read this video.",
            );
          }
        }
      },
      [],
    );

  function clearFile() {
    setFile(
      null,
    );

    setThumbnail(
      null,
    );

    setFps(
      null,
    );

    setDuration(
      null,
    );

    setMdhdCount(
      null,
    );

    setError("");

    setStatus(
      "Choose a video to begin.",
    );

    if (inputRef.current) {
      inputRef.current.value =
        "";
    }
  }

  async function patch() {
    if (
      !file ||
      fps === null
    ) {
      return;
    }

    setBusy(
      true,
    );

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

      if (
        divider === 0
      ) {
        throw new Error(
          "This patcher supports 60 or 120 FPS.",
        );
      }

      setStatus(
        "Preparing MP4 timing metadata…",
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
        "Finished. Your patched MP4 is ready.",
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
      setBusy(
        false,
      );
    }
  }

  function handleDrop(
    event: React.DragEvent,
  ) {
    event.preventDefault();

    setDragging(
      false,
    );

    const droppedFile =
      event.dataTransfer.files?.[0];

    if (
      droppedFile
    ) {
      void inspect(
        droppedFile,
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        {/* Compact tool heading */}
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                <FilmMark />
              </div>

              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold">
                  TikTok FPS Patcher
                </h1>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  60 / 120 FPS MP4 timing
                </p>
              </div>
            </div>

            <div className="hidden text-right text-xs text-muted-foreground sm:block">
              <div>
                Runs in your browser
              </div>

              <div className="mt-0.5">
                No upload required
              </div>
            </div>
          </div>
        </div>

        {!file ? (
          <div className="p-4 sm:p-5">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => {
                setDragging(false);
              }}
              onDrop={handleDrop}
              className={`relative flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition-colors sm:min-h-[390px] ${
                dragging
                  ? "border-foreground bg-muted/40"
                  : "border-border hover:border-foreground/30 hover:bg-muted/20"
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
                <Upload className="h-5 w-5 text-muted-foreground" />
              </div>

              <h2 className="mt-5 text-lg font-semibold tracking-tight">
                Drop your 60 or 120 FPS MP4 here
              </h2>

              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Use the MP4 you exported from Blur or your
                usual editing workflow. We only change the
                timing metadata — the video itself is not
                re-encoded.
              </p>

              <button
                type="button"
                onClick={() =>
                  inputRef.current?.click()
                }
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85"
              >
                Choose MP4
              </button>

              <p className="mt-4 text-xs text-muted-foreground">
                MP4 only · 60 or 120 FPS
              </p>

              <input
                ref={inputRef}
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
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5" />
                Stays on your device
              </span>

              <span>
                No re-encoding
              </span>

              <span>
                60 / 120 FPS
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid md:grid-cols-[280px_1fr]">
                {/* Thumbnail */}
                <div className="relative aspect-video overflow-hidden bg-muted md:aspect-auto md:min-h-[230px]">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 to-transparent" />

                  {fps !== null && (
                    <div className="absolute bottom-3 left-3 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                      {fps.toFixed(2)} FPS
                    </div>
                  )}
                </div>

                {/* File information */}
                <div className="flex min-w-0 flex-col p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Selected video
                      </p>

                      <h2 className="mt-2 truncate text-base font-semibold">
                        {file.name}
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={clearFile}
                      aria-label="Remove video"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <MetaItem
                      label="Size"
                      value={formatBytes(
                        file.size,
                      )}
                    />

                    <MetaItem
                      label="Frame rate"
                      value={
                        fps !== null
                          ? `${fps.toFixed(
                              2,
                            )} FPS`
                          : "Reading…"
                      }
                    />

                    <MetaItem
                      label="Duration"
                      value={
                        duration !== null
                          ? formatDuration(
                              duration,
                            )
                          : "Reading…"
                      }
                    />
                  </div>

                  <div className="mt-auto pt-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {error ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                            {error}
                          </>
                        ) : busy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {status}
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            {status}
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          void patch()
                        }
                        disabled={
                          busy ||
                          fps === null ||
                          !!error
                        }
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
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
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span>
                Client-side processing
              </span>

              <span>
                No re-encoding
              </span>

              <span>
                {mdhdCount !== null
                  ? `${mdhdCount} MP4 timing tracks`
                  : "MP4 metadata"}
              </span>
            </div>
          </div>
        )}
      </section>

      {!file && (
        <div className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
          <SmallFeature
            number="01"
            title="Choose your MP4"
            text="Drop in the 60 or 120 FPS video you want to prepare."
          />

          <SmallFeature
            number="02"
            title="Patch locally"
            text="Only MP4 timing metadata is changed in your browser."
          />

          <SmallFeature
            number="03"
            title="Save the result"
            text="Your original video stays untouched while a new MP4 is created."
          />
        </div>
      )}
    </main>
  );
}

function FilmMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2"
      />

      <path d="M8 3v18" />
      <path d="M16 3v18" />
      <path d="M4 8h4" />
      <path d="M16 8h4" />
      <path d="M4 16h4" />
      <path d="M16 16h4" />

      <path
        d="m11 9 4 3-4 3V9Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function MetaItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium">
        {value}
      </p>
    </div>
  );
}

function SmallFeature({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {number}
      </p>

      <p className="mt-2 text-sm font-semibold">
        {title}
      </p>

      <p className="mt-1 text-sm leading-5 text-muted-foreground">
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
      totalSeconds /
        3600,
    );

  const minutes =
    Math.floor(
      (totalSeconds %
        3600) /
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
