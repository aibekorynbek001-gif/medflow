import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
if (url || key) {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url ?? '') ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '')) {
    throw new Error('Set the Supabase project URL and its sb_publishable_ key in the repository variables.');
  }
}

const source = new URL('../site/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js']) {
  await copyFile(new URL(file, source), new URL(file, output));
}
await writeFile(new URL('.nojekyll', output), '');
if (!url) console.log('Publishing the setup screen while the dedicated Supabase project is being configured.');
await writeFile(new URL('config.json', output), JSON.stringify(url ? { url, key } : {}));
