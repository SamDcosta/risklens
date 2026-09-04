import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "RiskLens — counterparty exposure",
  description: "Portfolio exposure tool that surfaces shared counterparty dependencies across sector boundaries.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <Link href="/" className="flex shrink-0 items-baseline gap-2">
              <span className="text-sm font-semibold tracking-wide text-text">RiskLens</span>
              <span className="hidden text-xs text-text-faint sm:inline">exposure measurement, not loss prediction</span>
            </Link>
            <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap text-xs text-text-dim">
              <a href="#concentration" className="hover:text-text">Concentration</a>
              <a href="#holdings" className="hover:text-text">Holdings</a>
              <a href="#exposure-graph" className="hover:text-text">Graph</a>
              <a href="#event-analysis" className="hover:text-text">Event analysis</a>
              <a href="#shock" className="hover:text-text">Shock</a>
              <a href="#evaluation" className="hover:text-text">Evaluation</a>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border px-6 py-6 text-xs text-text-faint">
          <div className="mx-auto max-w-6xl">
            Not investment advice. This tool reports exposure; it does not predict outcomes. See{" "}
            <a href="#limitations" className="underline hover:text-text-dim">limitations</a>.
          </div>
        </footer>
      </body>
    </html>
  );
}
