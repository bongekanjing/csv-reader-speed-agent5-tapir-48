// A faster drop-in for csv-reader 1.0.0: the same reading of {text, header} as {columns, rows, errors}, by exactly its
// written policy, with each unquoted run cut in one native scan (a sticky regex) instead of a character at a time.
//
// The policy, as csv-reader 1.0.0 states it:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each CRLF
//     or lone CR inside it read as LF; what follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes is a literal character and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the records after it, each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, line the 1-based line its record starts on, row its index in rows (null for the
//     header), in the order met: a field's quote_junk when the field ends, a record's short_row or long_row when it ends.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// A run of ordinary unquoted text: everything but a quote, a comma and the two line-break characters.
const RUN = /[^",\r\n]*/y;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;
  const fail = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // Reads unquoted text from pos onto `value`, up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field, how it ended, and how many characters it added.
  const readUnquoted = (value) => {
    let added = 0;
    for (;;) {
      if (pos >= n) return { value, ended: END, added };
      RUN.lastIndex = pos;
      RUN.exec(text);
      const stop = RUN.lastIndex;
      if (stop > pos) {
        value += text.slice(pos, stop);
        added += stop - pos;
        pos = stop;
        if (pos >= n) return { value, ended: END, added };
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (c === 34) {
        // A quote inside an unquoted field is a literal character.
        value += '"';
        added += 1;
        pos += 1;
        continue;
      }
      // A CR: CRLF ends the record, a lone CR is dropped with stray_cr.
      if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      fail('stray_cr');
      pos += 1;
    }
  };

  // Reads a field whose opening quote is at pos. Returns the field and how it ended.
  const readQuoted = () => {
    const open = pos;
    const openLine = line;
    let value = '';
    let i = pos + 1;
    let from = i;
    let closed = false;

    for (;;) {
      const q = text.indexOf('"', i);
      if (q < 0) break;
      // The run before this quote may hold CRs and LFs: each counts a line, and both read as one LF.
      const seg = text.slice(from, q);
      if (seg.indexOf('\r') < 0 && seg.indexOf('\n') < 0) {
        value += seg;
      } else {
        let buf = '';
        let k = 0;
        const m = seg.length;
        while (k < m) {
          const c = seg.charCodeAt(k);
          if (c === 13) {
            buf += '\n';
            line += 1;
            k += k + 1 < m && seg.charCodeAt(k + 1) === 10 ? 2 : 1;
          } else if (c === 10) {
            buf += '\n';
            line += 1;
            k += 1;
          } else {
            let j = k;
            while (j < m) {
              const d = seg.charCodeAt(j);
              if (d === 13 || d === 10) break;
              j += 1;
            }
            buf += seg.slice(k, j);
            k = j;
          }
        }
        value += buf;
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        value += '"';
        i = q + 2;
        from = i;
        continue;
      }
      i = q + 1;
      closed = true;
      break;
    }

    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      fail('unterminated_quote');
      return readUnquoted('"');
    }

    pos = i;
    if (pos >= n) return { value, ended: END };
    const d = text.charCodeAt(pos);
    if (d === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (d === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (d === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands.
    const junk = readUnquoted(value);
    if (junk.added > 0) fail('quote_junk');
    return junk;
  };

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let first = '';
    let quoted = false;
    let ended;
    for (;;) {
      quoted = text.charCodeAt(pos) === 34;
      const r = quoted ? readQuoted() : readUnquoted('');
      if (fields.length === 0) first = r.value;
      fields.push(r.value);
      ended = r.ended;
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && first === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
