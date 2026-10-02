"use client";

import {
  ArrowUpRight,
  Check,
  Github,
  Moon,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import TikTokPatcher from "@/components/TikTokPatcher";

export default function Home() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const nextDark = !dark;

    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("theme", nextDark ? "dark" : "light");

    setDark(nextDark);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
          <a
            href="/"
            className="flex items-center gap-3"
            aria-label="TikTok FPS Patcher home"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <span className="text-xs font-bold tracking-tight">TF</span>
            </div>

            <div className="leading-none">
              <div className="text-sm font-semibold tracking-tight">
                TikTok FPS Patcher
              </div>
              <div className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
                MP4 metadata utility
              </div>
            </div>
          </a>

          <div className="flex items-center gap-1">
            <a
              href="https://github.com/realbay/tiktok-fps-patcher"
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {dark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-14 sm:px-6 sm:pt-20">
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Runs entirely in your browser
          </div>

          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl md:text-6xl">
            TikTok FPS Patcher
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Patch MP4 timing metadata without re-encoding your video.
            Everything happens locally on your device.
          </p>
        </section>

        {/* Patcher */}
        <section className="mx-auto mt-10 max-w-4xl">
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <TikTokPatcher />
          </div>
        </section>

        {/* Trust row */}
        <section className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-3">
          <InfoCard
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Private"
            description="Your video stays on your device."
          />

          <InfoCard
            icon={<Zap className="h-4 w-4" />}
            title="No re-encode"
            description="The video and audio streams are copied unchanged."
          />

          <InfoCard
            icon={<Check className="h-4 w-4" />}
            title="60 / 120 FPS"
            description="Designed for the supported TikTok timing method."
          />
        </section>

        {/* How it works */}
        <section className="mx-auto mt-20 max-w-4xl border-t border-border pt-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                How it works
              </p>

              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Three simple steps
              </h2>
            </div>

            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              The tool changes MP4 timing metadata locally instead of
              rendering the video again.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Step
              number="01"
              title="Choose your MP4"
              description="Select the 60 or 120 FPS video you want to patch."
            />

            <Step
              number="02"
              title="Patch metadata"
              description="The supported MP4 timing fields are modified without re-encoding."
            />

            <Step
              number="03"
              title="Save the result"
              description="Save the patched MP4 directly back to your computer."
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="mx-auto mt-20 flex max-w-4xl flex-col gap-4 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            TikTok FPS Patcher
          </span>

          <div className="flex items-center gap-4">
            <span>Client-side</span>

            <a
              href="https://github.com/realbay/tiktok-fps-patcher"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Source
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>

        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-mono text-xs text-muted-foreground">{number}</div>

      <h3 className="mt-8 text-sm font-semibold">{title}</h3>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
