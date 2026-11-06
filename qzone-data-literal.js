const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100000;
const INVALID_SYNTAX = 'Invalid data literal syntax';

function invalid() {
  throw new SyntaxError(INVALID_SYNTAX);
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > MAX_INPUT_BYTES) return bytes;
  }
  return bytes;
}

function isWhitespace(character) {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

function isDigit(character) {
  return character >= '0' && character <= '9';
}

function isHexDigit(character) {
  return (character >= '0' && character <= '9')
    || (character >= 'a' && character <= 'f')
    || (character >= 'A' && character <= 'F');
}

function isIdentifierStart(character) {
  return (character >= 'A' && character <= 'Z')
    || (character >= 'a' && character <= 'z')
    || character === '_'
    || character === '$';
}

function isIdentifierPart(character) {
  return isIdentifierStart(character) || isDigit(character);
}

function defineDataProperty(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}

function defineArrayValue(array, value) {
  Object.defineProperty(array, String(array.length), {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}

function parse(text) {
  let position = 0;
  let nodeCount = 0;

  function consumeNode() {
    nodeCount += 1;
    if (nodeCount > MAX_NODES) invalid();
  }

  function current() {
    return text[position];
  }

  function skipWhitespace() {
    while (position < text.length && isWhitespace(text[position])) position += 1;
  }

  function parseValue(depth) {
    consumeNode();
    skipWhitespace();
    const character = current();
    if (character === '{') return parseObject(depth + 1);
    if (character === '[') return parseArray(depth + 1);
    if (character === '"' || character === "'") return parseString();
    if (character === '-' || isDigit(character)) return parseNumber();
    if (character === 't') return parseKeyword('true', true);
    if (character === 'f') return parseKeyword('false', false);
    if (character === 'n') return parseKeyword('null', null);
    // Qzone uses an explicit undefined placeholder in feed arrays. Treat it as
    // absent data; this is a fixed token and never a global variable lookup.
    if (character === 'u') return parseKeyword('undefined', null);
    invalid();
  }

  function parseKeyword(keyword, value) {
    if (text.slice(position, position + keyword.length) !== keyword) invalid();
    position += keyword.length;
    return value;
  }

  function parseNumber() {
    const start = position;
    if (current() === '-') position += 1;

    if (current() === '0') {
      position += 1;
      if (isDigit(current())) invalid();
    } else {
      if (!isDigit(current()) || current() === '0') invalid();
      while (isDigit(current())) position += 1;
    }

    if (current() === '.') {
      position += 1;
      if (!isDigit(current())) invalid();
      while (isDigit(current())) position += 1;
    }

    if (current() === 'e' || current() === 'E') {
      position += 1;
      if (current() === '+' || current() === '-') position += 1;
      if (!isDigit(current())) invalid();
      while (isDigit(current())) position += 1;
    }

    const value = Number(text.slice(start, position));
    if (!Number.isFinite(value)) invalid();
    return value;
  }

  function parseString() {
    const quote = current();
    const parts = [];
    position += 1;

    while (position < text.length) {
      const start = position;
      while (position < text.length) {
        const character = text[position];
        if (character === quote || character === '\\' || character === '\n'
          || character === '\r' || character === '\u2028' || character === '\u2029') {
          break;
        }
        position += 1;
      }
      if (position > start) parts.push(text.slice(start, position));

      const character = current();
      if (character === quote) {
        position += 1;
        return parts.join('');
      }
      if (character !== '\\') invalid();

      position += 1;
      const escaped = current();
      if (escaped === undefined) invalid();

      if (escaped === '\n') {
        position += 1;
        continue;
      }
      if (escaped === '\r') {
        position += 1;
        if (current() === '\n') position += 1;
        continue;
      }
      if (escaped === '\u2028' || escaped === '\u2029') {
        position += 1;
        continue;
      }

      if (escaped === 'b') parts.push('\b');
      else if (escaped === 'f') parts.push('\f');
      else if (escaped === 'n') parts.push('\n');
      else if (escaped === 'r') parts.push('\r');
      else if (escaped === 't') parts.push('\t');
      else if (escaped === 'v') parts.push('\v');
      else if (escaped === '0') {
        if (isDigit(text[position + 1])) invalid();
        parts.push('\0');
      } else if (escaped === 'x') {
        const first = text[position + 1];
        const second = text[position + 2];
        if (!isHexDigit(first) || !isHexDigit(second)) invalid();
        parts.push(String.fromCharCode(Number.parseInt(first + second, 16)));
        position += 2;
      } else if (escaped === 'u') {
        let hex = '';
        for (let offset = 1; offset <= 4; offset += 1) {
          const digit = text[position + offset];
          if (!isHexDigit(digit)) invalid();
          hex += digit;
        }
        parts.push(String.fromCharCode(Number.parseInt(hex, 16)));
        position += 4;
      } else if (escaped === '\\' || escaped === '/' || escaped === '"' || escaped === "'") {
        parts.push(escaped);
      } else {
        invalid();
      }
      position += 1;
    }
    invalid();
  }

  function parseObject(depth) {
    if (depth > MAX_DEPTH) invalid();
    const object = {};
    position += 1;
    skipWhitespace();
    if (current() === '}') {
      position += 1;
      return object;
    }

    while (true) {
      consumeNode();
      const key = parseKey();
      skipWhitespace();
      if (current() !== ':') invalid();
      position += 1;
      const value = parseValue(depth);
      defineDataProperty(object, key, value);
      skipWhitespace();

      if (current() === '}') {
        position += 1;
        return object;
      }
      if (current() !== ',') invalid();
      position += 1;
      skipWhitespace();
      if (current() === '}') {
        position += 1;
        return object;
      }
    }
  }

  function parseKey() {
    skipWhitespace();
    const character = current();
    if (character === '"' || character === "'") return parseString();
    if (!isIdentifierStart(character)) invalid();
    const start = position;
    position += 1;
    while (isIdentifierPart(current())) position += 1;
    return text.slice(start, position);
  }

  function parseArray(depth) {
    if (depth > MAX_DEPTH) invalid();
    const array = [];
    position += 1;
    skipWhitespace();
    if (current() === ']') {
      position += 1;
      return array;
    }

    while (true) {
      defineArrayValue(array, parseValue(depth));
      skipWhitespace();
      if (current() === ']') {
        position += 1;
        return array;
      }
      if (current() !== ',') invalid();
      position += 1;
      skipWhitespace();
      if (current() === ']') {
        position += 1;
        return array;
      }
    }
  }

  try {
    const value = parseValue(0);
    skipWhitespace();
    if (position !== text.length) invalid();
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) error.position = position;
    throw error;
  }
}

export function parseQzoneDataLiteral(text) {
  if (typeof text !== 'string' || utf8ByteLength(text) > MAX_INPUT_BYTES) invalid();
  return parse(text);
}
