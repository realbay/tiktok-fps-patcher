"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, FileVideo, HardDrive, Lock, RefreshCw, Upload, Zap } from "lucide-react";

type Box = { offset: number; size: number; headerSize: number; type: string };
type Patch = { offset: number; bytes: Uint8Array; label: string };
type TrackInfo = { trak: Box; handler?: string; mdhd?: Box; timescale?: number; stts?: Box };
type ProbeResult = { patches: Patch[]; fps: number; originalDuration: number; outputDuration: number; divider: number; mdhdCount: number };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf", "meta", "udta"]);

function u32(view: DataView, offset: number) { return view.getUint32(offset, false); }
function u64(view: DataView, offset: number) { return view.getUint32(offset, false) * 4294967296 + view.getUint32(offset + 4, false); }
function putU32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, false); }
function putU64(view: DataView, offset: number, value: number) { const hi = Math.floor(value / 4294967296); const lo = value - hi * 4294967296; view.setUint32(offset, hi >>> 0, false); view.setUint32(offset + 4, lo >>> 0, false); }
function ascii(view: DataView, offset: number, length: number) { let value = ""; for (let i = 0; i < length; i += 1) value += String.fromCharCode(view.getUint8(offset + i)); return value; }

async function readBox(file: File, offset: number, limit: number): Promise<Box | null> {
  if (offset + 8 > limit) return null;
  const buffer = await file.slice(offset, Math.min(offset + 16, limit)).arrayBuffer();
  const view = new DataView(buffer); let size = u32(view, 0); const type = ascii(view, 4, 4); let headerSize = 8;
  if (size === 1) { if (view.byteLength < 16) return null; size = u64(view, 8); if (!Number.isSafeInteger(size)) throw new Error("MP4 box is too large for this browser."); headerSize = 16; }
  else if (size === 0) size = limit - offset;
  if (size < headerSize || offset + size > limit) return null;
  return { offset, size, headerSize, type };
}

async function collectBoxes(file: File, start: number, end: number): Promise<Box[]> {
  const boxes: Box[] = []; let position = start;
  while (position + 8 <= end) {
    const box = await readBox(file, position, end); if (!box) break; boxes.push(box);
    if (CONTAINERS.has(box.type)) { const childStart = box.offset + box.headerSize + (box.type === "meta" ? 4 : 0); const childEnd = box.offset + box.size; if (childStart < childEnd) boxes.push(...await collectBoxes(file, childStart, childEnd)); }
    position = box.offset + box.size;
  }
  return boxes;
}

async function findMoov(file: File): Promise<Box> {
  let position = 0;
  while (position + 8 <= file.size) { const box = await readBox(file, position, file.size); if (!box) break; if (box.type === "moov") return box; position = box.offset + box.size; }
  throw new Error("Could not find an MP4 moov box.");
}
async function readFullBox(file: File, box: Box) { const buffer = await file.slice(box.offset + box.headerSize, box.offset + box.headerSize + 4).arrayBuffer(); const view = new DataView(buffer); return { version: view.getUint8(0), flags: (view.getUint8(1) << 16) | (view.getUint8(2) << 8) | view.getUint8(3) }; }
async function readMdhd(file: File, box: Box) { const { version } = await readFullBox(file, box); const base = box.offset + box.headerSize + 4; const buffer = await file.slice(base, base + (version === 1 ? 32 : 20)).arrayBuffer(); const view = new DataView(buffer); return version === 1 ? { version, timescale: u32(view, 16), duration: u64(view, 20) } : { version, timescale: u32(view, 8), duration: u32(view, 12) }; }
async function readMvhd(file: File, box: Box) { const { version } = await readFullBox(file, box); const base = box.offset + box.headerSize + 4; const buffer = await file.slice(base, base + (version === 1 ? 32 : 20)).arrayBuffer(); const view = new DataView(buffer); return version === 1 ? { version, timescale: u32(view, 16), duration: u64(view, 20) } : { version, timescale: u32(view, 8), duration: u32(view, 12) }; }
async function readHandlerType(file: File, box: Box) { const start = box.offset + box.headerSize + 8; return ascii(new DataView(await file.slice(start, start + 4).arrayBuffer()), 0, 4); }
async function readSttsAverageFps(file: File, stts: Box, timescale: number) {
  const start = stts.offset + stts.headerSize + 4; const header = await file.slice(start, start + 4).arrayBuffer(); const count = u32(new DataView(header), 0); if (!count) return null;
  let totalSamples = 0; let totalDuration = 0; const chunkSize = 1024 * 1024; const entriesBytes = count * 8; if (entriesBytes > Number.MAX_SAFE_INTEGER) return null;
  for (let offset = 0; offset < entriesBytes; offset += chunkSize) { const length = Math.min(chunkSize, entriesBytes - offset); const view = new DataView(await file.slice(start + 4 + offset, start + 4 + offset + length).arrayBuffer()); for (let position = 0; position + 8 <= length; position += 8) { const sampleCount = u32(view, position); const sampleDelta = u32(view, position + 4); totalSamples += sampleCount; totalDuration += sampleCount * sampleDelta; } }
  if (!totalDuration || !totalSamples || !timescale) return null; return (totalSamples * timescale) / totalDuration;
}
function copyBytes(bytes: Uint8Array): ArrayBuffer { const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); return buffer; }

async function buildPatch(file: File, divider: number): Promise<ProbeResult> {
  const moov = await findMoov(file); const allMoovBoxes = await collectBoxes(file, moov.offset + moov.headerSize, moov.offset + moov.size); const mvhd = allMoovBoxes.find((box) => box.type === "mvhd"); if (!mvhd) throw new Error("Could not find mvhd.");
  const trakBoxes = allMoovBoxes.filter((box) => box.type === "trak"); const tracks: TrackInfo[] = [];
  for (const trak of trakBoxes) { const children = await collectBoxes(file, trak.offset + trak.headerSize, trak.offset + trak.size); const mdhd = children.find((box) => box.type === "mdhd"); const hdlr = children.find((box) => box.type === "hdlr"); const stts = children.find((box) => box.type === "stts"); const track: TrackInfo = { trak, mdhd, stts }; if (mdhd) track.timescale = (await readMdhd(file, mdhd)).timescale; if (hdlr) track.handler = await readHandlerType(file, hdlr); tracks.push(track); }
  const video = tracks.find((track) => track.handler === "vide" && track.mdhd && track.timescale && track.stts); if (!video || !video.mdhd || !video.timescale || !video.stts) throw new Error("Could not identify the video track / frame timing.");
  const fps = await readSttsAverageFps(file, video.stts, video.timescale); if (!fps) throw new Error("Could not determine the source FPS."); const expected = divider === 4 ? 120 : 60; if (Math.abs(fps - expected) > 5) throw new Error(`Detected approximately ${fps.toFixed(3)} FPS, not ${expected} FPS.`);
  const mv = await readMvhd(file, mvhd); const patches: Patch[] = []; const mvBytes = new Uint8Array(await file.slice(mvhd.offset, mvhd.offset + mvhd.size).arrayBuffer()); const mvView = new DataView(mvBytes.buffer); const mvBase = mvhd.headerSize + 4; const mvTimescaleOffset = mv.version === 1 ? mvBase + 16 : mvBase + 8; const mvDurationOffset = mv.version === 1 ? mvBase + 20 : mvBase + 12; const newMvTimescale = Math.max(1, Math.floor(mv.timescale / divider)); const newMvDuration = Math.max(1, Math.floor(mv.duration / divider)); putU32(mvView, mvTimescaleOffset, newMvTimescale); if (mv.version === 1) putU64(mvView, mvDurationOffset, newMvDuration); else putU32(mvView, mvDurationOffset, newMvDuration); patches.push({ offset: mvhd.offset, bytes: mvBytes, label: "mvhd" });
  const mdhdBoxes = tracks.map((track) => track.mdhd).filter((box): box is Box => Boolean(box));
  for (const mdhdBox of mdhdBoxes) { const md = await readMdhd(file, mdhdBox); const mdBytes = new Uint8Array(await file.slice(mdhdBox.offset, mdhdBox.offset + mdhdBox.size).arrayBuffer()); const mdView = new DataView(mdBytes.buffer); const mdBase = mdhdBox.headerSize + 4; const mdTimescaleOffset = md.version === 1 ? mdBase + 16 : mdBase + 8; const mdDurationOffset = md.version === 1 ? mdBase + 20 : mdBase + 12; const newMdTimescale = Math.max(1, Math.floor(md.timescale / divider)); const newMdDuration = Math.max(1, Math.floor(md.duration / divider)); putU32(mdView, mdTimescaleOffset, newMdTimescale); if (md.version === 1) putU64(mdView, mdDurationOffset, newMdDuration); else putU32(mdView, mdDurationOffset, newMdDuration); patches.push({ offset: mdhdBox.offset, bytes: mdBytes, label: "mdhd" }); }
  patches.sort((a, b) => a.offset - b.offset); return { patches, fps, originalDuration: mv.duration / mv.timescale, outputDuration: newMvDuration / newMvTimescale, divider, mdhdCount: mdhdBoxes.length };
}

async function saveWithFileSystemAccess(file: File, patches: Patch[], name: string) {
  const picker = (window as Window & { showSaveFilePicker?: (options?: unknown) => Promise<any> }).showSaveFilePicker; if (!picker) return false;
  const handle = await picker({ suggestedName: name, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] }); const writable = await handle.createWritable(); let sourcePosition = 0; const chunkSize = 32 * 1024 * 1024;
  try { for (const patch of patches) { while (sourcePosition < patch.offset) { const end = Math.min(patch.offset, sourcePosition + chunkSize); await writable.write(await file.slice(sourcePosition, end).arrayBuffer()); sourcePosition = end; } await writable.write(copyBytes(patch.bytes)); sourcePosition = patch.offset + patch.bytes.byteLength; } while (sourcePosition < file.size) { const end = Math.min(file.size, sourcePosition + chunkSize); await writable.write(await file.slice(sourcePosition, end).arrayBuffer()); sourcePosition = end; } await writable.close(); return true; } catch (error) { try { await writable.abort(); } catch {} throw error; }
}
function makeBlob(file: File, patches: Patch[]) { const parts: BlobPart[] = []; let position = 0; for (const patch of patches) { if (position < patch.offset) parts.push(file.slice(position, patch.offset)); parts.push(copyBytes(patch.bytes)); position = patch.offset + patch.bytes.byteLength; } if (position < file.size) parts.push(file.slice(position)); return new Blob(parts, { type: "video/mp4" }); }

export default function TikTokPatcher() {
  const [file, setFile] = useState<File | null>(null); const [fps, setFps] = useState<number | null>(null); const [duration, setDuration] = useState<number | null>(null); const [resolution, setResolution] = useState<string | null>(null); const [previewUrl, setPreviewUrl] = useState<string | null>(null); const [mdhdCount, setMdhdCount] = useState<number | null>(null); const [status, setStatus] = useState("Drop a 60 or 120 FPS MP4 to begin."); const [busy, setBusy] = useState(false); const [dragging, setDragging] = useState(false); const [error, setError] = useState("");
  const supportsDirectSave = useMemo(() => typeof window !== "undefined" && "showSaveFilePicker" in window, []);
  useEffect(() => { if (!file) { setPreviewUrl(null); return; } const url = URL.createObjectURL(file); setPreviewUrl(url); return () => URL.revokeObjectURL(url); }, [file]);

  const inspect = useCallback(async (selected: File) => {
    if (!selected.name.toLowerCase().endsWith(".mp4") && selected.type !== "video/mp4") { setError("Please choose an MP4 video."); setStatus("Could not inspect the file."); return; }
    setError(""); setFile(selected); setFps(null); setDuration(null); setResolution(null); setMdhdCount(null); setStatus("Reading MP4 timing metadata…");
    try { const probe = await buildPatch(selected, 4); setFps(probe.fps); setDuration(probe.originalDuration); setMdhdCount(probe.mdhdCount); setStatus(`Detected ${probe.fps.toFixed(2)} FPS • ${formatDuration(probe.originalDuration)} • ready to patch.`); }
    catch (firstError) { try { const probe = await buildPatch(selected, 2); setFps(probe.fps); setDuration(probe.originalDuration); setMdhdCount(probe.mdhdCount); setStatus(`Detected ${probe.fps.toFixed(2)} FPS • ${formatDuration(probe.originalDuration)} • ready to patch.`); } catch { setError(firstError instanceof Error ? firstError.message : "Could not inspect this MP4."); setStatus("Could not inspect the file."); } }
  }, []);

  async function patch() {
    if (!file || !fps) return; setBusy(true); setError(""); setStatus("Preparing patch…");
    try { const divider = Math.abs(fps - 120) < 5 ? 4 : 2; const result = await buildPatch(file, divider); const base = file.name.replace(/\.mp4$/i, ""); const outputName = `${base}_metadata_output.mp4`;
      if (supportsDirectSave) { setStatus("Writing patched MP4 directly to disk…"); await saveWithFileSystemAccess(file, result.patches, outputName); }
      else { setStatus("Preparing browser download…"); const blob = makeBlob(file, result.patches); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = outputName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
      setStatus(`Done • ${formatDuration(result.outputDuration)} duration preserved.`);
    } catch (patchError) { setError(patchError instanceof Error ? patchError.message : "Patch failed."); setStatus("Patch failed."); } finally { setBusy(false); }
  }

  const ready = Boolean(file && fps && !busy && !error);

  return (
    <main id="home" className="mx-auto w-full max-w-[1040px] px-5 pb-28 sm:px-8">
      <section className="relative pt-16 sm:pt-20">
        <div className="absolute -left-20 top-8 hidden h-48 w-48 rounded-full bg-white/[0.025] blur-3xl sm:block" />
        <div className="relative flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-[700px]">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-cyan-300/60">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/70 shadow-[0_0_12px_rgba(103,232,249,0.5)]" />
              browser utility
            </div>
            <h1 className="mt-4 font-serif text-[44px] leading-[0.94] tracking-[-0.055em] text-white sm:text-[64px]">tiktok fps patcher</h1>
            <p className="mt-6 max-w-[650px] text-[14px] leading-7 text-white/48 sm:text-[15px]">
              Patch the timing metadata used by the working 60/120 FPS method without re-encoding the video. Everything runs locally in your browser.
            </p>
          </div>
          <div className="hidden shrink-0 pb-1 sm:block">
            <div className="flex items-center gap-2 border border-white/10 bg-white/[0.025] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-white/45">
              <Lock className="h-3 w-3" strokeWidth={1.5} /> local only
            </div>
          </div>
        </div>
      </section>

      <section id="patcher" className="scroll-mt-20 pt-12">
        {!file ? (
          <div className="grid gap-3 lg:grid-cols-[1fr_270px]">
            <div
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); const dropped = event.dataTransfer.files?.[0]; if (dropped) void inspect(dropped); }}
              className={`group relative min-h-[390px] overflow-hidden border transition-all ${dragging ? "border-cyan-300/50 bg-cyan-300/[0.035]" : "border-white/12 bg-white/[0.018] hover:border-white/20 hover:bg-white/[0.025]"}`}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.025] blur-3xl transition-opacity group-hover:opacity-100" />
              <div className="relative flex min-h-[390px] flex-col items-center justify-center px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center border border-white/12 bg-black/40 text-white/60">
                  {dragging ? <Upload className="h-5 w-5" strokeWidth={1.4} /> : <FileVideo className="h-5 w-5" strokeWidth={1.4} />}
                </div>
                <p className="mt-6 font-serif text-[29px] tracking-[-0.035em] text-white">drop your video</p>
                <p className="mt-3 max-w-[430px] text-[13px] leading-6 text-white/38">Drop a 60 or 120 FPS MP4 here. The original file stays untouched and the patched copy is written without re-encoding.</p>
                <label className="mt-7 flex cursor-pointer items-center gap-2 bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-black transition-transform hover:-translate-y-0.5">
                  choose mp4 <Upload className="h-3.5 w-3.5" strokeWidth={2} />
                  <input type="file" accept="video/mp4,.mp4" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void inspect(selected); event.currentTarget.value = ""; }} />
                </label>
              </div>
              <div className="absolute bottom-0 left-0 right-0 grid grid-cols-3 border-t border-white/8 bg-black/20">
                {["no re-encode", "large-file ready", "runs locally"].map((item) => <div key={item} className="flex items-center justify-center gap-2 border-r border-white/8 py-3 text-[9px] uppercase tracking-[0.15em] text-white/30 last:border-r-0"><Check className="h-3 w-3 text-white/50" strokeWidth={1.5} />{item}</div>)}
              </div>
            </div>
            <aside className="border border-white/10 bg-white/[0.018] p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">supported input</p>
              <div className="mt-5 space-y-5">
                <InfoRow icon={<Zap />} title="60 / 120 FPS" text="Automatic FPS detection" />
                <InfoRow icon={<HardDrive />} title="Large MP4s" text="Written in 32 MiB chunks" />
                <InfoRow icon={<Lock />} title="Private" text="No upload or server processing" />
              </div>
              <div className="mt-8 border-t border-white/8 pt-5 text-[11px] leading-5 text-white/28">The patch changes movie and media timing metadata only. Video frames are never re-encoded.</div>
            </aside>
          </div>
        ) : (
          <div className="border border-white/12 bg-white/[0.018]">
            <div className="flex flex-col lg:grid lg:grid-cols-[1.35fr_0.65fr]">
              <div className="relative min-h-[360px] border-b border-white/10 bg-black lg:border-b-0 lg:border-r">
                <div className="absolute left-4 top-4 z-10 flex items-center gap-2 border border-white/10 bg-black/80 px-2.5 py-1.5 text-[9px] uppercase tracking-[0.15em] text-white/45"><FileVideo className="h-3 w-3" /> source preview</div>
                <div className="flex h-[360px] items-center justify-center p-5">
                  {previewUrl ? <video src={previewUrl} controls muted playsInline preload="metadata" className="max-h-full max-w-full object-contain" onLoadedMetadata={(event) => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setResolution(`${video.videoWidth} × ${video.videoHeight}`); }} /> : null}
                </div>
              </div>
              <div className="flex flex-col">
                <div className="border-b border-white/10 p-5">
                  <div className="flex items-center justify-between gap-3"><p className="text-[10px] uppercase tracking-[0.2em] text-white/30">file</p><button type="button" onClick={() => { setFile(null); setFps(null); setDuration(null); setResolution(null); setMdhdCount(null); setError(""); setStatus("Drop a 60 or 120 FPS MP4 to begin."); }} className="text-[10px] uppercase tracking-[0.14em] text-white/35 transition-colors hover:text-white">change</button></div>
                  <p className="mt-3 truncate text-[13px] text-white/80" title={file.name}>{file.name}</p>
                  <p className="mt-1 text-[11px] text-white/30">{formatBytes(file.size)}</p>
                </div>
                <div className="grid grid-cols-2">
                  <Metric label="frame rate" value={fps ? `${fps.toFixed(2)} FPS` : "—"} />
                  <Metric label="duration" value={duration !== null ? formatDuration(duration) : "—"} />
                  <Metric label="resolution" value={resolution || "reading…"} />
                  <Metric label="media headers" value={mdhdCount !== null ? `${mdhdCount} mdhd` : "—"} />
                </div>
                <div className="mt-auto border-t border-white/10 p-5">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-cyan-300/65"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.45)]" /> {busy ? "processing" : error ? "error" : "ready"}</div>
                  <p className="mt-3 text-[12px] leading-5 text-white/42">{error || status}</p>
                  {ready && <button type="button" onClick={() => void patch()} className="mt-5 flex w-full items-center justify-center gap-2 bg-white px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black transition-transform hover:-translate-y-0.5">{supportsDirectSave ? "patch & save" : "patch & download"}<Zap className="h-3.5 w-3.5" fill="currentColor" /></button>}
                  {busy && <div className="mt-5 flex items-center justify-center gap-2 border border-white/10 py-3 text-[10px] uppercase tracking-[0.14em] text-white/40"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> working</div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <Feature number="01" title="inspect" text="Reads MP4 timing metadata without loading the whole file into memory." />
        <Feature number="02" title="patch" text="Adjusts mvhd and every mdhd box using the proven timing method." />
        <Feature number="03" title="save" text="Writes a new MP4 directly to disk when your browser supports it." />
      </section>

      <section id="about" className="scroll-mt-20 border-t border-white/10 pt-12 mt-20">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] uppercase tracking-[0.2em] text-white/30">under the hood</p><h2 className="mt-3 font-serif text-[31px] tracking-[-0.035em] text-white">about the patch</h2></div><div className="max-w-[540px] space-y-4 text-[13px] leading-7 text-white/42"><p>This tool reproduces the V1 timing approach: the movie header and every media header are adjusted, while track and edit-list timing boxes are left untouched.</p><p>No frames are re-encoded. On Chrome and Edge, the File System Access API is used when available so large outputs can be written directly to disk in chunks.</p>{mdhdCount !== null && <p className="text-white/28">Current file: {mdhdCount} mdhd box{mdhdCount === 1 ? "" : "es"} patched.</p>}</div></div>
      </section>
    </main>
  );
}

function InfoRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="flex gap-3"><div className="mt-0.5 text-white/35 [&>svg]:h-4 [&>svg]:w-4" >{icon}</div><div><p className="text-[11px] text-white/65">{title}</p><p className="mt-1 text-[10px] leading-4 text-white/28">{text}</p></div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="border-b border-r border-white/8 p-4 last:border-r-0"><p className="text-[9px] uppercase tracking-[0.15em] text-white/25">{label}</p><p className="mt-2 truncate text-[12px] text-white/65">{value}</p></div>; }
function Feature({ number, title, text }: { number: string; title: string; text: string }) { return <div className="border border-white/8 bg-white/[0.014] p-4"><div className="flex items-center justify-between"><span className="font-mono text-[9px] text-white/20">{number}</span><span className="h-px w-10 bg-white/10" /></div><p className="mt-5 font-serif text-[20px] text-white/85">{title}</p><p className="mt-2 text-[11px] leading-5 text-white/30">{text}</p></div>; }
function formatBytes(bytes: number) { const units = ["B", "KB", "MB", "GB", "TB"]; let value = bytes; let index = 0; while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; } return `${value.toFixed(value >= 100 || index === 0 ? 0 : 2)} ${units[index]}`; }
function formatDuration(seconds: number) { const totalSeconds = Math.max(0, Math.round(seconds)); const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const remainingSeconds = totalSeconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}` : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`; }
