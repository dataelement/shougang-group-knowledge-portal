import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');
const domainsPageSource = readFileSync('src/pages/DomainsPage.tsx', 'utf8');

test('domain list requests use bound spaces and business domain code without public fallback', () => {
  assert.doesNotMatch(listPageSource, /fallbackPublic/);
  assert.match(listPageSource, /spaceIds\.length === 0 \|\| !businessDomainCode/);
  assert.match(listPageSource, /businessDomainCode:\s*businessDomainCode \|\| undefined/);
  assert.match(listPageSource, /fetchAggregatedTags\(spaceIds,\s*undefined,\s*businessDomainCode \|\| undefined\)/);
});

test('domains page navigates by domain route instead of direct space route', () => {
  assert.match(domainsPageSource, /buildDomainSearchPath\(domain\.name\)/);
  assert.doesNotMatch(domainsPageSource, /buildSpaceSearchPath/);
});
