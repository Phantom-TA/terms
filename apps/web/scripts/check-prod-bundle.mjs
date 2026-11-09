#!/usr/bin/env node
// Fails the build when mocks or secrets reach the production bundle (CONTEXT.md: "The production
// build never contains mocks"). Runs after `vite build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;

/** Strings that exist only in MSW, src/mocks or the dev-only style guide. */
const FORBIDDEN = ['mockServiceWorker', 'setupWorker', 'TERMS_MOCK_FIXTURE', 'grid-specimen'];
/** Server-only variable names that must never be referenced by browser code. */
const SERVER_ONLY = ['PAYPAL_CLIENT_SECRET', 'LLM_API_KEY', 'SESSION_SECRET', 'OFFER_TOKEN_SECRET'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(DIST).filter((f) => /\.(js|html|css)$/.test(f));
const problems = [];
if (walk(DIST).some((f) => f.endsWith('mockServiceWorker.js'))) {
  problems.push('dist contains mockServiceWorker.js');
}
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const needle of [...FORBIDDEN, ...SERVER_ONLY]) {
    if (text.includes(needle)) problems.push(`${file} contains "${needle}"`);
  }
}

if (problems.length > 0) {
  console.error(`Production bundle check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Production bundle check passed (${files.length} files scanned).`);
