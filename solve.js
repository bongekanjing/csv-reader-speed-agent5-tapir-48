// A faster drop-in for csv-reader 1.0.0: the same reading of {text, header} as {columns, rows, errors}, by exactly its
// written policy, but with the text scanned in runs instead of a character at a time, so each field is one slice.
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

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The line the current record starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;
  const error = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // Reads unquoted characters from pos onto `prefix`, up to the next comma or line break: a CR not followed by LF is
  // dropped (stray_cr). Returns the field, how it ended, and how many characters it added.
  function readUnquoted(prefix) {
    let value = prefix;
    let added = 0;
    let seg = pos;
    let i = pos;
    for (;;) {
      if (i >= len) {
        if (i > seg) {
          value += text.slice(seg, i);
          added += i - seg;
        }
        pos = i;
        return { value, ended: END, added };
      }
      const c = text.charCodeAt(i);
      if (c === 0x2c) {
        if (i > seg) {
          value += text.slice(seg, i);
          added += i - seg;
        }
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (c === 0x0a) {
        if (i > seg) {
          value += text.slice(seg, i);
          added += i - seg;
        }
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (c === 0x0d) {
        if (i > seg) {
          value += text.slice(seg, i);
          added += i - seg;
        }
        if (i + 1 < len && text.charCodeAt(i + 1) === 0x0a) {
          pos = i + 2;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        error('stray_cr');
        i += 1;
        seg = i;
        pos = i;
        continue;
      }
      i += 1;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    for (;;) {
      if (pos >= len) break;
      const c = text.charCodeAt(pos);
      if (c === 0x0a) {
        pos += 1;
        line += 1;
      } else if (c === 0x0d && pos + 1 < len && text.charCodeAt(pos + 1) === 0x0a) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quotedLast = false;

    for (;;) {
      let value;
      let ended;
      if (text.charCodeAt(pos) === 0x22) {
        // A quoted field: runs to the next quote that is not doubled.
        quotedLast = true;
        const open = pos;
        const openLine = line;
        let i = pos + 1;
        let out = '';
        let seg = i;
        let closed = false;
        while (i < len) {
          const c = text.charCodeAt(i);
          if (c === 0x22) {
            if (i + 1 < len && text.charCodeAt(i + 1) === 0x22) {
              out += text.slice(seg, i + 1); // the first of the doubled quotes
              i += 2;
              seg = i;
              continue;
            }
            out += text.slice(seg, i);
            i += 1;
            closed = true;
            break;
          }
          if (c === 0x0d) {
            // CRLF and a lone CR inside quotes are each one LF.
            out += `${text.slice(seg, i)}\n`;
            line += 1;
            i += i + 1 < len && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
            seg = i;
            continue;
          }
          if (c === 0x0a) line += 1;
          i += 1;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          error('unterminated_quote');
          const r = readUnquoted('"');
          value = r.value;
          ended = r.ended;
        } else {
          pos = i;
          if (pos >= len) {
            value = out;
            ended = END;
          } else {
            const d = text.charCodeAt(pos);
            if (d === 0x2c) {
              pos += 1;
              value = out;
              ended = COMMA;
            } else if (d === 0x0a) {
              pos += 1;
              line += 1;
              value = out;
              ended = LINE_BREAK;
            } else if (d === 0x0d && pos + 1 < len && text.charCodeAt(pos + 1) === 0x0a) {
              pos += 2;
              line += 1;
              value = out;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              const r = readUnquoted(out);
              value = r.value;
              if (r.added > 0) error('quote_junk');
              ended = r.ended;
            }
          }
        }
      } else {
        const r = readUnquoted('');
        value = r.value;
        ended = r.ended;
      }

      fields.push(value);
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;

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
