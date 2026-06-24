import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildFilesScope, getResolvedFileCount } from '../src/components/qaKnowledgeScopeSelection';

const contentApiSource = readFileSync('src/api/content.ts', 'utf8');
const qaPageSource = readFileSync('src/pages/QAPage.tsx', 'utf8');
const pickerSource = readFileSync('src/components/QAKnowledgeTreePicker.tsx', 'utf8');

test('qa knowledge picker exposes tree APIs and scope payload contract', () => {
  assert.match(contentApiSource, /export type QaKnowledgeScope/);
  assert.match(contentApiSource, /fetchQaKnowledgeTreeSpaces/);
  assert.match(contentApiSource, /fetchQaKnowledgeTreeChildren/);
  assert.match(contentApiSource, /searchQaKnowledgeFiles/);
  assert.match(contentApiSource, /knowledgeScope\?:\s*QaKnowledgeScope/);
  assert.match(contentApiSource, /knowledge_scope/);
  assert.match(contentApiSource, /mode:\s*'knowledge_space'/);
  assert.match(contentApiSource, /mode:\s*'files'/);
});

test('qa page delegates knowledge selection to the tree picker without all-select', () => {
  assert.match(qaPageSource, /QAKnowledgeTreePicker/);
  assert.match(qaPageSource, /selectedKnowledgeScope/);
  assert.match(qaPageSource, /knowledgeScope:\s*selectedKnowledgeScope/);
  assert.doesNotMatch(qaPageSource, /selectAllKnowledgeSpaces/);
  assert.doesNotMatch(qaPageSource, />全选</);
  assert.doesNotMatch(qaPageSource, /selectedKnowledgeSpaceIds/);
});

test('qa knowledge tree picker renders lazy tree states and exact limit prompts', () => {
  assert.match(pickerSource, /一次最多可选择1个库进行问答。/);
  assert.match(pickerSource, /一次最多可选择20个文件进行问答。/);
  assert.match(pickerSource, /展开目录/);
  assert.match(pickerSource, /展开目录（可多选子项）/);
  assert.match(pickerSource, /收起目录（可多选子项）/);
  assert.match(pickerSource, /spaceAction/);
  assert.match(pickerSource, /spaceTitleButton/);
  assert.match(pickerSource, /收起目录/);
  assert.match(pickerSource, /加载失败/);
  assert.match(pickerSource, /暂无可见内容/);
  assert.match(pickerSource, /onLoadChildren/);
  assert.match(pickerSource, /resolvedFileCount/);
  assert.doesNotMatch(pickerSource, />全选</);
});

test('qa knowledge tree picker supports file-name search metadata and dedupe', () => {
  assert.match(pickerSource, /onSearchFiles/);
  assert.match(pickerSource, /文件名搜索/);
  assert.match(pickerSource, /所在目录/);
  assert.match(pickerSource, /搜索无结果/);
  assert.match(pickerSource, /searchGroups/);
  assert.match(pickerSource, /searchSpaceBlock/);
  assert.match(pickerSource, /searchFileRow/);
  assert.match(pickerSource, /个匹配文件/);
  assert.match(pickerSource, /isFileSelected/);
  assert.match(pickerSource, /toggleFileRef/);
  assert.doesNotMatch(pickerSource, /className=\{s\.searchResults\}/);
});

test('qa knowledge scope count dedupes known folder files and explicit file refs', () => {
  const folderRefs = [
    {
      knowledgeSpaceId: 7101,
      folderId: 3001,
      resolvedFileCount: 2,
      fileRefs: [
        { knowledgeSpaceId: 7101, fileId: 9001 },
        { knowledgeSpaceId: 7101, fileId: 9002 },
      ],
    },
  ];
  const fileRefs = [
    { knowledgeSpaceId: 7101, fileId: 9001 },
    { knowledgeSpaceId: 7101, fileId: 9003 },
  ];

  assert.equal(getResolvedFileCount(fileRefs, folderRefs), 3);
  assert.equal(buildFilesScope(fileRefs, folderRefs).resolvedFileCount, 3);
});
