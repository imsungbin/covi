import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Creating examples trusts their commands; keep that out of the developer's own trust store.
// Child processes the tests spawn inherit this through process.env.
process.env.COVI_TRUST_FILE ??= join(mkdtempSync(join(tmpdir(), 'covi-trust-')), 'trust.json');

// Each test sets the CI context it exercises. The runner's own (GitHub Actions sets CI,
// GITHUB_ACTIONS, GITHUB_OUTPUT, and more) must not leak into the commands tests start.
for (const key of Object.keys(process.env)) {
  if (key === 'CI' || /^(GITHUB|GITLAB|CI)_/.test(key)) delete process.env[key];
}
