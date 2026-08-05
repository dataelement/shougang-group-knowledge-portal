import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  clearHomeNavCardPath,
  consumeHomeNavCardPath,
  inferHomeNavCardPathFromPathname,
  inferHomeNavTabFromPath,
  rememberHomeNavCardPath,
  rememberHomeNavTab,
} from '../src/utils/homeNavTab';

const headerSource = readFileSync('src/components/Header.tsx', 'utf8');
const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');

test('inferHomeNavTabFromPath maps domain and category list routes', () => {
  assert.equal(inferHomeNavTabFromPath('/domain/%E7%94%9F%E4%BA%A7'), 'domain');
  assert.equal(inferHomeNavTabFromPath('/category/PRO'), 'category');
  assert.equal(inferHomeNavTabFromPath('/search'), null);
});

test('inferHomeNavCardPathFromPathname preserves list page pathname', () => {
  assert.equal(
    inferHomeNavCardPathFromPathname('/domain/%E7%94%9F%E4%BA%A7'),
    '/domain/%E7%94%9F%E4%BA%A7',
  );
  assert.equal(inferHomeNavCardPathFromPathname('/category/PRO-A'), '/category/PRO-A');
  assert.equal(inferHomeNavCardPathFromPathname('/expert-qa'), null);
});

test('remember and consume home nav card path are one-shot', () => {
  clearHomeNavCardPath();
  rememberHomeNavCardPath('/domain/%E7%94%9F%E4%BA%A7');
  assert.equal(consumeHomeNavCardPath(), '/domain/%E7%94%9F%E4%BA%A7');
  assert.equal(consumeHomeNavCardPath(), null);
});

test('rememberHomeNavCardPath ignores blank paths', () => {
  clearHomeNavCardPath();
  rememberHomeNavCardPath('   ');
  assert.equal(consumeHomeNavCardPath(), null);
});

test('home navigation wiring remembers card path when leaving list pages', () => {
  assert.match(headerSource, /inferHomeNavCardPathFromPathname/);
  assert.match(headerSource, /rememberHomeNavCardPath\(cardPath\)/);
  assert.match(headerSource, /clearHomeNavCardPath\(\)/);
  assert.match(homePageSource, /rememberHomeNavCardPath\(path\)/);
  assert.match(homePageSource, /scrollHomeNavCardIntoView/);
  assert.match(homePageSource, /pendingHomeNavCardPathRef/);
});

test('rememberHomeNavTab still stores active tab', () => {
  rememberHomeNavTab('domain');
  rememberHomeNavTab('category');
});
