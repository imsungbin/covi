import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Creating examples trusts their commands; keep that out of the developer's own trust store.
// Child processes the tests spawn inherit this through process.env.
process.env.COVI_TRUST_FILE ??= join(mkdtempSync(join(tmpdir(), 'covi-trust-')), 'trust.json');
