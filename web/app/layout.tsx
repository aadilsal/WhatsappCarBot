import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/lib/convex-client";
import { AuthProvider } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Garage Bot",
  description: "Your vehicle's service history, fuel log, and reminders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <ConvexClientProvider>
          <AuthProvider>
            <NavBar />
            <main className="flex-1 w-full">{children}</main>
          </AuthProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
