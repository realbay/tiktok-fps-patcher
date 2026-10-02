import type { Metadata } from "next";
import type { ReactNode } from "react";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "TikTok FPS Patcher",
  description: "Patch TikTok 60/120 FPS MP4 timing metadata locally in your browser.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.classList.add("light")}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-black text-white antialiased light:bg-white light:text-black">
        <Header />
        {children}
      </body>
    </html>
  );
}
