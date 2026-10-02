"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Github, Moon, Sun } from "lucide-react";

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
      nextDark
        ? "dark"
        : "light",
    );

    setDark(nextDark);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/"
          aria-label="TikTok FPS Patcher home"
          className="flex items-center gap-3"
        >
          <AppLogo />

          <div className="leading-none">
            <div className="text-sm font-semibold tracking-tight">
              TikTok FPS Patcher
            </div>

            <div className="mt-1 text-[10px] text-muted-foreground">
              MP4 metadata utility
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-1">
          <a
            href="https://github.com/realbay/tiktok-fps-patcher"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Github className="h-4 w-4" />

            <span className="hidden sm:inline">
              GitHub
            </span>
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

function AppLogo() {
  return (
    <div
      className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-foreground text-background shadow-sm"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8"
        fill="none"
      >
        <rect
          x="7"
          y="7"
          width="18"
          height="18"
          rx="4"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.35"
        />

        <path
          d="M11 11.5h10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <path
          d="M11 16h7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <path
          d="M11 20.5h4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <path
          d="M21.5 14.5v6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>

      <span className="sr-only">
        TF
      </span>
    </div>
  );
}
