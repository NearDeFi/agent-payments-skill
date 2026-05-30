// Shared .env loader for scripts that need wallet credentials or RPC config.
//
// Precedence (highest wins):
//   1. Shell env     — already in process.env from `export VAR=...`
//   2. Project root  — process.cwd()/.env  (where the user runs the agent from)
//   3. Skill dir     — x402-pay/.env       (next to SKILL.md)

import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  config({ path: join(process.cwd(), '.env'), quiet: true });
  config({ path: join(SKILL_DIR, '.env'),    quiet: true });
}
