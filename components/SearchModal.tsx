"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  Blocks,
  Box,
  FileText,
  House,
  LayoutTemplate,
  Play,
  Search,
  X,
} from "lucide-react";
import {
  searchGroups,
  searchItems,
  type SearchGroup,
  type SearchItem,
} from "@/lib/search";

const easeOutExpo = [0.16, 1, 0.3, 1] as const;
const easeInExpo = [0.7, 0, 0.84, 0] as const;

const containerVariants = {
  hidden: {
    transition: { when: "afterChildren" as const },
  },
  visible: {
    transition: { when: "beforeChildren" as const, staggerChildren: 0.03 },
  },
};

const overlayVariants = {
  hidden: {
    opacity: 0,
    transition: { duration: 0.26, ease: easeInExpo },
  },
  visible: {
    opacity: 1,
    transition: { duration: 0.36, ease: easeOutExpo },
  },
};

const panelVariants = {
  hidden: {
    opacity: 0,
    scale: 0.42,
    transition: {
      opacity: { duration: 0.14, ease: easeInExpo },
      scale: { type: "spring" as const, duration: 0.4, bounce: 0 },
    },
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      opacity: { duration: 0.22, ease: easeOutExpo },
      scale: { type: "spring" as const, duration: 0.58, bounce: 0.12 },
    },
  },
};

const contentVariants = {
  hidden: {
    opacity: 0,
    transition: { duration: 0.1, ease: easeInExpo },
  },
  visible: {
    opacity: 1,
    transition: { duration: 0.24, delay: 0.04, ease: easeOutExpo },
  },
};

function GroupIcon({ group }: { group: SearchGroup }) {
  const className = "h-4 w-4";

  if (group === "Pages") return <House className={className} />;
  if (group === "Blocks") return <Blocks className={className} />;
  if (group === "Templates") return <LayoutTemplate className={className} />;
  return <Box className={className} />;
}

function ItemIcon({ item }: { item: SearchItem }) {
  const className = "h-4 w-4";

  switch (item.href) {
    case "/":
      return <House className={className} />;
    case "/components":
      return <Box className={className} />;
    case "/blocks":
      return <Blocks className={className} />;
    case "/templates":
      return <LayoutTemplate className={className} />;
    case "/playground":
      return <Play className={className} />;
    case "/docs":
      return <FileText className={className} />;
    default:
      return <GroupIcon group={item.group} />;
  }
}

export default function SearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "/" && !open) {
        const target = event.target as HTMLElement;
        const isTyping =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (!isTyping) {
          event.preventDefault();
          onOpenChange(true);
        }
      }

      if (event.key === "Escape" && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 140);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  function selectItem(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="search-modal"
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={containerVariants}
        >
          <motion.button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 bg-black/45"
            variants={overlayVariants}
            onClick={() => onOpenChange(false)}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="search-dialog-title"
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
            variants={panelVariants}
            style={{ originX: 0.5, originY: 0.5, willChange: "transform, opacity" }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="search-dialog-title" className="sr-only">
              Search Renaissance
            </h2>

            <motion.div variants={contentVariants}>

          <Command
            loop
            className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-background text-foreground"
          >
            <div className="flex items-center border-b border-border/70 px-4 pr-12">
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                ref={inputRef}
                autoFocus
                placeholder="Search pages, components, blocks..."
                className="flex h-14 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <Command.List className="search-scroll max-h-96 overflow-y-auto overflow-x-hidden p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                No results found.
              </Command.Empty>

              {searchGroups.map((group, index) => (
                <Fragment key={group}>
                  {index > 0 && (
                    <Command.Separator className="-mx-1 h-px bg-border" />
                  )}
                  <Command.Group
                    heading={group}
                    className="overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {searchItems
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <Command.Item
                          key={item.href}
                          value={`${item.title} ${item.href} ${item.description}`}
                          onSelect={() => selectItem(item.href)}
                          className="group relative flex cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2.5 text-sm outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-muted data-[selected=true]:text-foreground data-[disabled=true]:opacity-50"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-data-[selected=true]:text-foreground">
                            <ItemIcon item={item} />
                          </div>
                          <div className="min-w-0 flex-1 truncate">
                            <span className="text-sm font-medium">
                              {item.title}
                            </span>
                            <span className="ml-2 hidden truncate text-xs text-muted-foreground md:inline">
                              {item.description}
                            </span>
                          </div>
                        </Command.Item>
                      ))}
                  </Command.Group>
                </Fragment>
              ))}
            </Command.List>
          </Command>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
            </motion.div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
