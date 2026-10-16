import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardSchema, contentType } from '../lib/clipboard';

test('clipboard input rejects empty text and oversized payloads', () => {
  for (const text of ['', '   ', 'x'.repeat(20001)]) assert.equal(clipboardSchema.safeParse({ text }).success, false);
  assert.equal(clipboardSchema.safeParse({ text: 'x'.repeat(20000) }).success, true);
  assert.equal(clipboardSchema.parse({ text: '  a thought  ' }).text, 'a thought');
});
test('content classification supports text, links, email and code', () => {
  for (const [text, expected] of [['https://example.com/path', 'URL'], ['me@example.com', 'Email'], ['const value = 1;', 'Code'], ['a thought', 'Text']]) assert.equal(contentType(text), expected);
});
