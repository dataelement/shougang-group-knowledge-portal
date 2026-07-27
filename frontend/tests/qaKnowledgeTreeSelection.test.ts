import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildFilesScope, getResolvedFileCount } from '../src/components/qaKnowledgeScopeSelection';
import { resolveActiveQaScope } from '../src/components/qaKnowledgeScopeMode';

const contentApiSource = readFileSync('src/api/content.ts', 'utf8');
const qaPageSource = readFileSync('src/pages/QAPage.tsx', 'utf8');
const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const pickerSource = readFileSync('src/components/QAKnowledgeTreePicker.tsx', 'utf8');
const categoryTreeSource = readFileSync('src/components/QAKnowledgeCategoryTree.tsx', 'utf8');
const homeQaDraftSource = readFileSync('src/utils/homeQaDraft.ts', 'utf8');

test('qa knowledge picker exposes tree APIs and scope payload contract', () => {
  assert.match(contentApiSource, /export type QaKnowledgeScope/);
  assert.match(contentApiSource, /fetchQaKnowledgeTreeSpaces/);
  assert.match(contentApiSource, /fetchQaKnowledgeTreeChildren/);
  assert.match(contentApiSource, /fetchQaKnowledgeFolderStats/);
  assert.match(contentApiSource, /searchQaKnowledgeFiles/);
  assert.match(contentApiSource, /browseSearchFiles/);
  assert.match(contentApiSource, /knowledgeScope\?:\s*QaKnowledgeScope/);
  assert.match(contentApiSource, /knowledge_scope/);
  assert.match(contentApiSource, /mode:\s*'knowledge_space'/);
  assert.match(contentApiSource, /mode:\s*'files'/);
});

test('qa page delegates knowledge selection to the tree picker without all-select', () => {
  assert.match(qaPageSource, /QAKnowledgeTreePicker/);
  assert.match(qaPageSource, /selectedKnowledgeScope/);
  assert.match(qaPageSource, /knowledgeScope:\s*useAllSpaces \? undefined : effScope/);
  assert.match(qaPageSource, /knowledgePickerMode/);
  assert.match(qaPageSource, /onBrowseCategoryFiles/);
  assert.doesNotMatch(qaPageSource, /selectAllKnowledgeSpaces/);
  assert.doesNotMatch(qaPageSource, /selectedKnowledgeSpaceIds/);
});

test('home page and qa page share category picker mode wiring', () => {
  assert.match(homePageSource, /QAKnowledgeTreePicker/);
  assert.match(homePageSource, /qaScopeMode/);
  assert.match(homePageSource, /onBrowseCategoryFiles/);
  assert.match(homePageSource, /browseSearchFiles/);
  assert.match(homeQaDraftSource, /scopeMode/);
  assert.match(homeQaDraftSource, /categoryScope/);
  assert.match(homeQaDraftSource, /knowledgeScope/);
});

test('qa knowledge tree picker supports dual mode and file limit', () => {
  assert.match(pickerSource, /一次最多可选择20个文件进行问答。/);
  assert.match(pickerSource, /按知识库/);
  assert.match(pickerSource, /按文件分类/);
  assert.match(pickerSource, /onPickerModeChange/);
  assert.match(pickerSource, /QAKnowledgeCategoryTree/);
  assert.match(pickerSource, /文件名搜索\/编码搜索/);
  assert.match(pickerSource, /search-cat-/);
  assert.match(pickerSource, /展开目录/);
  assert.match(pickerSource, /展开目录（可多选子项）/);
  assert.match(pickerSource, /spaceTitleButton/);
  assert.match(pickerSource, /收起目录/);
  assert.match(pickerSource, /加载失败/);
  assert.match(pickerSource, /暂无可见内容/);
  assert.match(pickerSource, /onLoadChildren/);
  assert.match(pickerSource, /onLoadFolderStats/);
  assert.match(pickerSource, /文件数量加载中/);
  assert.match(pickerSource, /resolvedFileCount/);
});

test('category tree loads files by document type and selects files only', () => {
  assert.match(categoryTreeSource, /一次最多可选择20个文件进行问答。/);
  assert.match(categoryTreeSource, /documentType/);
  assert.match(categoryTreeSource, /fileSubcategoryCode/);
  assert.match(categoryTreeSource, /onBrowseFiles/);
  assert.match(categoryTreeSource, /toggleFileRef/);
  assert.doesNotMatch(categoryTreeSource, /toggleCategoryFiles/);
  assert.doesNotMatch(categoryTreeSource, /选择该分类下全部可用文件/);
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

test('active scope resolves by picker mode without mixing drafts', () => {
  const knowledgeScope = { mode: 'knowledge_space' as const, knowledgeSpaceIds: [12] };
  const categoryScope = {
    mode: 'files' as const,
    fileRefs: [{ knowledgeSpaceId: 12, fileId: 99 }],
    folderRefs: [],
    resolvedFileCount: 1,
  };
  assert.deepEqual(resolveActiveQaScope('knowledge', knowledgeScope, categoryScope), knowledgeScope);
  assert.deepEqual(resolveActiveQaScope('category', knowledgeScope, categoryScope), categoryScope);
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

test('qa knowledge scope keeps the deep count when only part of a folder is loaded', () => {
  const folderRefs = [{
    knowledgeSpaceId: 7101,
    folderId: 3001,
    resolvedFileCount: 11,
    fileRefs: [{ knowledgeSpaceId: 7101, fileId: 9001 }],
  }];
  const fileRefs = [
    { knowledgeSpaceId: 7101, fileId: 9001 },
    { knowledgeSpaceId: 7101, fileId: 9002 },
  ];

  assert.equal(getResolvedFileCount(fileRefs, folderRefs), 12);
});

test('content api supports cursor pagination for tree children', () => {
  assert.match(contentApiSource, /fetchQaKnowledgeTreeChildren\s*\(\s*spaceId:\s*number,\s*parentId\?:\s*number,\s*cursor\?:\s*string/);
  assert.match(contentApiSource, /has_more/);
  assert.match(contentApiSource, /next_cursor/);
  assert.match(pickerSource, /loadMoreChildren/);
  assert.match(pickerSource, /hasMoreByKey/);
  assert.match(pickerSource, /IntersectionObserver/);
});
