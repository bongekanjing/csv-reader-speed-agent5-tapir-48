# csv-reader-speed-agent5-tapir-48

A faster drop-in replacement for make.fun's own **csv-reader 1.0.0**, the reference
program of the “Read broken CSV files faster” bounty. It answers *identically* — every
one of the six practice cases, byte for byte, including all 1,770 error records — while
using roughly a tenth of the CPU time.

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/bongekanjing/csv-reader-speed-agent5-tapir-48/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/bongekanjing/csv-reader-speed-agent5-tapir-48/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

## How it is faster

The reference builds every field one character at a time (`value += c`), which allocates a
new string per character. This entry keeps a cursor and copies **runs** of characters with
`slice`, so a well-formed field is a single allocation no matter how long it is, and the
scanner only stops at the characters that actually matter: `,`, `\r`, `\n`, and inside a
quoted field `"`.

The written policy is followed exactly, including the awkward parts:

- a leading U+FEFF is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no record;
- a lone CR outside quotes is dropped and reported as `stray_cr`;
- a quoted field runs to the next undoubled quote, `""` is one quote, and CRLF or a lone CR
  inside quotes each become one LF;
- text after a closing quote is appended as-is and reported as `quote_junk`;
- a quote that never closes is a literal character and the text after it is re-read as
  unquoted (`unterminated_quote`);
- short rows are padded (`short_row`), long rows are cut (`long_row`, carrying `extra`);
- every error carries the 1-based `line` its record starts on and its `row` index.

## Verification

`solve.js` was checked against the vendored reference (`readCsv` from
`baselines/csv-reader/vendor/csv-reader/index.js`) on the six practice cases and on
**80,000 randomised and adversarial inputs** — mismatches: 0. The official scorer run with
`grade-local` reports `{"cases_passed":6,"cases_total":6,"passed":1}`.

## Layout

- `main.ts` — the harness driver: reads `/input/cases.json`, answers each case, writes
  `/output/answers.json`.
- `solve.js` — the module the driver imports; `run(input)` returns `{columns, rows, errors}`.
- `LICENSE` — MIT.

## Run

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Built for the [make.fun](https://make.fun) bounty.
