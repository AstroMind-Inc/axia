// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/app/components/navigation/Navbar";
import { SettingsProvider } from './context/SettingsContext';
import { ThemeProvider } from './context/ThemeProvider';
import { Toaster } from "@/app/components/ui/toaster";

// We deliberately avoid `next/font/google` so the docker build doesn't need
// outbound access to fonts.googleapis.com at build time. The system font
// stack (declared as `font-sans` in tailwind.config.ts) gives consistent,
// good-looking type across platforms with zero network dependency.

export const metadata: Metadata = {
  title: "ASTROMIND",
  description: "AI-powered astronomical data analysis platform",
  icons: {
    icon: '/site-favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans" suppressHydrationWarning={true}>
        <SettingsProvider>
          <ThemeProvider>
            <div className="relative h-screen flex flex-col overflow-hidden">
              <Navbar />
              <main className="flex-1 relative overflow-hidden">
                {children}
              </main>
              <Toaster />
            </div>
          </ThemeProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}