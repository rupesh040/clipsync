import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { InstallApp } from '@/components/install-app';
import { GuestProvider } from '@/components/guest-provider';
import {deployedSite} from '@/lib/deployment';
import './globals.css';
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
export const metadata: Metadata = { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || deployedSite), title: 'Clipsync — Copy here. Paste anywhere.', description: 'Login-free QR pairing and peer-to-peer clipboard sync. Private by choice. Designed for focus.', applicationName: 'Clipsync', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Clipsync', statusBarStyle: 'default' }, icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' }, formatDetection: { telephone: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#3d7257' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><body className={geist.variable}><GuestProvider>{children}<InstallApp/></GuestProvider></body></html>; }
