import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope, Syne } from "next/font/google";
import "./globals.css";

const display = Syne({
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "APEX // HIRE DESK",
  description:
    "Career command center — EU/US permanent roles, portfolio fit, apply templates.",
  applicationName: "Hire Desk",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05060a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
