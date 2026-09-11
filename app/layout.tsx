import { Source_Serif_4, DM_Sans } from "next/font/google";
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

export const metadata = {
  title: "Boatship | Infotech Client Onboarding",
  description: "A connected onboarding command center for digital service delivery.",
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
