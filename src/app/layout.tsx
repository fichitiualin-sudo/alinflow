import type { Metadata } from "next";
import "../src/app/globals.css";

export const metadata: Metadata = {
  title: "AlinFlow",
  description: "Klímás ügyviteli rendszer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body className="bg-[#08111F] text-white antialiased" style={{ margin: 0, background: "#08111F", color: "white" }}>
        {children}
      </body>
    </html>
  );
}
