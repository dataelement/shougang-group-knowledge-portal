import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const contentApiSource = readFileSync('src/api/content.ts', 'utf8');

test('home stats use real stats API and new labels', () => {
  assert.match(homePageSource, /fetchHomeStats/);
  assert.match(contentApiSource, /\/api\/v1\/knowledge\/home\/stats/);
  assert.match(homePageSource, /label:\s*'次收藏'/);
  assert.match(homePageSource, /label:\s*'次问答'/);
  assert.doesNotMatch(homePageSource, /次点赞/);
  assert.doesNotMatch(homePageSource, /条评论/);
  assert.doesNotMatch(homePageSource, /1\.17亿|163万|1101万/);
});

test('home stats failure does not restore legacy fake numbers', () => {
  assert.match(homePageSource, /homeStatsFailed/);
  assert.match(homePageSource, /return '--';/);
  assert.doesNotMatch(homePageSource, /homeStatsFailed[\s\S]{0,200}(1\.17亿|163万|1101万)/);
});
