import type { Metadata } from 'next';
import { Playfair_Display, Jost, JetBrains_Mono } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'Chatbot Forge: build a chatbot in minutes',
  description:
    'Pick a model, write its prompt, choose a talking style. Get a shareable link, an iframe embed, and a floating widget snippet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${jost.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
