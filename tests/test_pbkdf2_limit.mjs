// Cloudflare production enforces PBKDF2 <= 100,000; local Node tests may not.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const match = source.match(/const PBKDF2_ITERATIONS = (\d+);/);
assert.ok(match, 'PBKDF2 iteration constant must exist');
const iterations = Number(match[1]);
assert.ok(iterations > 0 && iterations <= 100000,
  `Cloudflare Workers rejects ${iterations} PBKDF2 iterations; max = 100000`);
console.log(`PASS: PBKDF2 iteration count ${iterations} is within Cloudflare production limit`);
