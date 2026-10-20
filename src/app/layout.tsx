import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Tasteful serif accent, used sparingly for editorial marketing headlines.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600"],
});

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "AfterKey — Your life. Your legacy. Your people.",
    template: "%s · AfterKey",
  },
  description:
    "One secure place for your essential records, property information, important instructions and personal messages — with control over what is shared, with whom, and under what conditions.",
  applicationName: "AfterKey",
  openGraph: {
    type: "website",
    siteName: "AfterKey",
    title: "AfterKey — Your life. Your legacy. Your people.",
    description:
      "Prepare for life's uncertainties with one secure place for your essential records, instructions and personal messages.",
    url: APP_URL,
    images: [{ url: "/og-afterkey.png", width: 1200, height: 630, alt: "AfterKey" }],
  },
  twitter: {
    card: "summary",
    title: "AfterKey — Your life. Your legacy. Your people.",
    description: "Essential records, instructions and personal messages — protected for the people you love.",
    images: ["/og-afterkey.png"],
  },
  robots: { index: false, follow: false }, // per-page overrides opt public pages in
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07080C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <a
          href="#main"
          className="cta-gradient sr-only rounded px-3 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100]"
        >
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
