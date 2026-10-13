import { writeFileSync } from 'node:fs';

// dist/cjs sits under a "type": "module" package, so mark it CommonJS explicitly.
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
