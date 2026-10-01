import test from 'node:test';
import assert from 'node:assert/strict';
import { bandLabelPosition } from './timeline.js';

test('narrow word bands keep their geometry but do not expose partial glyph labels', () => {
  assert.equal(bandLabelPosition(12, 160, 8, 148, 800), null);
  assert.equal(bandLabelPosition(12, 160, 21, 148, 800), null);
  assert.equal(bandLabelPosition(12, 160, 22, 148, 800), 165);
  assert.equal(bandLabelPosition(12, 160, 48, 148, 800), 165);
});

test('every band label requires room for its complete text and both side paddings', () => {
  assert.equal(bandLabelPosition(110, 200, 119, 148, 800), null);
  assert.equal(bandLabelPosition(110, 200, 120, 148, 800), 205);
});

test('panned bands use only visible plot width, never label-column or offscreen width', () => {
  assert.equal(bandLabelPosition(32, 120, 60, 148, 800), null);
  assert.equal(bandLabelPosition(22, 120, 60, 148, 800), 153);
  assert.equal(bandLabelPosition(32, 780, 80, 148, 800), null);
  assert.equal(bandLabelPosition(10, 780, 80, 148, 800), 785);
  assert.equal(bandLabelPosition(10, 800, 80, 148, 800), null);
});
