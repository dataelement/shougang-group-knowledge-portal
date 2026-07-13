import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');
const adminPageStyles = readFileSync('src/pages/AdminPage.module.css', 'utf8');

test('admin domain space options auto-load only once even when Bisheng returns no spaces', () => {
  assert.match(adminPageSource, /const \[spaceOptionsLoaded,\s*setSpaceOptionsLoaded\] = useState\(false\)/);
  assert.match(adminPageSource, /finally\s*{\s*setSpaceOptionsLoaded\(true\);\s*setSpaceOptionsLoading\(false\);/s);
  assert.match(adminPageSource, /if \(active !== 'domains' \|\| !config \|\| spaceOptionsLoaded \|\| spaceOptionsLoading\) return;/);
  assert.match(adminPageSource, /\}, \[active, config, spaceOptionsLoaded, spaceOptionsLoading\]\);/);
  assert.doesNotMatch(
    adminPageSource,
    /active !== 'domains' \|\| !config \|\| spaceOptions\.length \|\| spaceOptionsLoading/,
  );
});

test('admin domain space selector renders grouped bindable space options', () => {
  assert.match(adminPageSource, /getDomainBindableSpaceGroups\(spaces\)\.map/);
  assert.match(adminPageSource, /className=\{s\.spacePickerGroupTitle\}>\{group\.label\}/);
  assert.match(adminPageSource, /type="checkbox"/);
  assert.match(adminPageSource, /selectedSpaceChips/);
  assert.doesNotMatch(adminPageSource, /getPublicSpaceOptions\(spaces\)/);
});

test('admin domain space selector keeps candidates in a scrollable area', () => {
  assert.match(adminPageStyles, /\.spaceMultiPicker\s*{[^}]*max-height:\s*420px;[^}]*overflow-y:\s*auto;/s);
  assert.match(adminPageStyles, /\.spaceMultiPicker\s*{[^}]*scrollbar-gutter:\s*stable;/s);
});

test('admin domain space selector uses the full form row while keeping two groups side by side', () => {
  assert.match(
    adminPageSource,
    /<div className=\{`\$\{s\.formField\} \$\{s\.formFieldWide\}`\}>\s*<span className=\{s\.fieldLabel\}>绑定空间<\/span>\s*<div className=\{s\.spaceMultiPicker\}>/s,
  );
  assert.match(
    adminPageStyles,
    /\.spaceMultiPicker\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
  );
});
