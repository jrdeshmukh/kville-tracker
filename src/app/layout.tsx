import type { Metadata, Viewport } from "next";
import { Caveat, Geist_Mono, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { SessionProvider, ToastProvider } from "@/lib/data/client";

const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "K-Ville Tracker",
  description: "Tent schedules, swaps, tent checks and money for your K-Ville group.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "K-Ville", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f0f0ed",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${hanken.variable} ${mono.variable} ${caveat.variable} antialiased`}>
        <ToastProvider>
          <SessionProvider>{children}</SessionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
