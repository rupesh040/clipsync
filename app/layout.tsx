import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { InstallApp } from '@/components/install-app';
import './globals.css';
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
export const metadata: Metadata = { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'), title: 'Clipsync — Copy here. Paste anywhere.', description: 'A quieter way to move text between your devices. Private by choice. Designed for focus.', applicationName: 'Clipsync', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Clipsync', statusBarStyle: 'default' }, icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' }, formatDetection: { telephone: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#3d7257' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><body className={geist.variable}>{children}<InstallApp/></body></html>; }
