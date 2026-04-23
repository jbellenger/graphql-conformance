'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const render = require('./render');

describe('render.formatFailureCard', () => {
  describe('reference exclusions from a test-ref impl', () => {
    it('renders the GraphQL error message for a validation-style exclusion', () => {
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        errors: [
          {
            message: 'Argument "@defer(label:)" must be a static string.',
            locations: [{ line: 12, column: 17 }],
          },
        ],
      };

      const html = render.formatFailureCard(exclusion, { expanded: false });

      assert.ok(
        html.includes('Argument "@defer(label:)" must be a static string.'),
        'should include the error message',
      );
      assert.ok(html.includes('12:17'), 'should include error locations');
      assert.ok(html.includes('GraphQL errors'), 'should label the errors block');
    });

    it('renders multiple errors and each error path', () => {
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        errors: [
          { message: 'boom 1', path: ['foo', 0, 'bar'] },
          { message: 'boom 2', path: ['baz'] },
        ],
      };

      const html = render.formatFailureCard(exclusion, { expanded: true });

      assert.ok(html.includes('boom 1'), 'should include first error');
      assert.ok(html.includes('boom 2'), 'should include second error');
      assert.ok(html.includes('foo.0.bar'), 'should include first path');
      assert.ok(html.includes('baz'), 'should include second path');
    });

    it('renders harness-failure exclusions with stderr content', () => {
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'driver returned status 500',
        stderr: 'panic: runtime error\nline 2\nline 3\nline 4',
      };

      const html = render.formatFailureCard(exclusion, { expanded: true });

      assert.ok(html.includes('stderr'), 'should label stderr block');
      assert.ok(html.includes('panic: runtime error'), 'should include stderr content');
      assert.ok(html.includes('line 4'), 'should include all stderr lines when expanded');
    });

    it('marks exclusions with many errors as expandable', () => {
      const manyErrors = Array.from({ length: 8 }, (_unused, i) => ({ message: `error ${i}` }));
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        errors: manyErrors,
      };

      assert.equal(render.canExpandFailure(exclusion), true);

      const collapsedHtml = render.formatFailureCard(exclusion, { expanded: false });
      assert.ok(collapsedHtml.includes('data-expandable="true"'));
      assert.ok(collapsedHtml.includes('error 0'));
      assert.ok(!collapsedHtml.includes('error 7'), 'last error is hidden when collapsed');

      const expandedHtml = render.formatFailureCard(exclusion, { expanded: true });
      assert.ok(expandedHtml.includes('error 7'), 'last error visible when expanded');
    });

    it('escapes HTML in error messages and path segments', () => {
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        errors: [
          { message: '<script>alert(1)</script>', path: ['<evil>'] },
        ],
      };

      const html = render.formatFailureCard(exclusion, { expanded: true });

      assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not leak');
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(html.includes('&lt;evil&gt;'));
    });
  });

  describe('baseline behavior (no regressions)', () => {
    it('renders a diff for failures with expected/actual', () => {
      const failure = {
        testKey: 'aaaa/bbbb/cccc',
        expected: { data: { hello: 'world' } },
        actual: { data: { hello: 'worlds' } },
      };
      const html = render.formatFailureCard(failure, { expanded: false });
      assert.ok(html.includes('json-diff'));
      assert.ok(html.includes('Expected'));
      assert.ok(html.includes('Actual'));
    });

    it('renders summary from failure.error when present', () => {
      const failure = { testKey: 'a/b/c', error: 'something blew up' };
      const html = render.formatFailureCard(failure, { expanded: false });
      assert.ok(html.includes('something blew up'));
    });
  });
});
