const { rewriteRootAbsolutePaths } = require('./fix-web-export-paths');

describe('rewriteRootAbsolutePaths', () => {
  test('rewrites a root-absolute script src to relative', () => {
    const { after, count } = rewriteRootAbsolutePaths(
      '<script src="/_expo/static/js/web/AppEntry-abc123.js" defer></script>'
    );
    expect(after).toBe('<script src="./_expo/static/js/web/AppEntry-abc123.js" defer></script>');
    expect(count).toBe(1);
  });

  test('rewrites a root-absolute asset path inside single quotes, as the minified bundle uses', () => {
    const { after, count } = rewriteRootAbsolutePaths(
      "e.exports='/assets/skins/lalas-kitchen/sprites/tomato.abc123.webp'"
    );
    expect(after).toBe("e.exports='./assets/skins/lalas-kitchen/sprites/tomato.abc123.webp'");
    expect(count).toBe(1);
  });

  test('rewrites every occurrence across a multi-path source, counting each one', () => {
    const { after, count } = rewriteRootAbsolutePaths('a="/one.js" b="/two.js" c="/three.js"');
    expect(after).toBe('a="./one.js" b="./two.js" c="./three.js"');
    expect(count).toBe(3);
  });

  test('does not touch react-native-web\'s hydration marker ("/$")', () => {
    const source = 'if(t==="/$"){hydrate()}';
    const { after, count } = rewriteRootAbsolutePaths(source);
    expect(after).toBe(source);
    expect(count).toBe(0);
  });

  test('does not touch a bundled comment-formatter\'s block-comment marker ("/*")', () => {
    const source = 'const BLOCK_COMMENT_START = "/*";';
    const { after, count } = rewriteRootAbsolutePaths(source);
    expect(after).toBe(source);
    expect(count).toBe(0);
  });

  test('leaves an already-relative path untouched', () => {
    const source = '<script src="./_expo/static/js/web/AppEntry-abc123.js"></script>';
    const { after, count } = rewriteRootAbsolutePaths(source);
    expect(after).toBe(source);
    expect(count).toBe(0);
  });

  test('leaves a non-root absolute URL untouched (protocol-relative or full origin)', () => {
    const source = 'fetch("https://example.com/api"); fetch("//example.com/api")';
    const { after, count } = rewriteRootAbsolutePaths(source);
    expect(after).toBe(source);
    expect(count).toBe(0);
  });

  test('reports zero rewrites for a source with no root-absolute paths', () => {
    const { after, count } = rewriteRootAbsolutePaths('const x = 1;');
    expect(after).toBe('const x = 1;');
    expect(count).toBe(0);
  });
});
