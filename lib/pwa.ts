export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function installationPlatform(userAgent: string, platform: string, touchPoints: number) {
  if (/iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}
