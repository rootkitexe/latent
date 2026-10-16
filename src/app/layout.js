import { Anybody, Inter_Tight, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Providers from '@/components/core/Providers';
import Hud from '@/components/core/Hud';
import Cursor from '@/components/core/Cursor';

const display = Anybody({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display', display: 'swap' });
const sans = Inter_Tight({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['italic', 'normal'], variable: '--font-serif', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'LATENT — A field guide to the inside of a machine mind',
  description:
    'Learn how AI works by travelling through a neural network: neurons, gradient descent, embeddings, attention, diffusion and reinforcement learning — as playable 3D worlds. A Haloxion demo.',
};

export const viewport = { themeColor: '#050506' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <main>{children}</main>
          <Hud />
          <Cursor />
        </Providers>
      </body>
    </html>
  );
}
