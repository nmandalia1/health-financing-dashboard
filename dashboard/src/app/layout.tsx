import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { DuckDBProvider } from "@/lib/duckdb-provider";
import { YearRangeProvider } from "@/lib/year-range-context";
import { LastCountryProvider } from "@/lib/last-country";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Health Financing Dashboard",
  description:
    "Explore health financing data across 217 countries — spending, outcomes, and equity indicators from WHO, World Bank, and IMF.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <DuckDBProvider>
          <YearRangeProvider>
            <LastCountryProvider>
              <AppShell>{children}</AppShell>
            </LastCountryProvider>
          </YearRangeProvider>
        </DuckDBProvider>
      </body>
    </html>
  );
}
