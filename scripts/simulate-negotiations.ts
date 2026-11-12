/**
 * Negotiation simulator report (CONTEXT.md, "AI tests"): seeded runs between the supplier agent and
 * the client agent with random policies; every outcome must respect both policies.
 *
 *   pnpm spike ../../scripts/simulate-negotiations.ts [runs=50] [firstSeed=1]
 *
 * Runs the deterministic strategies today; the LLM negotiators plug into the same harness later.
 * Exits non-zero on any violation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { simulate } from '../apps/api/src/negotiation/simulator.js';

const runs = Number(process.argv[2] ?? 50);
const first = Number(process.argv[3] ?? 1);
const seeds = Array.from({ length: runs }, (_, i) => first + i);
const report = simulate(seeds);

const out = new URL('./simulations/', import.meta.url);
mkdirSync(out, { recursive: true });
const path = new URL(`report-${String(first)}-${String(first + runs - 1)}.json`, out);
writeFileSync(
  path,
  `${JSON.stringify({ seeds: [first, first + runs - 1], ...report }, null, 2)}\n`,
);

console.log(
  `Negotiation simulator: ${String(report.runs)} runs (seeds ${String(first)}–${String(first + runs - 1)})`,
);
console.log(`  agreed ${String(report.agreed)}, declined ${String(report.declined)}`);
console.log(
  `  owner asked ${String(report.ownerAsked)} (approved ${String(report.ownerApproved)}), client person approvals ${String(report.humanApprovals)}`,
);
console.log(`  average messages per run ${String(report.averageMessages)}`);
console.log(`  policy violations: ${String(report.violations.length)}`);
for (const v of report.violations)
  console.log(`    seed ${String(v.seed)}: ${v.rule}: ${v.detail}`);
if (report.violations.length > 0) process.exit(1);
