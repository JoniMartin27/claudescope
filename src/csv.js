// RFC 4180 CSV serializer with no runtime dependencies, plus CSV-injection
// neutralization (CWE-1236 / OWASP "Formula Injection").
//
// Two concerns, kept separate:
//
//  1. RFC 4180 quoting — a field is wrapped in double quotes when it contains a
//     double quote, a comma, a CR, or an LF; inner double quotes are doubled
//     ("" ). Records are joined with CRLF. The whole document may be prefixed
//     with a UTF-8 BOM so Excel opens it as UTF-8 (otherwise it mojibakes
//     accented project paths).
//
//  2. Anti-injection — spreadsheets (Excel, LibreOffice, Sheets) treat a cell
//     whose text begins with one of = + - @ TAB(0x09) CR(0x0D) as a FORMULA.
//     A malicious transcript-derived string like `=cmd|...` could then execute
//     when the audit CSV is opened. We neutralize STRING fields by prefixing a
//     single quote ('), which forces the cell to render as literal text.
//     NUMBERS are never prefixed — only strings — so the numeric columns stay
//     machine-parseable.
//
// This module is the single source of truth for both the `--csv` export and the
// CSV whose sha256 the audit `--report` embeds for integrity, so the hashed
// bytes and the exported bytes are guaranteed identical.

export const BOM = '﻿';

// Characters that, as the FIRST char of a cell, make a spreadsheet treat the
// cell as a formula. Tab and CR are included per OWASP guidance (they can be
// used to smuggle a leading formula trigger past naive checks).
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralize a single STRING field against CSV/formula injection by prefixing a
 * literal apostrophe when it starts with a formula trigger. No-op for strings
 * that don't start with a trigger. Exported for direct testing.
 * @param {string} s
 * @returns {string}
 */
export function neutralize(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return FORMULA_TRIGGERS.has(s[0]) ? "'" + s : s;
}

/**
 * RFC 4180 quote a single already-stringified field. Wraps in double quotes and
 * doubles inner quotes only when the field contains " , CR or LF.
 * @param {string} s
 * @returns {string}
 */
function quoteField(s) {
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Render one field. Numbers (and booleans) are stringified as-is and NEVER get
 * the anti-injection prefix — only strings do. null/undefined become empty.
 * The result is then RFC 4180 quoted.
 * @param {*} v
 * @returns {string}
 */
export function formatField(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    // NaN/Infinity aren't valid CSV numbers; emit empty rather than "NaN".
    return Number.isFinite(v) ? quoteField(String(v)) : '';
  }
  if (typeof v === 'boolean') return quoteField(String(v));
  return quoteField(neutralize(String(v)));
}

/**
 * Serialize an array-of-arrays (or a {header, rows} pair) to an RFC 4180 CSV
 * string. Records joined with CRLF; trailing CRLF included so the file ends on
 * a record boundary.
 *
 * @param {Array<Array<*>>} rows  rows (each an array of cells). The first row is
 *                                typically the header.
 * @param {object} [opts] { bom?: boolean } — prepend a UTF-8 BOM (default false;
 *                        the CLI file/stdout export turns it on).
 * @returns {string}
 */
export function toCsv(rows, opts = {}) {
  const body = (rows || [])
    .map((row) => (row || []).map(formatField).join(','))
    .join('\r\n');
  const doc = rows && rows.length ? body + '\r\n' : '';
  return opts.bom ? BOM + doc : doc;
}
