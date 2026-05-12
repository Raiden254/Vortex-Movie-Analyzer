import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Vortex — Identify Any Movie Scene Instantly",
  description: "Upload a screenshot or video clip and Vortex will identify the movie or TV show instantly using AI. Powered by Ace Analytics.",
  keywords: ["movie identifier", "scene identifier", "what movie is this", "identify movie scene", "film recognition", "TV show identifier", "Vortex", "Ace Analytics"],
  authors: [{ name: "Ace Analytics" }],
  creator: "Ace Analytics",
  metadataBase: new URL("https://vortex-movie-analyzer.vercel.app"),
  openGraph: {
    type: "website",
    url: "https://vortex-movie-analyzer.vercel.app",
    title: "Vortex — Identify Any Movie Scene Instantly",
    description: "Upload a screenshot or video clip and Vortex will identify the movie or TV show instantly using AI. Powered by Ace Analytics.",
    siteName: "Vortex Movie Analyzer",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Vortex Movie Analyzer — Identify Any Scene Instantly",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vortex — Identify Any Movie Scene Instantly",
    description: "Upload a screenshot or video clip and Vortex will identify the movie or TV show instantly using AI.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/Vortex_logo.png",
    apple: "/Vortex_logo.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#0A0E1A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Vortex" />
        <link rel="canonical" href="https://vortex-movie-analyzer.vercel.app" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}