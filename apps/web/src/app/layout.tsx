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
