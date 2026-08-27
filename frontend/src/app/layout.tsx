import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const ibmSans = IBM_Plex_Sans({
  variable: "--font-ibm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Utility Intelligence Workspace",
  description:
    "Internal commercial and technical intelligence workstation for electricity-network technology teams. Strategic hypotheses from public data — not engineering conclusions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${ibmSans.variable} ${ibmMono.variable} h-full`} suppressHydrationWarning>
      <body className="h-full overflow-hidden antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
