import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campaign Graph — Threat Intelligence",
  description:
    "Correlates signals from Secret Exposure Monitor, Leak Intelligence, and UntilPhish-Go into typed graph campaigns.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
