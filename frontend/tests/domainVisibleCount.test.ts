import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const contentApiSource = readFileSync('src/api/content.ts', 'utf8');

test('业务域数量在主页异步加载，并在请求完成前显示加载中状态', () => {
  assert.match(homePageSource, /const \[domainCountsLoading, setDomainCountsLoading\] = useState\(true\)/);
  assert.match(homePageSource, /fetchDomainFileCounts\(\)/);
  assert.match(homePageSource, /finally \{[\s\S]*setDomainCountsLoading\(false\)/);
  assert.match(homePageSource, /domainCountsLoading \? '加载中…' : formatCount\(totalFiles\)/);
  assert.match(contentApiSource, /\/api\/v1\/knowledge\/domain-file-counts/);
});
