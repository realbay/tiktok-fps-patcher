import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TikTok FPS Patcher",
  description:
    "Patch MP4 timing metadata locally without re-encoding.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var t = localStorage.getItem("theme");

                  if (
                    t === "dark" ||
                    (
                      !t &&
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

      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Header />

        <div className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
