import { Bricolage_Grotesque, Figtree, Space_Mono } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/shared/AuthProvider";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const sans = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const DEFAULT_APP_URL = "https://boatship-onboarding.boatship.workers.dev";

/** The public origin for canonical and Open Graph URLs. */
function appUrl() {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  try {
    return new URL(configured || DEFAULT_APP_URL);
  } catch {
    return new URL(DEFAULT_APP_URL);
  }
}

const APP_URL = appUrl();

export const metadata: Metadata = {
  metadataBase: APP_URL,
  title: {
    default: "Boatship | Client OS Workspace",
    template: "%s | Boatship",
  },
  description: "Boatship brings client accounts, engagements, tasks, forms, documents, approvals, and team communication into one connected workspace.",
  applicationName: "Boatship",
  keywords: ["client OS", "client management", "project management", "client portal", "forms", "Boatship"],
  icons: {
    icon: [{ url: "/brand/boatship-favicon.png", type: "image/png", sizes: "64x64" }],
    shortcut: "/brand/boatship-favicon.png",
    apple: "/brand/boatship-favicon.png",
  },
  openGraph: {
    type: "website",
    url: APP_URL.origin,
    siteName: "Boatship",
    title: "Boatship | Client OS Workspace",
    description: "A connected workspace for client accounts, engagements, and delivery.",
  },
  twitter: {
    card: "summary",
    title: "Boatship | Client OS Workspace",
    description: "A connected workspace for client accounts, engagements, and delivery.",
  },
};

/* Applies the stored theme before first paint so there is no flash. "system" leaves the attribute off. */
const themeInit = `(function(){try{var t=localStorage.getItem("boatship-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full font-[family-name:var(--font-sans)] antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
