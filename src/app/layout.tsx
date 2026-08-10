import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://platform.blissmedialab.com";

/**
 * Root metadata — used as fallback for any page that doesn't supply
 * its own generateMetadata.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Agency OS — All-in-One Platform for Digital Agencies",
    template: "%s — Agency OS",
  },
  description:
    "AI content generation, white-label client portals, SEO campaign proposals, social media scheduling, and billing for digital agencies. Start your 14-day free trial — no credit card required.",
  keywords: [
    "agency platform",
    "content generation",
    "SEO proposals",
    "client portal",
    "white label",
    "AI writing",
    "AI content generator",
    "agency management software",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Agency OS",
    title: "Agency OS — All-in-One Platform for Digital Agencies",
    description:
      "AI content generation, white-label client portals, SEO proposals, and social scheduling for digital agencies.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Agency OS — All-in-One Platform for Digital Agencies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agency OS — All-in-One Platform for Digital Agencies",
    description:
      "AI content generation, white-label client portals, SEO proposals, and social scheduling for digital agencies.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Agency OS",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description:
    "AI content generation, white-label client portals, SEO campaign proposals, social media scheduling, and billing for digital agencies.",
  offers: {
    "@type": "Offer",
    price: "49",
    priceCurrency: "USD",
    description: "Starter plan — 14-day free trial, no credit card required",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        {gaId && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${gaId}');
                `,
              }}
            />
          </>
        )}
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider />
        {children}
      </body>
    </html>
  );
}
