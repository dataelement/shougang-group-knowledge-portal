import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homePageStyles = readFileSync('src/pages/HomePage.module.css', 'utf8');

function cssBlock(selector: string): string {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(homePageStyles);
  return match?.[1] ?? '';
}

test('home hero search panel and quick app row share one adaptive width', () => {
  const hero = cssBlock('.hero');
  const searchPanel = cssBlock('.heroSearchPanel');
  const bottomRow = cssBlock('.heroBottomRow');

  assert.match(hero, /--hero-content-width:\s*clamp\(638px,\s*56vw,\s*760px\);/);
  assert.match(searchPanel, /width:\s*min\(calc\(100% - 48px\), var\(--hero-content-width\)\);/);
  assert.match(searchPanel, /max-width:\s*var\(--hero-content-width\);/);
  assert.match(bottomRow, /width:\s*min\(calc\(100% - 48px\), var\(--hero-content-width\)\);/);
  assert.match(bottomRow, /max-width:\s*var\(--hero-content-width\);/);
});

test('home quick app shortcut labels are not truncated', () => {
  const shortcutList = cssBlock('.appShortcutList');
  const shortcut = cssBlock('.appShortcut');
  const shortcutText = cssBlock('.appShortcutText');

  assert.match(shortcutList, /display:\s*flex;/);
  assert.match(shortcutList, /flex-wrap:\s*wrap;/);
  assert.match(shortcut, /width:\s*auto;/);
  assert.match(shortcut, /min-width:\s*94px;/);
  assert.match(shortcutText, /white-space:\s*normal;/);
  assert.match(shortcutText, /overflow:\s*visible;/);
  assert.match(shortcutText, /text-overflow:\s*clip;/);
  assert.doesNotMatch(shortcutText, /text-overflow:\s*ellipsis;/);
});
