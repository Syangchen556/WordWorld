import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "WordWorld · Just us two",
  description: "Our private little world of words.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
