"use client";

import { Github, Moon, Sun } from "lucide-react";
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
            aria-label="TikTok FPS Patcher"
            className="flex items-center gap-3"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <span className="text-[11px] font-bold tracking-tight">TF</span>
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
      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-14 sm:px-6 sm:pt-16">
        {/* Small intro */}
        <section className="mb-9">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            MP4 utility
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            TikTok FPS Patcher
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Patch MP4 timing metadata without re-encoding your video.
            Everything runs locally in your browser.
          </p>
        </section>

        {/* Tool */}
        <section>
          <TikTokPatcher />
        </section>

        {/* Minimal footer info */}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-xs text-muted-foreground">
          <span>Client-side processing</span>
          <span className="hidden sm:inline">•</span>
          <span>No re-encoding</span>
          <span className="hidden sm:inline">•</span>
          <span>60 / 120 FPS</span>
        </div>
      </main>
    </div>
  );
}
