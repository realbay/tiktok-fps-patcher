"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Github, MessageCircle, Moon, Sun } from "lucide-react";

const navItems = [
  { name: "home", href: "#home" },
  { name: "patcher", href: "#patcher" },
  { name: "about", href: "#about" },
];

export default function Header() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const shouldBeLight = saved === "light";
    document.documentElement.classList.toggle("light", shouldBeLight);
    setDark(!shouldBeLight);
  }, []);

  function toggleTheme() {
    const nextDark = !dark;
    document.documentElement.classList.toggle("light", !nextDark);
    localStorage.setItem("theme", nextDark ? "dark" : "light");
    setDark(nextDark);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/95 backdrop-blur-sm light:border-black/10 light:bg-white/95">
      <div className="mx-auto flex h-[50px] w-full max-w-[900px] items-center justify-between px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-6 sm:gap-8">
          <Link
            href="#home"
            className="shrink-0 font-serif text-[17px] tracking-[-0.03em] text-white light:text-black"
          >
            fps
          </Link>

          <nav className="flex items-center gap-4 overflow-x-auto sm:gap-6">
            {navItems.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className={`relative whitespace-nowrap py-[17px] text-[11px] tracking-wide transition-colors ${
                  index === 0
                    ? "text-white light:text-black"
                    : "text-white/45 hover:text-white light:text-black/45 light:hover:text-black"
                }`}
              >
                {item.name}
                {index === 0 && (
                  <span className="absolute bottom-0 left-0 h-px w-full bg-white light:bg-black" />
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="ml-3 flex shrink-0 items-center gap-3 text-white/60 light:text-black/60">
          <a
            href="https://discord.gg/B5BK9GMN87"
            target="_blank"
            rel="noreferrer"
            aria-label="Discord"
            className="transition-colors hover:text-white light:hover:text-black"
          >
            <MessageCircle className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </a>

          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="transition-colors hover:text-white light:hover:text-black"
          >
            <Github className="h-[15px] w-[15px]" strokeWidth={1.6} />
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="transition-colors hover:text-white light:hover:text-black"
          >
            {dark ? (
              <Moon className="h-[15px] w-[15px]" strokeWidth={1.6} />
            ) : (
              <Sun className="h-[15px] w-[15px]" strokeWidth={1.6} />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
