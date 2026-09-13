import { Source_Serif_4, DM_Sans } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/shared/AuthProvider";

const display = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://boatship.cohortix.in"),
  title: {
    default: "Boatship | Client Onboarding Workspace",
    template: "%s | Boatship",
  },
  description: "Boatship brings client onboarding, project delivery, forms, documents, tasks, and team communication into one connected workspace.",
  applicationName: "Boatship",
  keywords: ["client onboarding", "project management", "client portal", "forms", "Boatship"],
  icons: {
    icon: [{ url: "/brand/boatship-favicon.png", type: "image/png", sizes: "64x64" }],
    shortcut: "/brand/boatship-favicon.png",
    apple: "/brand/boatship-favicon.png",
  },
  openGraph: {
    type: "website",
    url: "https://boatship.cohortix.in",
    siteName: "Boatship",
    title: "Boatship | Client Onboarding Workspace",
    description: "A connected workspace for client onboarding and project delivery.",
  },
  twitter: {
    card: "summary",
    title: "Boatship | Client Onboarding Workspace",
    description: "A connected workspace for client onboarding and project delivery.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full font-[family-name:var(--font-sans)] antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
