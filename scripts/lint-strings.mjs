// Flags writing shapes Gid has rejected in interface text and docs.
// Run: node scripts/lint-strings.mjs src/*.js README.md GUIDE.md
import fs from 'fs';

const RULES = [
  [/(^|[.!?]\s+)(That|This|These) (is|are)\b/, 'demonstrative gloss'],
  [/\b(is|are|was|were) not\.?$/, 'split contrast'],
  [/\bnot only\b|\bnot just\b|, not (the|a|an) \w+[.!]?$/i, 'negative parallelism'],
  [/[—–]/, 'em or en dash'],
  [/\b(crucial|vital|pivotal|robust|seamless(ly)?|leverage|delve|underscore|tapestry|testament|showcase|holistic|nuanced|myriad|realm|elevate|vibrant|boasts|nestled)\b/i, 'AI vocabulary'],
  [/\b(simply|merely|truly|actually|essentially|fundamentally|arguably)\b/i, 'filler adverb'],
  [/\b(Think of it as|In other words|The whole point is|At its core|The real question)\b/, 'AI tic'],
  [/, so (nothing|it (still|stays|keeps)|the quality|you (never|don't|won't))/i, 'reassurance clause'],
  [/\bnothing is (cut|lost|uploaded)|loses nothing|never sent anywhere|stays private|leaves your\b/i, 'promise or reassurance'],
  [/[“”‘’]/, 'curly quote'],
];

function jsStrings(src) {
  const out = [];
  const re = /(['`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[2];
    if (s.length < 14 || !/\s/.test(s) || !/[a-z]/.test(s) || /^[.#\w-]+\s*[{:]/.test(s) || /[<>{}=;]|\$\{|https?:/.test(s.replace(/\$\{[^}]*\}/g, ''))) continue;
    if (/^(rgba?|#|M\d|[\d.]+ )/.test(s)) continue;
    out.push({ line: src.slice(0, m.index).split('\n').length, text: s });
  }
  return out;
}

function mdUnits(src) {
  const out = [];
  let inCode = false;
  src.split('\n').forEach((l, i) => {
    if (/^```/.test(l)) inCode = !inCode;
    if (inCode || /^\s*\|/.test(l) || /^ {4}/.test(l)) return;
    for (const s of l.split(/(?<=[.!?])\s+/)) if (s.trim()) out.push({ line: i + 1, text: s.trim() });
  });
  return out;
}

let hits = 0;
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, 'utf8');
  const units = f.endsWith('.md') ? mdUnits(src) : jsStrings(src);
  for (const u of units) {
    for (const [re, name] of RULES) {
      if (re.test(u.text)) {
        hits++;
        console.log(`${f}:${u.line} [${name}] ${u.text.slice(0, 140)}`);
      }
    }
  }
}
console.log(hits ? `${hits} to read` : 'clean');
process.exitCode = hits ? 1 : 0;
