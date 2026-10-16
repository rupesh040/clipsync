import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
export const metadata: Metadata = { title: 'Clipsync — Copy here. Paste anywhere.', description: 'A quieter way to move text between your devices. Private by choice. Designed for focus.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><body className={geist.variable}>{children}</body></html>; }
