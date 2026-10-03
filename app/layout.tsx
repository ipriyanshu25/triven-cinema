import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Triven Cinema",
  description: "Serverless AI video generation powered by LTX-2.5",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
