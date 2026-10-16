import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

await mkdir('public/icons', { recursive: true });
for (const size of [192, 512]) await sharp('public/icons/mark.svg').resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
await sharp('public/icons/mark.svg').resize(512, 512).png().toFile('public/icons/maskable-512.png');
await sharp('public/icons/mark.svg').resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
console.log('Generated 192px, 512px, maskable, and Apple touch icons.');
