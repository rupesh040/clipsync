import { copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';

try {
  await copyFile('.env.example', '.env.local', constants.COPYFILE_EXCL);
  console.log('Created .env.local. Fill in your Supabase public project settings locally.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env.local already exists; preserved without changes.');
  else throw error;
}
