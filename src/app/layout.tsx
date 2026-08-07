import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope, Syne } from "next/font/google";
import { DisableContextMenu } from "@/components/DisableContextMenu";
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

const SOURCE_GUARD = `(function(){function b(e){var k=(e.key||"").toLowerCase(),c=e.ctrlKey||e.metaKey,s=e.shiftKey,a=e.altKey;if(e.key==="F12")return!0;if(c&&s&&(k==="i"||k==="j"||k==="c"||k==="k"))return!0;if(e.metaKey&&a&&(k==="i"||k==="j"||k==="c"))return!0;if(c&&!s&&!a&&(k==="u"||k==="s"))return!0;return!1}document.addEventListener("contextmenu",function(e){e.preventDefault();e.stopPropagation()},!0);document.addEventListener("keydown",function(e){if(b(e)){e.preventDefault();e.stopPropagation()}},!0);document.addEventListener("dragstart",function(e){e.preventDefault()},!0)})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SOURCE_GUARD }} />
      </head>
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <DisableContextMenu />
        {children}
      </body>
    </html>
  );
}
