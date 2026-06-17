import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlinFlow",
  description: "Klímás ügyviteli rendszer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var theme = window.localStorage.getItem("alinflow-theme");
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
} catch (error) {
  document.documentElement.dataset.theme = "dark";
}
            `.trim(),
          }}
        />
      </head>
      <body className="bg-[#08111F] text-white antialiased" style={{ margin: 0, background: "#08111F", color: "white" }}>{children}</body>
    </html>
  );
}
