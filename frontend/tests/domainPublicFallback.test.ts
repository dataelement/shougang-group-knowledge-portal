import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');
const domainsPageSource = readFileSync('src/pages/DomainsPage.tsx', 'utf8');

test('domain list requests use public fallback for anonymous department-bound spaces', () => {
  assert.match(listPageSource, /fallbackPublic:\s*true/);
  assert.match(listPageSource, /fetchAggregatedTags\(spaceIds,\s*undefined,\s*true\)/);
});

test('domains page navigates by domain route instead of direct space route', () => {
  assert.match(domainsPageSource, /buildDomainSearchPath\(domain\.name\)/);
  assert.doesNotMatch(domainsPageSource, /buildSpaceSearchPath/);
});
