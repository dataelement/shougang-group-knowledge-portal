import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');
const adminPageStyles = readFileSync('src/pages/AdminPage.module.css', 'utf8');

test('ordinary admin modal forms keep their intrinsic content height', () => {
  assert.match(adminPageStyles, /\.formGrid\s*{[^}]*flex:\s*1 1 auto;/s);
});

test('complex scroll-body modals retain their dedicated single-scroll override', () => {
  assert.match(
    adminPageStyles,
    /\.modalScrollBody \.formGrid\s*{[^}]*flex:\s*none;[^}]*overflow:\s*visible;/s,
  );
});

test('the integrations editor renders all configured values as controlled inputs', () => {
  const integrationsDialog = adminPageSource.match(
    /function IntegrationsEditorDialog[\s\S]*?function SiteEditorDialog/,
  )?.[0] || '';

  assert.match(integrationsDialog, /value=\{draft\.bisheng_admin_entry_url\}/);
  assert.match(integrationsDialog, /value=\{draft\.bisheng_knowledge_entry_url\}/);
  assert.match(integrationsDialog, /value=\{draft\.bisheng_platform_admin_url\}/);
});
