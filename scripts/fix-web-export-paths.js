#!/usr/bin/env node
// Rewrites root-absolute paths (a quote immediately followed by a leading
// "/") to relative ones ("./") across the web export in dist/, so the export
// loads correctly when served from a subpath instead of a domain root (e.g.
// CrazyGames, which mounts each game under its own folder).
//
// Matches by context — a quote followed by a path-shaped character — rather
// than by hardcoded folder names, so it doesn't need updating if Expo's
// asset layout changes. That same rule is why it's safe: react-native-web's
// hydration marker string "/$" and a bundled comment-formatter's "/*" both
// have a non-word character right after the slash, so neither one matches
// and neither gets rewritten.
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const LEADING_SLASH = /(["'])\/(\w)/g;

// Pure string rewrite, split out from rewriteFile's disk I/O so
// fix-web-export-paths.test.js can exercise the regex directly against
// fixture strings (real minified bundle snippets, the hydration marker, the
// comment-formatter marker) without needing a real dist/ export on disk.
function rewriteRootAbsolutePaths(source) {
  let count = 0;
  const after = source.replace(LEADING_SLASH, (match, quote, nextChar) => {
    count++;
    return `${quote}./${nextChar}`;
  });
  return { after, count };
}

function rewriteFile(filePath) {
  const before = fs.readFileSync(filePath, 'utf8');
  const { after, count } = rewriteRootAbsolutePaths(before);
  if (count > 0) {
    fs.writeFileSync(filePath, after);
  }
  return count;
}

function findJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`fix-web-export-paths: no dist/ directory found at ${DIST_DIR} — run "expo export -p web" first.`);
    process.exit(1);
  }

  let total = 0;
  let filesChecked = 0;

  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    filesChecked++;
    const count = rewriteFile(indexHtmlPath);
    total += count;
    console.log(`fix-web-export-paths: rewrote ${count} path(s) in index.html`);
  }

  for (const file of findJsFiles(DIST_DIR)) {
    filesChecked++;
    const count = rewriteFile(file);
    total += count;
    if (count > 0) {
      console.log(`fix-web-export-paths: rewrote ${count} path(s) in ${path.relative(DIST_DIR, file)}`);
    }
  }

  console.log(`fix-web-export-paths: done — ${total} root-absolute path(s) rewritten to relative across ${filesChecked} file(s) checked.`);
}

module.exports = { rewriteRootAbsolutePaths, LEADING_SLASH };

// Only run against a real dist/ when invoked directly (npm run export:web) —
// requiring this module from a test must not touch the filesystem.
if (require.main === module) {
  main();
}
