"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Box = { offset: number; size: number; headerSize: number; type: string };
type Patch = { offset: number; bytes: Uint8Array; label: string };
type TrackInfo = {
  trak: Box;
  handler?: string;
  mdhd?: Box;
  timescale?: number;
  stts?: Box;
};

type ProbeResult = {
  patches: Patch[];
  fps: number;
  originalDuration: number;
  outputDuration: number;
  divider: number;
  mdhdCount: number;
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
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

async function readBox(file: File, offset: number, limit: number): Promise<Box | null> {
  if (offset + 8 > limit) return null;

  const buffer = await file.slice(offset, Math.min(offset + 16, limit)).arrayBuffer();
  const view = new DataView(buffer);
  let size = u32(view, 0);
  const type = ascii(view, 4, 4);
  let headerSize = 8;

  if (size === 1) {
    if (view.byteLength < 16) return null;
    const largeSize = u64(view, 8);
    if (!Number.isSafeInteger(largeSize)) {
      throw new Error("MP4 box is too large for this browser.");
    }
    size = largeSize;
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }

  if (size < headerSize || offset + size > limit) return null;
  return { offset, size, headerSize, type };
}

async function collectBoxes(file: File, start: number, end: number): Promise<Box[]> {
  const boxes: Box[] = [];
  let position = start;

  while (position + 8 <= end) {
    const box = await readBox(file, position, end);
    if (!box) break;

    boxes.push(box);

    if (CONTAINERS.has(box.type)) {
      const childStart = box.offset + box.headerSize + (box.type === "meta" ? 4 : 0);
      const childEnd = box.offset + box.size;
      if (childStart < childEnd) {
        boxes.push(...(await collectBoxes(file, childStart, childEnd)));
      }
    }

    position = box.offset + box.size;
  }

  return boxes;
}

async function findMoov(file: File): Promise<Box> {
  let position = 0;

  while (position + 8 <= file.size) {
    const box = await readBox(file, position, file.size);
    if (!box) break;
    if (box.type === "moov") return box;
    position = box.offset + box.size;
  }

  throw new Error("Could not find an MP4 moov box.");
}

async function readFullBox(file: File, box: Box) {
  const buffer = await file
    .slice(box.offset + box.headerSize, box.offset + box.headerSize + 4)
    .arrayBuffer();
  const view = new DataView(buffer);

  return {
    version: view.getUint8(0),
    flags: (view.getUint8(1) << 16) | (view.getUint8(2) << 8) | view.getUint8(3),
  };
}

async function readMdhd(file: File, box: Box) {
  const { version } = await readFullBox(file, box);
  const base = box.offset + box.headerSize + 4;
  const length = version === 1 ? 32 : 20;
  const buffer = await file.slice(base, base + length).arrayBuffer();
  const view = new DataView(buffer);

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
  const length = version === 1 ? 32 : 20;
  const buffer = await file.slice(base, base + length).arrayBuffer();
  const view = new DataView(buffer);

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
  const start = box.offset + box.headerSize + 8;
  const buffer = await file.slice(start, start + 4).arrayBuffer();
  return ascii(new DataView(buffer), 0, 4);
}

async function readSttsAverageFps(file: File, stts: Box, timescale: number) {
  const start = stts.offset + stts.headerSize + 4;
  const header = await file.slice(start, start + 4).arrayBuffer();
  const count = u32(new DataView(header), 0);
  if (!count) return null;

  let totalSamples = 0;
  let totalDuration = 0;
  const chunkSize = 1024 * 1024;
  const entriesBytes = count * 8;

  if (entriesBytes > Number.MAX_SAFE_INTEGER) return null;

  for (let offset = 0; offset < entriesBytes; offset += chunkSize) {
    const length = Math.min(chunkSize, entriesBytes - offset);
    const buffer = await file
      .slice(start + 4 + offset, start + 4 + offset + length)
      .arrayBuffer();
    const view = new DataView(buffer);

    for (let position = 0; position + 8 <= length; position += 8) {
      const sampleCount = u32(view, position);
      const sampleDelta = u32(view, position + 4);
      totalSamples += sampleCount;
      totalDuration += sampleCount * sampleDelta;
    }
  }

  if (!totalDuration || !totalSamples || !timescale) return null;
  return (totalSamples * timescale) / totalDuration;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function buildPatch(file: File, divider: number): Promise<ProbeResult> {
  const moov = await findMoov(file);
  const allMoovBoxes = await collectBoxes(
    file,
    moov.offset + moov.headerSize,
    moov.offset + moov.size,
  );

  const mvhd = allMoovBoxes.find((box) => box.type === "mvhd");
  if (!mvhd) throw new Error("Could not find mvhd.");

  const trakBoxes = allMoovBoxes.filter((box) => box.type === "trak");
  const tracks: TrackInfo[] = [];

  for (const trak of trakBoxes) {
    const children = await collectBoxes(
      file,
      trak.offset + trak.headerSize,
      trak.offset + trak.size,
    );

    const mdhd = children.find((box) => box.type === "mdhd");
    const hdlr = children.find((box) => box.type === "hdlr");
    const stts = children.find((box) => box.type === "stts");

    const track: TrackInfo = { trak, mdhd, stts };

    if (mdhd) {
      const metadata = await readMdhd(file, mdhd);
      track.timescale = metadata.timescale;
    }

    if (hdlr) {
      track.handler = await readHandlerType(file, hdlr);
    }

    tracks.push(track);
  }

  const video = tracks.find(
    (track) => track.handler === "vide" && track.mdhd && track.timescale && track.stts,
  );

  if (!video || !video.mdhd || !video.timescale || !video.stts) {
    throw new Error("Could not identify the video track / frame timing.");
  }

  const fps = await readSttsAverageFps(file, video.stts, video.timescale);
  if (!fps) throw new Error("Could not determine the source FPS.");

  const expected = divider === 4 ? 120 : 60;
  if (Math.abs(fps - expected) > 5) {
    throw new Error(`Detected approximately ${fps.toFixed(3)} FPS, not ${expected} FPS.`);
  }

  const mv = await readMvhd(file, mvhd);
  const patches: Patch[] = [];

  const mvBytes = new Uint8Array(
    await file.slice(mvhd.offset, mvhd.offset + mvhd.size).arrayBuffer(),
  );
  const mvView = new DataView(mvBytes.buffer);
  const mvBase = mvhd.headerSize + 4;
  const mvTimescaleOffset = mv.version === 1 ? mvBase + 16 : mvBase + 8;
  const mvDurationOffset = mv.version === 1 ? mvBase + 20 : mvBase + 12;
  const newMvTimescale = Math.max(1, Math.floor(mv.timescale / divider));
  const newMvDuration = Math.max(1, Math.floor(mv.duration / divider));

  putU32(mvView, mvTimescaleOffset, newMvTimescale);
  if (mv.version === 1) {
    putU64(mvView, mvDurationOffset, newMvDuration);
  } else {
    putU32(mvView, mvDurationOffset, newMvDuration);
  }

  patches.push({ offset: mvhd.offset, bytes: mvBytes, label: "mvhd" });

  const mdhdBoxes = tracks
    .map((track) => track.mdhd)
    .filter((box): box is Box => Boolean(box));

  for (const mdhdBox of mdhdBoxes) {
    const md = await readMdhd(file, mdhdBox);
    const mdBytes = new Uint8Array(
      await file.slice(mdhdBox.offset, mdhdBox.offset + mdhdBox.size).arrayBuffer(),
    );
    const mdView = new DataView(mdBytes.buffer);
    const mdBase = mdhdBox.headerSize + 4;
    const mdTimescaleOffset = md.version === 1 ? mdBase + 16 : mdBase + 8;
    const mdDurationOffset = md.version === 1 ? mdBase + 20 : mdBase + 12;
    const newMdTimescale = Math.max(1, Math.floor(md.timescale / divider));
    const newMdDuration = Math.max(1, Math.floor(md.duration / divider));

    putU32(mdView, mdTimescaleOffset, newMdTimescale);
    if (md.version === 1) {
      putU64(mdView, mdDurationOffset, newMdDuration);
    } else {
      putU32(mdView, mdDurationOffset, newMdDuration);
    }

    patches.push({ offset: mdhdBox.offset, bytes: mdBytes, label: "mdhd" });
  }

  patches.sort((a, b) => a.offset - b.offset);

  return {
    patches,
    fps,
    originalDuration: mv.duration / mv.timescale,
    outputDuration: newMvDuration / newMvTimescale,
    divider,
    mdhdCount: mdhdBoxes.length,
  };
}

async function saveWithFileSystemAccess(file: File, patches: Patch[], name: string) {
  const picker = (window as Window & { showSaveFilePicker?: (options?: unknown) => Promise<any> })
    .showSaveFilePicker;

  if (!picker) return false;

  const handle = await picker({
    suggestedName: name,
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
  });
  const writable = await handle.createWritable();

  let sourcePosition = 0;
  const chunkSize = 32 * 1024 * 1024;

  try {
    for (const patch of patches) {
      while (sourcePosition < patch.offset) {
        const end = Math.min(patch.offset, sourcePosition + chunkSize);
        await writable.write(await file.slice(sourcePosition, end).arrayBuffer());
        sourcePosition = end;
      }

      await writable.write(copyBytes(patch.bytes));
      sourcePosition = patch.offset + patch.bytes.byteLength;
    }

    while (sourcePosition < file.size) {
      const end = Math.min(file.size, sourcePosition + chunkSize);
      await writable.write(await file.slice(sourcePosition, end).arrayBuffer());
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

function makeBlob(file: File, patches: Patch[]) {
  const parts: BlobPart[] = [];
  let position = 0;

  for (const patch of patches) {
    if (position < patch.offset) {
      parts.push(file.slice(position, patch.offset));
    }
    parts.push(copyBytes(patch.bytes));
    position = patch.offset + patch.bytes.byteLength;
  }

  if (position < file.size) {
    parts.push(file.slice(position));
  }

  return new Blob(parts, { type: "video/mp4" });
}

export default function TikTokPatcher() {
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mdhdCount, setMdhdCount] = useState<number | null>(null);
  const [status, setStatus] = useState("Drop a 60 or 120 FPS MP4 to begin.");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const supportsDirectSave = useMemo(
    () => typeof window !== "undefined" && "showSaveFilePicker" in window,
    [],
  );

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const inspect = useCallback(async (selected: File) => {
    if (!selected.name.toLowerCase().endsWith(".mp4") && selected.type !== "video/mp4") {
      setError("Please choose an MP4 video.");
      setStatus("Could not inspect the file.");
      return;
    }

    setError("");
    setFile(selected);
    setFps(null);
    setDuration(null);
    setResolution(null);
    setMdhdCount(null);
    setStatus("Reading MP4 timing metadata…");

    try {
      const probe = await buildPatch(selected, 4);
      setFps(probe.fps);
      setDuration(probe.originalDuration);
      setMdhdCount(probe.mdhdCount);
      setStatus(
        `Detected ${probe.fps.toFixed(2)} FPS • ${formatDuration(probe.originalDuration)} • ready to patch.`,
      );
    } catch (firstError) {
      try {
        const probe = await buildPatch(selected, 2);
        setFps(probe.fps);
        setDuration(probe.originalDuration);
        setMdhdCount(probe.mdhdCount);
        setStatus(
          `Detected ${probe.fps.toFixed(2)} FPS • ${formatDuration(probe.originalDuration)} • ready to patch.`,
        );
      } catch {
        setError(firstError instanceof Error ? firstError.message : "Could not inspect this MP4.");
        setStatus("Could not inspect the file.");
      }
    }
  }, []);

  async function patch() {
    if (!file || !fps) return;

    setBusy(true);
    setError("");
    setStatus("Preparing patch…");

    try {
      const divider = Math.abs(fps - 120) < 5 ? 4 : 2;
      const result = await buildPatch(file, divider);
      const base = file.name.replace(/\.mp4$/i, "");
      const outputName = `${base}_metadata_output.mp4`;

      if (supportsDirectSave) {
        setStatus("Writing patched MP4 directly to disk…");
        await saveWithFileSystemAccess(file, result.patches, outputName);
      } else {
        setStatus("Preparing browser download…");
        const blob = makeBlob(file, result.patches);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = outputName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }

      setStatus(`Done • ${formatDuration(result.outputDuration)} duration preserved.`);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Patch failed.");
      setStatus("Patch failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="home" className="mx-auto w-full max-w-[700px] px-5 pb-24 sm:px-6">
      <section className="pt-16 sm:pt-20">
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/35 light:text-black/35">
          browser utility
        </p>
        <h1 className="mt-3 font-serif text-[42px] leading-none tracking-[-0.045em] text-white sm:text-[52px] light:text-black">
          tiktok fps patcher
        </h1>
        <p className="mt-6 max-w-[560px] text-[14px] leading-7 text-white/55 light:text-black/55">
          Patch the timing metadata used by the working 60/120 FPS method without re-encoding the video. Everything runs locally in your browser.
        </p>
      </section>

      <section id="patcher" className="scroll-mt-20 pt-12">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) void inspect(dropped);
          }}
          className={`h-[390px] border transition-colors ${
            dragging
              ? "border-white bg-white/[0.035] light:border-black light:bg-black/[0.025]"
              : "border-white/15 bg-black light:border-black/15 light:bg-white"
          }`}
        >
          {!file ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="font-serif text-[26px] text-white light:text-black">drop your mp4</p>
              <p className="mt-3 max-w-[390px] text-[13px] leading-6 text-white/40 light:text-black/40">
                60 or 120 FPS. Large files are handled in chunks, so the full video does not need to be loaded into memory.
              </p>
              <label className="mt-7 cursor-pointer border border-white/25 bg-white px-5 py-2.5 text-[12px] font-medium text-black transition-opacity hover:opacity-80 light:border-black/20">
                choose mp4
                <input
                  type="file"
                  accept="video/mp4,.mp4"
                  className="hidden"
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    if (selected) void inspect(selected);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black px-4 light:bg-white">
                {previewUrl ? (
                  <video
                    src={previewUrl}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    className="max-h-[285px] max-w-full object-contain"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      if (video.videoWidth && video.videoHeight) {
                        setResolution(`${video.videoWidth} × ${video.videoHeight}`);
                      }
                    }}
                  />
                ) : null}
              </div>

              <div className="border-t border-white/10 px-4 py-3 light:border-black/10">
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-white/80 light:text-black/80">{file.name}</p>
                    <p className="mt-1 truncate text-[11px] text-white/35 light:text-black/35">
                      {formatBytes(file.size)}
                      {resolution ? ` • ${resolution}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-white/40 light:text-black/40">
                    {fps ? `${fps.toFixed(2)} FPS` : "inspecting"}
                    {duration !== null ? ` • ${formatDuration(duration)}` : ""}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 border-t border-white/10 pt-4 light:border-black/10">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35 light:text-black/35">
                {error ? "error" : busy ? "working" : "status"}
              </p>
              <p className="mt-2 text-[13px] leading-6 text-white/60 light:text-black/60">
                {error || status}
              </p>
            </div>
            {file && !busy && !error && fps && (
              <button
                type="button"
                onClick={() => void patch()}
                className="shrink-0 border border-white bg-white px-4 py-2.5 text-[11px] font-medium text-black transition-opacity hover:opacity-80 light:border-black light:bg-black light:text-white"
              >
                {supportsDirectSave ? "patch & save" : "patch & download"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section id="about" className="scroll-mt-20 border-t border-white/10 pt-12 light:border-black/10">
        <h2 className="font-serif text-[28px] tracking-[-0.03em] text-white light:text-black">about</h2>
        <div className="mt-5 space-y-5 text-[13px] leading-7 text-white/50 light:text-black/50">
          <p>
            This tool reproduces the V1 timing approach: the movie header and every media header are adjusted, while track and edit-list timing boxes are left untouched.
          </p>
          <p>
            No frames are re-encoded. On Chrome and Edge, the File System Access API is used when available so large outputs can be written directly to disk in chunks.
          </p>
          {mdhdCount !== null && (
            <p className="text-white/35 light:text-black/35">
              Current file: {mdhdCount} mdhd box{mdhdCount === 1 ? "" : "es"} patched.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
