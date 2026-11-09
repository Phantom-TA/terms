#!/usr/bin/env node
// Secret scanner used by the pre-commit hook (staged files) and CI (`--all`, every tracked file).
// Exits 1 and lists the findings when anything that looks like a credential is found.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SECRET_ENV_NAMES = [
  'PAYPAL_CLIENT_SECRET',
  'LLM_API_KEY',
  'SESSION_SECRET',
  'OFFER_TOKEN_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
];

/** @type {{ name: string, re: RegExp }[]} */
const PATTERNS = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI-style API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'PayPal access token', re: /\bA21AA[A-Za-z0-9_-]{40,}/ },
  {
    name: 'secret env assignment',
    re: new RegExp(
      `^\\s*(?:export\\s+)?(?:${SECRET_ENV_NAMES.join('|')})\\s*=\\s*['"]?[^\\s'"#]{8,}`,
      'm',
    ),
  },
];

const SKIP = [
  /^pnpm-lock\.yaml$/,
  /\.(png|jpg|jpeg|gif|ico|woff2?|pdf)$/i,
  /^scripts\/check-secrets\.mjs$/,
];

function listFiles(all) {
  const args = all
    ? ['ls-files', '-z']
    : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'];
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\0')
    .filter((f) => f.length > 0);
}

function readContent(file, all) {
  if (all) return existsSync(file) ? readFileSync(file, 'utf8') : '';
  // Scan the staged version, not the working tree.
  return execFileSync('git', ['show', `:${file}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) hits.push({ line: i + 1, name });
    }
  });
  return hits;
}

function main() {
  const all = process.argv.includes('--all');
  const findings = [];
  for (const file of listFiles(all)) {
    if (SKIP.some((re) => re.test(file))) continue;
    if (/(^|\/)\.env(\..*)?$/.test(file) && !file.endsWith('.env.example')) {
      findings.push(`${file}: .env files must never be committed`);
      continue;
    }
    for (const hit of scanText(readContent(file, all))) {
      findings.push(`${file}:${hit.line}: possible ${hit.name}`);
    }
  }
  if (findings.length > 0) {
    console.error('Secret scan failed:\n' + findings.map((f) => `  ${f}`).join('\n'));
    process.exit(1);
  }
  console.log(`Secret scan passed (${all ? 'all tracked files' : 'staged files'}).`);
}

main();
