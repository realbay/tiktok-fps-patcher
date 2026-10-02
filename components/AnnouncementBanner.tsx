"use client";

import { useEffect, useState } from "react";

const HIDE_AFTER = 64;
const SHOW_AT = 0;

export default function AnnouncementBanner() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;

      setHidden((isHidden) => {
        if (!isHidden && y > HIDE_AFTER) return true;
        if (isHidden && y <= SHOW_AT) return false;
        return isHidden;
      });
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${
        hidden ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className="w-full bg-gradient-to-r from-purple-600 via-blue-600 to-pink-600 px-4 py-1 font-sans text-sm font-medium tracking-tight text-white"
          style={{
            backgroundSize: "300% 100%",
            animation:
              "gradientMove 14s ease-in-out infinite, hueShift 36s linear infinite",
          }}
        >
          <h1 className="text-center">
            TikTok Metadata Patcher{" "}
            <span className="rounded-sm px-1 py-[3px] font-bold">
              FAST Web v1.0
            </span>{" "}
            <span className="hidden md:inline">
              - Runs locally in your browser. No video upload.
            </span>
          </h1>
        </div>
      </div>
    </div>
  );
}
