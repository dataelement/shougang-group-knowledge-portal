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
      /(?:服务连接异常|问答请求失败)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('throws the safe business message when the SSE stream emits an error event', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    sseBody([
      'event: error\ndata: {"status_code":500,"status_message":"模型服务暂时不可用","data":{"exception":"provider token=secret failed"}}\n\n',
    ]),
    { status: 200 },
  )) as typeof fetch;

  try {
    await assert.rejects(
      () => streamDocumentFileChat({
        spaceId: 12,
        fileId: 1580,
        text: '这个文档的核心内容是什么？',
        onUpdate() {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, '模型服务暂时不可用');
        assert.doesNotMatch(error.message, /token=secret/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not expose technical details from an SSE status message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    sseBody([
      'event: error\ndata: {"status_code":500,"status_message":"模型调用失败 token=secret","data":{}}\n\n',
    ]),
    { status: 200 },
  )) as typeof fetch;

  try {
    await assert.rejects(
      () => streamDocumentFileChat({
        spaceId: 12,
        fileId: 1580,
        text: '这个文档的核心内容是什么？',
        onUpdate() {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, '服务暂时不可用，请稍后重试。');
        assert.doesNotMatch(error.message, /token=secret/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports retry progress and formats a structured failure as title plus reason', async () => {
  const originalFetch = globalThis.fetch;
  const retries: string[] = [];
  globalThis.fetch = (async () => new Response(
    sseBody([
      'event: retry\ndata: {"attempt":1,"max_attempts":2,"retry_after_ms":500,"message":"provider token=secret"}\n\n',
      'event: error\ndata: {"status_code":500,"kind":"model","title":"模型调用失败","reason":"模型服务暂时不可用，请稍后重试。","retryable":true,"data":{"exception":"token=secret"}}\n\n',
    ]),
    { status: 200 },
  )) as typeof fetch;

  try {
    await assert.rejects(
      () => streamDocumentFileChat({
        spaceId: 12,
        fileId: 1580,
        text: '这个文档的核心内容是什么？',
        onUpdate() {},
        onRetry(progress) {
          retries.push(progress.message);
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, '模型调用失败\n模型服务暂时不可用，请稍后重试。');
        assert.doesNotMatch(error.message, /token=secret/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(retries, ['正在重试（1/2）']);
});

test('throws when the SSE stream closes without an answer', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(sseBody([]), { status: 200 })) as typeof fetch;

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

test('parses an answer event split across response chunks', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const updates: string[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: message\ndata: {"category":"stream","type":"stream","message":{"content":"分'));
      controller.enqueue(encoder.encode('片回答"}}\n\n'));
      controller.close();
    },
  });
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;

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

  assert.deepEqual(updates, ['分片回答']);
});
