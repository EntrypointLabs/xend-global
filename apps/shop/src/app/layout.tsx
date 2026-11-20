import type { Metadata, Viewport } from "next";
import { Montserrat, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-montserrat",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: { default: "Prydd Store", template: "%s · Prydd Store" },
  description: "Prydd merch and objects. Pay in USDC with one Face ID.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#f4f4f4" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${montserrat.variable} ${mono.variable}`}>
      <body className="font-sans">
        <CartProvider>
          <Header />
          <main className="pb-24">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-5 py-10 text-[12px] text-mute sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p>
                A working store. Real USDC, real stock, settled on Solana
                through Pay with Prydd.
              </p>
              <div className="flex gap-5">
                <Link href="/orders" className="hover:text-ink">
                  Find an order
                </Link>
                <a href="https://prydd.co" className="hover:text-ink">
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
