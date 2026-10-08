import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Prepares the release directory.
 *
 * A plugin release consists of exactly these three files. They all exist in the
 * repository root as the canonical sources (`manifest.json`, `styles.css`) or as
 * the bundle that the esbuild step just produced (`main.js`), so this script
 * only recreates `dist/` and copies them over. Nothing is generated or rewritten
 * here, and `dist/` never contains anything else.
 */

const DIST = 'dist';
const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const file of RELEASE_FILES) {
	await copyFile(file, join(DIST, file));
}

console.log(`Release files copied to ${DIST}/: ${RELEASE_FILES.join(', ')}`);