import type { Metadata } from 'next';
import { Playfair_Display, Jost, JetBrains_Mono } from 'next/font/google';
import { siteUrl } from '@/lib/site';
import './globals.css';

/* Clarity runs on two faces: a high-contrast serif for anything that speaks,
   and a geometric sans for anything that labels. Italics matter — the display
   serif is loaded with them so emphasis can lean rather than bold. */
const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
  display: 'swap',
});
const jost = Jost({ subsets: ['latin'], variable: '--font-jost', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

const TITLE = 'Chatbot Forge: build a chatbot in minutes';
const DESCRIPTION =
  'Pick a model, write its prompt, choose a talking style. Get a shareable link, an iframe embed, and a floating widget snippet.';

/**
 * `metadataBase` is the load-bearing line: without it Next cannot turn the
 * `opengraph-image.jpg` sitting beside this file into the absolute URL that
 * Slack, iMessage and every other unfurler insists on, and the preview silently
 * comes back blank. The image itself needs no declaration — the file convention
 * wires up og:image and twitter:image, dimensions and all.
 *
 * No title `template` on purpose: every page here already sets its own full
 * title, so a template would render "Admin | Chatbot Forge | Chatbot Forge".
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Chatbot Forge',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Chatbot Forge',
    url: '/',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${jost.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
