import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');

describe('OSS-04: Apache-2.0 license artifacts', () => {
  test('LICENSE file exists and contains Apache License text', () => {
    const license = readFileSync(resolve(rootDir, 'LICENSE'), 'utf8');
    assert.ok(license.includes('Apache License'), 'LICENSE must contain "Apache License"');
    assert.ok(license.includes('Version 2.0'), 'LICENSE must contain "Version 2.0"');
  });

  test('NOTICE file exists and is non-empty', () => {
    const notice = readFileSync(resolve(rootDir, 'NOTICE'), 'utf8');
    assert.ok(notice.trim().length > 0, 'NOTICE must be non-empty');
  });

  test('package.json license field is Apache-2.0', () => {
    const raw = readFileSync(resolve(rootDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { license?: string };
    assert.equal(pkg.license, 'Apache-2.0');
  });
});
