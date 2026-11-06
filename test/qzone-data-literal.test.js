import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQzoneDataLiteral } from '../qzone-data-literal.js';

test('parses mixed JS object literal and JSON data from Qzone feeds', () => {
  const input = String.raw`{"code":0,"data":{main:{foo:'', items:[{html:'\x3Cdiv\x3E',enabled:true,score:-1.25e2,missing:null},],},}}`;
  const result = parseQzoneDataLiteral(input);

  assert.equal(result.code, 0);
  assert.equal(result.data.main.foo, '');
  assert.equal(result.data.main.items[0].html, '<div>');
  assert.equal(result.data.main.items[0].enabled, true);
  assert.equal(result.data.main.items[0].score, -125);
  assert.equal(result.data.main.items[0].missing, null);
});

test('parses nested normal JSON identically to JSON.parse', () => {
  const input = JSON.stringify({
    code: 0,
    data: {
      main: {
        items: [{ id: 1, tags: ['mobile', 'photo'], meta: { empty: {}, list: [] } }]
      }
    }
  });

  assert.deepEqual(parseQzoneDataLiteral(input), JSON.parse(input));
});

test('decodes basic JS escapes, quoted quotes, and line continuations', () => {
  const input = String.raw`{"single":'it\'s',"double":"a\"b","basic":"\b\f\n\r\t\v\0\/","joined":"left` + '\\' + '\r\n' + String.raw`right"}`;
  const result = parseQzoneDataLiteral(input);

  assert.equal(result.single, "it's");
  assert.equal(result.double, 'a"b');
  assert.equal(result.basic, '\b\f\n\r\t\v\0/');
  assert.equal(result.joined, 'leftright');
});

test('respects escaped backslash parity for x and u escapes', () => {
  const input = String.raw`{"decodedX":"\x41","literalX":"\\x41","decodedU":"\u0041","literalU":"\\u0041","odd":"\\\x41"}`;
  const result = parseQzoneDataLiteral(input);

  assert.equal(result.decodedX, 'A');
  assert.equal(result.literalX, String.raw`\x41`);
  assert.equal(result.decodedU, 'A');
  assert.equal(result.literalU, String.raw`\u0041`);
  assert.equal(result.odd, String.raw`\A`);
});

test('accepts only trailing commas, not elisions or missing values', () => {
  assert.deepEqual(parseQzoneDataLiteral('{a:1,}'), { a: 1 });
  assert.deepEqual(parseQzoneDataLiteral('[1,2,]'), [1, 2]);
  assert.throws(() => parseQzoneDataLiteral('[,]'), SyntaxError);
  assert.throws(() => parseQzoneDataLiteral('{a:1,,}'), SyntaxError);
  assert.throws(() => parseQzoneDataLiteral('{a,}'), SyntaxError);
});

test('rejects malformed literals with generic syntax errors', () => {
  const privateMarker = 'DO_NOT_ECHO_THIS_PAYLOAD';
  const invalidInputs = [
    `{privateValue:'${privateMarker}'`,
    '{a:1 b:2}',
    '{1abc:true}',
    '{caf\u00e9:true}',
    '"unterminated',
    String.raw`"\x4"`,
    String.raw`"\u123"`,
    String.raw`"\8"`,
    '{a:01}',
    '{a:1.}',
    '{a:1e}',
    '{"a":1} trailing',
    '{};'
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => parseQzoneDataLiteral(input),
      error => error instanceof SyntaxError
        && error.message === 'Invalid data literal syntax'
        && !error.message.includes(privateMarker)
    );
  }
});

test('rejects executable and non-data expression forms without running them', () => {
  delete globalThis.__qzoneLiteralSideEffect;
  const invalidInputs = [
    '({x:1})',
    '{x:function(){return 1}}',
    '{x:()=>1}',
    '{x:getValue()}',
    '{get x(){return 1}}',
    '{x:{toString(){return 1}}}',
    '{...source}',
    '{x:/pattern/}',
    '{x:NaN}',
    '{x:Infinity}',
    '{x:(globalThis.__qzoneLiteralSideEffect=true)}',
    '{x:alert("side effect")}'
  ];

  for (const input of invalidInputs) {
    assert.throws(() => parseQzoneDataLiteral(input), SyntaxError);
    assert.equal(globalThis.__qzoneLiteralSideEffect, undefined);
  }
});

test('Qzone undefined placeholders are inert null data without variable lookup', () => {
  assert.deepEqual(parseQzoneDataLiteral('{data:[undefined],missing:undefined}'), {data:[null],missing:null});
  assert.throws(() => parseQzoneDataLiteral('{x:undefinedValue}'), SyntaxError);
  assert.throws(() => parseQzoneDataLiteral('{x:undefined()}'), SyntaxError);
});

test('defines __proto__ and constructor as inert own data properties', () => {
  delete Object.prototype.polluted;
  const result = parseQzoneDataLiteral(
    '{__proto__:{polluted:true},constructor:{prototype:{polluted:true}}}'
  );

  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(Object.hasOwn(result, 'constructor'), true);
  assert.equal(result.__proto__.polluted, true);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(result.constructor.prototype.polluted, true);
});

test('enforces input, nesting, and node limits', () => {
  const oversized = '"' + 'a'.repeat(2 * 1024 * 1024) + '"';
  assert.throws(() => parseQzoneDataLiteral(oversized), SyntaxError);

  const atDepthLimit = '['.repeat(64) + '0' + ']'.repeat(64);
  assert.equal(Array.isArray(parseQzoneDataLiteral(atDepthLimit)), true);
  const overDepthLimit = '['.repeat(65) + '0' + ']'.repeat(65);
  assert.throws(() => parseQzoneDataLiteral(overDepthLimit), SyntaxError);

  const overNodeLimit = '[' + 'null,'.repeat(100000) + 'null]';
  assert.throws(() => parseQzoneDataLiteral(overNodeLimit), SyntaxError);
});
