// Strip a leading UTF-8 byte-order mark (U+FEFF) from a decoded string.
//
// Why this exists: a lot of Windows tooling — PowerShell `Out-File`/`>`,
// Notepad, and several editors — prepends a BOM when saving UTF-8. `JSON.parse`
// throws on a BOM-prefixed string ("Unexpected token ﻿"), so a dump or
// transcript authored on Windows would otherwise be silently dropped (a merged
// dump skipped as "not valid JSON", a transcript's first line lost). Node's
// `fs.readFile(..., 'utf8')` does NOT strip the BOM for us, so we do it here at
// every external-file parse boundary.
export function stripBom(str) {
  if (typeof str === 'string' && str.charCodeAt(0) === 0xfeff) {
    return str.slice(1);
  }
  return str;
}
