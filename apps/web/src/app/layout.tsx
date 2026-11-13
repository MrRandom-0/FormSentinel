import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: "FormSentinel — durable form infrastructure", template: "%s | FormSentinel" },
  description: "Durable form ingestion, processing, and submission operations.",
  openGraph: {
    title: "FormSentinel",
    description: "Durable form ingestion, processing, and submission operations.",
    type: "website",
    images: [{ url: "/form-shield.svg", alt: "A form protected by the FormSentinel shield" }],
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container nav">
            <Link className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="fs-brand" x1="0" y1="0" x2="24" y2="24">
                      <stop stopColor="#5253dc" />
                      <stop offset="1" stopColor="#087f6b" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M12 2.5 4.5 5.25v6.1c0 4.65 3.2 8.15 7.5 9.65 4.3-1.5 7.5-5 7.5-9.65V5.25L12 2.5Z"
                    fill="url(#fs-brand)"
                  />
                  <path
                    d="m8.75 11.75 2.25 2.25 4.25-4.5"
                    stroke="#fff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              FormSentinel
            </Link>
            <nav className="desktop-nav" aria-label="Primary navigation">
              <Link href="/product">Product</Link>
              <Link href="/developers">Developers</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/docs">Docs</Link>
              <Link href="/app/copilot">Phase 3</Link>
              <Link href="/login">Log in</Link>
              <Link className="button" href="/signup">
                Start free
              </Link>
              <ThemeToggle />
            </nav>
            <details className="mobile-menu">
              <summary>Menu</summary>
              <nav aria-label="Mobile navigation">
                <Link href="/product">Product</Link>
                <Link href="/ai-builders">AI builders</Link>
                <Link href="/developers">Developers</Link>
                <Link href="/pricing">Pricing</Link>
                <Link href="/docs">Docs</Link>
                <Link href="/login">Log in</Link>
                <Link href="/signup">Start free</Link>
                <ThemeToggle />
              </nav>
            </details>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            FormSentinel Phase 4 local preview · <Link href="/security">Security</Link> ·{" "}
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> ·{" "}
            <Link href="/status">Status</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
