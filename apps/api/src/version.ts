/** The API's version, read from its package.json (src/ and dist/ both sit one level below it). */
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const API_VERSION: string = pkg.version;
