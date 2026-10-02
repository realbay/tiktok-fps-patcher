"use client";

import Link from "next/link";
import {
  Github,
  Moon,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";

const DISCORD_URL =
  "https://discord.gg/B5BK9GMN87";

const GITHUB_URL =
  "https://github.com";

export default function Header() {
  const [dark, setDark] =
    useState(false);

  useEffect(() => {
    setDark(
      document.documentElement.classList.contains(
        "dark",
      ),
    );
  }, []);

  function toggleTheme() {
    const nextDark = !dark;

    document.documentElement.classList.toggle(
      "dark",
      nextDark,
    );

    localStorage.setItem(
      "theme",
      nextDark ? "dark" : "light",
    );

    setDark(nextDark);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#111214]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-3"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1e1f22]">
            <span className="text-xs font-bold text-[#dcdee1]">
              TF
            </span>
          </div>

          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-[#f2f3f5]">
              TikTok FPS Patcher
            </p>

            <p className="text-[11px] text-[#727780]">
              MP4 metadata utility
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-1">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#b5bac1] transition hover:bg-white/[0.05] hover:text-[#f2f3f5]"
          >
            Discord
          </a>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#b5bac1] transition hover:bg-white/[0.05] hover:text-[#f2f3f5]"
          >
            <Github className="h-4 w-4" />
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#b5bac1] transition hover:bg-white/[0.05] hover:text-[#f2f3f5]"
          >
            {dark ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
