// node --test tests/block-clipboard.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The script is a plain browser file: given a `module`, it only exports its pure functions.
const source = readFileSync(
  new URL(
    '../src/wagtail_block_clipboard/static/wagtail_block_clipboard/block-clipboard.js',
    import.meta.url,
  ),
  'utf8',
);
const module = { exports: {} };
new Function('module', source)(module);
const { findPasteTarget } = module.exports;

const field = (name, blockClass) => ({ name, meta: { blockClass } });
const struct = (name, blockClass, children) => ({
  name,
  meta: { blockClass },
  childBlockDefsByName: Object.fromEntries(children.map((child) => [child.name, child])),
});
const stream = (name, children) => ({
  name,
  meta: {},
  groupedChildBlockDefs: [['', children]],
  childBlockDefsByName: Object.fromEntries(children.map((child) => [child.name, child])),
});
const list = (name, child) => ({ name, meta: {}, childBlockDef: child });

const card = struct('card', 'app.CardBlock', [field('title', 'CharBlock')]);
const copiedCard = {
  container: 'stream',
  type: 'card',
  blockClass: 'app.CardBlock',
  state: { title: 'Hello', legacy: 'gone' },
};

test('a block pastes in any stream that has the same type and class, whatever the depth', () => {
  const nested = stream('column', [card, field('text', 'RichTextBlock')]);
  const target = findPasteTarget(copiedCard, nested);
  assert.equal(target.blockDef, card);
});

test('fields the target does not have are left out and reported', () => {
  const target = findPasteTarget(copiedCard, stream('body', [card]));
  assert.deepEqual(target.state, { title: 'Hello' });
  assert.deepEqual(target.dropped, ['legacy']);
});

test('same type name but another class is not the same block', () => {
  const other = stream('body', [field('card', 'wagtail.blocks.CharBlock')]);
  assert.equal(findPasteTarget(copiedCard, other), null);
});

test('same class under another type name is not the same block', () => {
  const other = stream('body', [struct('teaser', 'app.CardBlock', [])]);
  assert.equal(findPasteTarget(copiedCard, other), null);
});

test('a list item pastes in any list of the same class, and only there', () => {
  const item = { container: 'list', type: null, blockClass: 'app.CardBlock', state: {} };
  assert.ok(findPasteTarget(item, list('cards', card)));
  assert.equal(findPasteTarget(item, list('links', field('', 'app.LinkBlock'))), null);
  assert.equal(findPasteTarget(item, stream('body', [card])), null);
});

test('nested blocks of unknown types are left out, the others get new ids', () => {
  const columns = struct('columns', 'app.Columns', [stream('content', [card])]);
  const copied = {
    container: 'stream',
    type: 'columns',
    blockClass: 'app.Columns',
    state: {
      content: [
        { type: 'card', id: 'a', value: { title: 'Kept' } },
        { type: 'video', id: 'b', value: {} },
      ],
    },
  };
  const target = findPasteTarget(copied, stream('body', [columns]));
  assert.equal(target.state.content.length, 1);
  assert.notEqual(target.state.content[0].id, 'a');
  assert.deepEqual(target.dropped, ['video']);
});
