"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import NyxLogo from "@/components/NyxLogo";

const columns = [
  {
    title: "Pages",
    links: [
      { name: "Home", href: "/" },
      { name: "All Components", href: "/components" },
      { name: "Documentation", href: "/docs" },
      { name: "Templates", href: "/templates" },
      { name: "Playground", href: "/playground" },
    ],
  },
  {
    title: "Templates",
    links: [
      { name: "Single Page Portfolio", href: "/templates/singlepage-portfolio" },
      { name: "Minimalist Portfolio", href: "/templates/minimalist-portfolio" },
    ],
  },
  {
    title: "Components",
    links: [
      { name: "3D layered Card", href: "/components/3d-layered-card" },
      { name: "Animated Code Block", href: "/components/animated-code-block" },
      { name: "Apple Glass Effect", href: "/components/apple-glass-effect" },
      { name: "More", href: "/components" },
    ],
  },
  {
    title: "Blocks",
    links: [{ name: "Footer", href: "/blocks/footer" }],
  },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3.5 text-muted-foreground transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FooterNav() {
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:items-start sm:gap-8"
    >
      {columns.map((column, index) => {
        const isOpen = open === column.title;
        const alignEnd = index >= columns.length - 2;

        return (
          <div key={column.title} className="relative">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`footer-${column.title.toLowerCase()}`}
              onClick={() =>
                setOpen((current) =>
                  current === column.title ? null : column.title,
                )
              }
              className="flex items-center gap-1.5 text-sm font-medium"
            >
              {column.title}
              <ChevronIcon open={isOpen} />
            </button>

            {isOpen ? (
              <div
                id={`footer-${column.title.toLowerCase()}`}
                className={`mt-3 space-y-2 text-sm md:absolute md:bottom-[calc(100%+0.75rem)] md:mt-0 md:min-w-48 md:rounded-md md:border md:border-border md:bg-background md:p-3 md:shadow-lg ${
                  alignEnd ? "md:right-0 md:left-auto" : "md:left-0"
                }`}
              >
                {column.links.map((item) => (
                  <Link
                    key={`${column.title}-${item.href}-${item.name}`}
                    href={item.href}
                    onClick={() => setOpen(null)}
                    className="block whitespace-nowrap text-muted-foreground duration-150 hover:text-primary"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export default function Footer() {
  return (
    <footer className="relative z-10 overflow-visible border-t border-border bg-background pt-10">
      <div className="mx-auto px-4 md:px-6 xl:container xl:px-20">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <Link
            href="/"
            aria-label="Home"
            className="flex size-fit items-end justify-center gap-3"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-4 border-background transition-all duration-200">
              <NyxLogo />
            </div>
            <span className="text-xl font-bold">Renaissance</span>
          </Link>

          <FooterNav />
        </div>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6 border-t border-border py-5">
          <span className="order-last block text-center text-sm text-muted-foreground md:order-first">
            © {new Date().getFullYear()} Renaissance, All rights reserved
          </span>

          <div className="order-first flex flex-wrap justify-center gap-6 text-sm md:order-last">
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X/Twitter"
              className="block rounded-full text-primary transition-all duration-300 hover:scale-105 hover:bg-muted/80"
            >
              <svg
                className="size-6"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M10.488 14.651L15.25 21h7l-7.858-10.478L20.93 3h-2.65l-5.117 5.886L8.75 3h-7l7.51 10.015L2.32 21h2.65zM16.25 19L5.75 5h2l10.5 14z"
                />
              </svg>
            </a>
            <a
              href="https://www.linkedin.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="block rounded-full text-primary transition-all duration-300 hover:scale-105 hover:bg-muted/80"
            >
              <svg
                className="size-6"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93zM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37z"
                />
              </svg>
            </a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="block rounded-full text-primary transition-all duration-300 hover:scale-105 hover:bg-muted/80"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-6"
                aria-hidden="true"
              >
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
