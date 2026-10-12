import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });
try { await cp('assets', 'dist/assets', { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile('dist/.nojekyll', '');
const html = await readFile('dist/index.html', 'utf8');
if (!html.includes('Mine Explorer')) throw new Error('Missing application title');
if (/\b(?:src|href)=["']\/(?!\/)/.test(html)) throw new Error('Use relative asset URLs for GitHub Pages subpath hosting');
console.log('Static game built in dist/');
