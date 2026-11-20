import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import Link from "next/link";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: { default: "Prydd Store", template: "%s · Prydd Store" },
  description: "Prydd merch and objects. Pay in USDC with one Face ID.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${montserrat.variable}`}
    >
      <body className="font-sans">
        <CartProvider>
          <Header />
          <main>{children}</main>
          <footer className="bg-night text-night-mute">
            <div className="flex flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="font-brand text-[13px] tracking-[0.24em] text-night-text">
                PRYDD
              </p>
              <div className="label flex flex-wrap gap-x-6 gap-y-2">
                <span>Settled in USDC on Solana</span>
                <Link href="/orders" className="hover:text-night-text">
                  Find an order
                </Link>
                <a href="https://prydd.co" className="hover:text-night-text">
                  prydd.co
                </a>
              </div>
            </div>
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
