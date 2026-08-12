/**
 * json-repair.ts
 *
 * Repairs JSON that was truncated mid-stream by an LLM (DeepSeek's thinking
 * mode frequently exhausts the output budget mid-structure, leaving a valid
 * JSON prefix with an unterminated tail — e.g. cut inside a string or right
 * after a value with unclosed braces/brackets).
 *
 * Strategy: scan the raw text forward, tracking string state. Record every
 * boundary where the prefix is a complete value (closed string, closed
 * container, or finished number/keyword). If the input ends inside a string,
 * also record the last container close before the string's opening quote —
 * that drops a half-built object entirely (a heading with no text is worse
 * than no heading). Then try each candidate from cleanest to largest,
 * recompute the open containers over that prefix, append missing closers,
 * and return the first parseable result. Null means not salvageable.
 */

export function repairTruncatedJson(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;

  let inString = false;
  let escaped = false;
  let cut = -1; // most recent complete-value boundary
  let tokenStart = -1;
  const candidates: number[] = [];

  const isTokenChar = (c: string) => /[0-9a-zA-Z.\-+eE]/.test(c);

  const record = (end: number) => {
    if (end > cut) {
      cut = end;
      candidates.push(end);
    }
  };

  const finishToken = (end: number) => {
    if (tokenStart !== -1) {
      record(end);
      tokenStart = -1;
    }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
        // A closed string is a complete value UNLESS it's an object key
        // (followed by ':'). Peek ahead.
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] !== ":") {
          record(i + 1);
        }
      }
      continue;
    }

    if (c === '"') {
      finishToken(i);
      inString = true;
    } else if (c === "{" || c === "[") {
      finishToken(i);
    } else if (c === "}" || c === "]") {
      finishToken(i);
      record(i + 1); // closed container is a complete value
    } else if (c === ":" || c === ",") {
      finishToken(i);
    } else if (/\s/.test(c)) {
      finishToken(i);
    } else if (isTokenChar(c)) {
      if (tokenStart === -1) tokenStart = i;
    } else {
      return null; // unexpected character — not salvageable
    }
  }

  // End of input: a trailing number/keyword may be complete.
  finishToken(text.length);

  let containerClose = -1;
  if (inString) {
    // Preferred cut: the last COMPLETE container close before the broken
    // string's opening quote. Drops the half-built object/array entirely.
    let openQuote = -1;
    let esc = false;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === '"' && !esc) {
        openQuote = i;
        break;
      }
      if (text[i] === "\\") esc = !esc;
      else esc = false;
    }
    if (openQuote !== -1) {
      for (let i = openQuote - 1; i >= 0; i--) {
        if (text[i] === "}" || text[i] === "]") {
          containerClose = i + 1;
          break;
        }
      }
    }
  }

  const ordered =
    containerClose !== -1
      ? [containerClose, ...candidates.filter((c) => c !== containerClose).sort((a, b) => b - a)]
      : candidates.slice().sort((a, b) => b - a);

  for (const boundary of ordered) {
    const prefix = text.slice(0, boundary);
    if (!prefix) continue;

    // Recompute open containers over THIS prefix only, then close them.
    const stack: string[] = [];
    let sIn = false;
    let sEsc = false;
    for (const c of prefix) {
      if (sIn) {
        if (sEsc) sEsc = false;
        else if (c === "\\") sEsc = true;
        else if (c === '"') sIn = false;
        continue;
      }
      if (c === '"') sIn = true;
      else if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") stack.pop();
    }
    const closers = stack
      .reverse()
      .map((o) => (o === "{" ? "}" : "]"))
      .join("");

    try {
      return JSON.parse(prefix + closers);
    } catch {
      // try the next candidate
    }
  }

  return null;
}
