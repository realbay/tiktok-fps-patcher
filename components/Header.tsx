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
  useEffect(() => { const saved = localStorage.getItem("theme"); const light = saved === "light"; document.documentElement.classList.toggle("light", light); setDark(!light); }, []);
  function toggleTheme() { const nextDark = !dark; document.documentElement.classList.toggle("light", !nextDark); localStorage.setItem("theme", nextDark ? "dark" : "light"); setDark(nextDark); }
  return <header className="sticky top-0 z-50 border-b border-white/8 bg-black/90 backdrop-blur-xl light:border-black/10 light:bg-white/90">
    <div className="mx-auto flex h-[52px] w-full max-w-[1040px] items-center justify-between px-5 sm:px-8">
      <div className="flex items-center gap-7"><Link href="#home" className="font-serif text-[18px] tracking-[-0.04em] text-white light:text-black">fps</Link><nav className="flex items-center gap-5 sm:gap-7">{navItems.map((item,index)=><Link key={item.href} href={item.href} className={`relative py-[18px] text-[10px] tracking-[0.04em] transition-colors ${index===0?"text-white light:text-black":"text-white/38 hover:text-white light:text-black/38 light:hover:text-black"}`}>{item.name}{index===0&&<span className="absolute bottom-0 left-0 h-px w-full bg-white light:bg-black"/>}</Link>)}</nav></div>
      <div className="flex items-center gap-3 text-white/45 light:text-black/45"><a href="https://discord.gg/B5BK9GMN87" target="_blank" rel="noreferrer" aria-label="Discord" className="transition-colors hover:text-white light:hover:text-black"><MessageCircle className="h-[14px] w-[14px]" strokeWidth={1.5}/></a><a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub" className="transition-colors hover:text-white light:hover:text-black"><Github className="h-[14px] w-[14px]" strokeWidth={1.5}/></a><button type="button" onClick={toggleTheme} aria-label="Toggle theme" className="transition-colors hover:text-white light:hover:text-black">{dark?<Moon className="h-[14px] w-[14px]" strokeWidth={1.5}/>:<Sun className="h-[14px] w-[14px]" strokeWidth={1.5}/>}</button></div>
    </div>
  </header>;
}
