import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const contentApiSource = readFileSync('src/api/content.ts', 'utf8');

test('分类数量在主页异步加载，并在请求完成前显示加载中状态', () => {
  assert.match(homePageSource, /const \[categoryCountsLoading, setCategoryCountsLoading\] = useState\(true\)/);
  assert.match(homePageSource, /fetchCategoryFileCounts\(\)/);
  assert.match(homePageSource, /finally \{[\s\S]*setCategoryCountsLoading\(false\)/);
  assert.match(homePageSource, /categoryCountsLoading \? '加载中…' : formatCount\(totalFiles\)/);
  assert.match(contentApiSource, /\/api\/v1\/knowledge\/category-file-counts/);
});
