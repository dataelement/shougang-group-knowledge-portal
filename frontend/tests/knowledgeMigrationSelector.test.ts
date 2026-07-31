import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { MigrationSpace } from '../src/api/knowledgeMigration';
import {
  filterMigrationSpacesByLevel,
  getMigrationSpaceLevelOptions,
  normalizeMigrationSpaceLevel,
} from '../src/utils/knowledgeMigrationSelector';

const wizardSource = readFileSync(
  'src/components/KnowledgeMigrationWizard.tsx',
  'utf8',
);

function space(
  id: number,
  name: string,
  level: string,
): MigrationSpace {
  return {
    id,
    name,
    level,
    owner_valid: true,
    selectable: true,
  };
}

test('migration selector groups and orders available knowledge space levels', () => {
  const spaces = [
    space(1, '个人库', 'personal'),
    space(2, '科室库', 'team_ks'),
    space(3, '公共库', 'public'),
    space(4, '团队库', 'team'),
    space(5, '未知库', 'custom'),
  ];

  assert.equal(normalizeMigrationSpaceLevel(' TEAM_KS '), 'team');
  assert.deepEqual(getMigrationSpaceLevelOptions(spaces), [
    { value: 'public', label: '公共知识库' },
    { value: 'team', label: '团队/科室知识库' },
    { value: 'personal', label: '个人知识库' },
    { value: 'other', label: '其他知识库' },
  ]);
  assert.deepEqual(
    filterMigrationSpacesByLevel(spaces, 'team').map((item) => item.name),
    ['科室库', '团队库'],
  );
  assert.deepEqual(filterMigrationSpacesByLevel(spaces, ''), []);
});

test('migration wizard uses independent type-first source and target trees', () => {
  const sourceSelector = wizardSource.slice(
    wizardSource.indexOf('value={sourceSpaceLevel}'),
    wizardSource.indexOf('</select>', wizardSource.indexOf('value={sourceSpaceLevel}')),
  );

  assert.match(wizardSource, /value=\{sourceSpaceLevel\}/);
  assert.match(wizardSource, /value=\{targetSpaceLevel\}/);
  assert.match(wizardSource, /选择来源知识库类型/);
  assert.match(wizardSource, /选择目标知识库类型/);
  assert.match(
    wizardSource,
    /renderSpaceTree\('source', sourceSpacesInLevel\)/,
  );
  assert.match(
    wizardSource,
    /renderSpaceTree\('target', targetSpacesInLevel\)/,
  );
  assert.match(
    wizardSource,
    /setTargetSpaceLevel\([\s\S]*?setTargetSpaceId\(null\);[\s\S]*?setTargetFolder\(\{ id: null, name: '根目录' \}\);/,
  );
  assert.doesNotMatch(sourceSelector, /setSelected/);
  assert.match(
    wizardSource,
    /purpose === 'target' && sourceSpaceIds\.has\(space\.id\)/,
  );
});
