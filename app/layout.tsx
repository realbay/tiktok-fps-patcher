import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TikTok FPS Patcher",
  description:
    "Patch 60/120 FPS MP4 timing metadata locally in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var theme = localStorage.getItem("theme");

                  if (
                    theme === "dark" ||
                    (
                      !theme &&
                      window.matchMedia(
                        "(prefers-color-scheme: dark)"
                      ).matches
                    )
                  ) {
                    document.documentElement.classList.add("dark");
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>

      <body
        className={`${geist.variable} min-h-screen bg-[#111214] text-[#f2f3f5] antialiased`}
      >
        <Header />

        <div className="min-h-[calc(100vh-64px)]">
          {children}
        </div>
      </body>
    </html>
  );
}
