import assert from 'node:assert/strict';
import test from 'node:test';
import { streamDocumentFileChat } from '../src/api/content';

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

test('streams document file chat through the portal BFF', async () => {
  const originalFetch = globalThis.fetch;
  const updates: string[] = [];
  let requestPath = '';
  let requestBody = '';
  globalThis.fetch = (async (input, init) => {
    requestPath = String(input);
    requestBody = String(init?.body);
    return new Response(
      sseBody([
        'data: {"category":"stream","type":"stream","message":{"content":"你好"}}\n\n',
        'data: {"category":"stream","type":"stream","message":{"content":"，文档"}}\n\n',
        'data: {"category":"stream","type":"end","message":{"content":"你好，文档"}}\n\n',
      ]),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    await streamDocumentFileChat({
      spaceId: 12,
      fileId: 1580,
      text: '这个文档的核心内容是什么？',
      onUpdate(text) {
        updates.push(text);
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestPath, '/api/v1/knowledge/space/12/files/1580/chat');
  assert.deepEqual(JSON.parse(requestBody), {
    query: '这个文档的核心内容是什么？',
    model: '',
  });
  assert.deepEqual(updates, ['你好', '你好，文档']);
});

test('throws when document file chat request is rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 502 })) as typeof fetch;

  try {
    await assert.rejects(
      () => streamDocumentFileChat({
        spaceId: 12,
        fileId: 1580,
        text: '这个文档的核心内容是什么？',
        onUpdate() {},
      }),
      /问答请求失败/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
