#!/usr/bin/env node
// Points git at the repository's hooks directory. Skipped outside a git checkout (CI images, Render builds).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.git')) {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
  console.log('Git hooks installed (.githooks).');
}
