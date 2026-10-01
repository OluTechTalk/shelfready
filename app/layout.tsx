import Link from "next/link";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLinks } from "./nav-links";
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
  title: "ShelfReady",
  description: "Audit a Shopify catalog for AI shopping agents, fix the gaps with human approval, and open the store to agents over MCP.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-4">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">
                S
              </span>
              <span className="hidden sm:inline">ShelfReady</span>
            </Link>
            <NavLinks />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
