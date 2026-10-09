const DEFAULT_LIMITS = Object.freeze({depth: 64, values: 100000, stringCodeUnits: 1048576});

export function parseStrictJson(bytes, limits = DEFAULT_LIMITS) {
  if (!(bytes instanceof Uint8Array)) throw new Error("strict JSON bytes required");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error("JSON UTF-8 BOM unsupported");
  let text;
  try { text = new TextDecoder("utf-8", {fatal: true}).decode(bytes); }
  catch { throw new Error("JSON UTF-8 invalid"); }
  let offset = 0;
  let values = 0;
  const countValue = () => {
    values += 1;
    if (values > limits.values) throw new Error("JSON value limit exceeded");
  };
  const skip = () => { while (/[\u0009\u000a\u000d\u0020]/u.test(text[offset] ?? "")) offset += 1; };
  const fail = message => { throw new Error(`${message} at JSON offset ${offset}`); };
  const parseString = () => {
    if (text[offset] !== '"') fail("JSON string required");
    offset += 1;
    let value = "";
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        if (value.length > limits.stringCodeUnits) fail("JSON string limit exceeded");
        return value;
      }
      if (character === "\\") {
        const escape = text[offset++];
        const simple = {'"':'"', "\\":"\\", "/":"/", "b":"\b", "f":"\f", "n":"\n", "r":"\r", "t":"\t"};
        if (Object.hasOwn(simple, escape)) value += simple[escape];
        else if (escape === "u") {
          const hex = text.slice(offset, offset + 4);
          if (!/^[0-9A-Fa-f]{4}$/u.test(hex)) fail("JSON Unicode escape invalid");
          const first = Number.parseInt(hex, 16);
          offset += 4;
          if (first >= 0xd800 && first <= 0xdbff) {
            if (text.slice(offset, offset + 2) !== "\\u") fail("JSON unpaired high surrogate");
            const secondHex = text.slice(offset + 2, offset + 6);
            if (!/^[0-9A-Fa-f]{4}$/u.test(secondHex)) fail("JSON Unicode surrogate invalid");
            const second = Number.parseInt(secondHex, 16);
            if (second < 0xdc00 || second > 0xdfff) fail("JSON unpaired high surrogate");
            value += String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00));
            offset += 6;
          } else {
            if (first >= 0xdc00 && first <= 0xdfff) fail("JSON unpaired low surrogate");
            value += String.fromCharCode(first);
          }
        } else fail("JSON escape invalid");
      } else {
        if (character.charCodeAt(0) < 0x20) fail("JSON control character invalid");
        value += character;
      }
      if (value.length > limits.stringCodeUnits) fail("JSON string limit exceeded");
    }
    fail("JSON string unterminated");
  };
  const parseNumber = () => {
    const remaining = text.slice(offset);
    const match = remaining.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (!match) fail("JSON number invalid");
    offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("JSON finite number required");
    return value;
  };
  const parseValue = depth => {
    if (depth > limits.depth) fail("JSON depth limit exceeded");
    skip();
    countValue();
    const token = text[offset];
    if (token === '"') return parseString();
    if (token === "{") {
      offset += 1;
      const result = Object.create(null);
      const keys = new Set();
      skip();
      if (text[offset] === "}") { offset += 1; return result; }
      while (true) {
        skip();
        const key = parseString();
        if (keys.has(key)) fail(`JSON duplicate key: ${key}`);
        keys.add(key);
        skip();
        if (text[offset++] !== ":") fail("JSON object colon required");
        result[key] = parseValue(depth + 1);
        skip();
        const delimiter = text[offset++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") fail("JSON object delimiter invalid");
      }
    }
    if (token === "[") {
      offset += 1;
      const result = [];
      skip();
      if (text[offset] === "]") { offset += 1; return result; }
      while (true) {
        result.push(parseValue(depth + 1));
        skip();
        const delimiter = text[offset++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") fail("JSON array delimiter invalid");
      }
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return value; }
    }
    if (token === "-" || /[0-9]/u.test(token ?? "")) return parseNumber();
    fail("JSON value invalid");
  };
  const result = parseValue(0);
  skip();
  if (offset !== text.length) fail("Trailing JSON material");
  return result;
}
