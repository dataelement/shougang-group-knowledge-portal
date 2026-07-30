import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fetchHomeExpertQuestions } from '../src/api/expertQa';

const expertQuestionsSource = readFileSync('src/components/ExpertQuestions.tsx', 'utf8');

test('home expert questions use the anonymous portal BFF', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        status_code: 200,
        status_message: 'SUCCESS',
        data: {
          questions: [
            { id: 1, title: '问题一' },
            { id: 2, title: '问题二' },
          ],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const questions = await fetchHomeExpertQuestions(8);
    assert.equal(requestedUrl, '/api/v1/expert-qa/home-questions?limit=8');
    assert.deepEqual(questions, [
      { id: 1, title: '问题一' },
      { id: 2, title: '问题二' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('home expert question links request unified-auth-first login', () => {
  assert.match(expertQuestionsSource, /fetchHomeExpertQuestions\(limit\)/);
  assert.doesNotMatch(expertQuestionsSource, /fetchExpertQuestions\(/);
  assert.match(
    expertQuestionsSource,
    /triggerLoginRedirect\(path, \{ preferUnifiedAuth: true \}\)/,
  );
  assert.match(expertQuestionsSource, /guardLink\(EXPERT_QA_PATH\)/);
  assert.match(expertQuestionsSource, /guardLink\(EXPERT_QA_ASK_PATH\)/);
  assert.match(expertQuestionsSource, /guardLink\(`\$\{EXPERT_QA_PATH\}\/\$\{question\.id\}`\)/);
});
