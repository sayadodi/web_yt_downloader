import type { Metadata, Viewport } from "next";
import { Poppins, Righteous } from "next/font/google";

import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const righteous = Righteous({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-righteous",
  display: "swap",
});

export const metadata: Metadata = {
  title: "YT Audio — Unduh lagu dari YouTube",
  description:
    "Ubah link YouTube menjadi file audio MP3 atau M4A. Pilih kualitas, unduh, dan file langsung dibersihkan dari server.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0f0f23",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${poppins.variable} ${righteous.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
