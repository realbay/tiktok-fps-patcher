"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

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
    const nextDark =
      !dark;

    document.documentElement.classList.toggle(
      "dark",
      nextDark,
    );

    localStorage.setItem(
      "theme",
      nextDark
        ? "dark"
        : "light",
    );

    setDark(
      nextDark,
    );
  }

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-3"
          aria-label="TikTok FPS Patcher"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background transition-transform group-hover:scale-[1.03]">
            <FilmMark />
          </div>

          <div className="leading-none">
            <div className="text-sm font-semibold tracking-tight">
              TikTok FPS Patcher
            </div>

            <div className="mt-1 text-[11px] text-muted-foreground">
              MP4 metadata utility
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-1">
          <a
            href="https://github.com/realbay/tiktok-fps-patcher"
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            GitHub
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
