"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Search, Sun, Moon, X } from "lucide-react";
import SearchModal from "@/components/SearchModal";
import NyxLogo from "@/components/NyxLogo";

const navItems = [
  { name: "Components", href: "/components" },
  { name: "Blocks", href: "/blocks" },
  { name: "Templates", href: "/templates" },
  { name: "Playground", href: "/playground" },
];

export default function Header() {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
  }, []);

  function toggleTheme() {
    const nextDark = !dark;

    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("theme", nextDark ? "dark" : "light");

    setDark(nextDark);
  }

  return (
    <header className="w-full bg-background/80 px-2 backdrop-blur-md">
      {/* Bottom gradient line */}
      <div className="pointer-events-none absolute left-0 top-full h-px w-full">
        <div className="h-full w-full bg-gradient-to-r from-transparent via-zinc-300 to-transparent dark:via-zinc-600" />
      </div>

      <div className="relative z-10 mx-auto flex h-16 items-center justify-between px-4 md:px-6 xl:container xl:px-20">
        {/* Logo + desktop navigation */}
        <div className="flex items-center">
          <Link
            href="/"
            aria-label="Home"
            className="group flex items-center transition-all duration-200"
          >
            <div className="relative flex items-center justify-center overflow-hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-4 border-background transition-all duration-200 md:h-9 md:w-9">
                <NyxLogo />
              </div>
            </div>

            <span className="sr-only text-xl font-bold">Renaissance</span>
          </Link>

          {/* Desktop navigation */}
          <nav className="ml-8 hidden items-center space-x-1 lg:flex">
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative rounded-md px-3 py-2 text-sm font-medium transition-all duration-200
                    hover:bg-muted/50 hover:text-foreground
                    after:absolute after:bottom-0 after:left-1/2 after:h-0.5
                    after:-translate-x-1/2 after:rounded-full after:bg-primary
                    after:transition-all after:duration-200
                    ${
                      isActive
                        ? "bg-muted/30 text-foreground after:w-4/5"
                        : "text-muted-foreground after:w-0 hover:after:w-4/5"
                    }
                  `}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Mobile search */}
        <div className="mx-2 flex flex-1 justify-center lg:hidden">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="flex h-9 w-full max-w-xs items-center justify-center rounded-full border border-muted/30 bg-background px-4 py-2 text-sm text-muted-foreground shadow-sm transition-all duration-200 hover:border-foreground/20 hover:bg-muted/70 hover:text-foreground"
          >
            <Search className="mr-2 h-4 w-4" />
            <span>Search</span>
          </button>
        </div>

        {/* Right side */}
        <div className="flex items-center space-x-2">
          {/* Desktop controls */}
          <div className="hidden items-center space-x-3 lg:flex">
            {/* Search */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="group relative flex h-9 w-54 items-center justify-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm transition-all duration-200 hover:border-foreground/20 hover:bg-muted/70 hover:text-foreground"
              aria-label="Search"
            >
              <Search className="h-4 w-4 shrink-0 transition-colors duration-200" />

              <span className="hidden font-normal md:inline-flex">
                Search
              </span>

              <kbd className="pointer-events-none ml-auto hidden h-5 min-w-5 select-none items-center justify-center rounded border border-border bg-transparent px-1.5 font-mono text-[11px] font-medium transition-colors duration-200 group-hover:border-foreground/20 sm:flex">
                /
              </kbd>
            </button>

            {/* GitHub */}
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-muted/80"
            >
              <GitHubLogo className="h-6 w-6" />
              <span className="sr-only">GitHub</span>
            </a>

            {/* X / Twitter */}
            <a
              href="https://x.com"
              target="_blank"
              rel="noreferrer"
              aria-label="Twitter"
              className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-muted/80"
            >
              <XLogo />
              <span className="sr-only">Twitter</span>
            </a>

            {/* Theme */}
            <ThemeButton dark={dark} onClick={toggleTheme} />
          </div>

          {/* Mobile controls */}
          <div className="flex items-center space-x-1 lg:hidden">
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 hover:bg-muted/80"
            >
              <GitHubLogo className="h-5 w-5" />
            </a>

            <a
              href="https://x.com"
              target="_blank"
              rel="noreferrer"
              aria-label="Twitter"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 hover:bg-muted/80"
            >
              <XLogo />
            </a>

            <ThemeButton dark={dark} onClick={toggleTheme} />

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Open Menu"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 hover:bg-muted/80"
            >
              {menuOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-border bg-background/95 px-4 py-4 backdrop-blur-md lg:hidden">
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      )}

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

function ThemeButton({
  dark,
  onClick,
}: {
  dark: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle theme"
      className="flex h-9 w-9 items-center justify-center rounded-xl px-2 transition-all duration-150 hover:scale-105 hover:bg-accent hover:text-accent-foreground"
    >
      {dark ? (
        <Moon className="h-[1.2rem] w-[1.2rem]" />
      ) : (
        <Sun className="h-[1.2rem] w-[1.2rem]" />
      )}
    </button>
  );
}

function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function XLogo() {
  return (
    <svg
      viewBox="0 0 1200 1227"
      className="h-[17px] w-[17px]"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" />
    </svg>
  );
}
