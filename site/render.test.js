'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const render = require('./render');

describe('render.formatFailureCard', () => {
  describe('reference exclusions from a test-ref impl', () => {
    it('renders the full GraphQL response using the json-diff widget', () => {
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        response: {
          data: null,
          errors: [
            {
              message: 'Argument "@defer(label:)" must be a static string.',
              locations: [{ line: 12, column: 17 }],
            },
          ],
        },
      };

      const html = render.formatFailureCard(exclusion, { expanded: true });

      assert.ok(html.includes('json-diff-single'), 'should use single-column json-diff widget');
      assert.ok(html.includes('json-diff-header'), 'should include a diff-style header');
      assert.ok(html.includes('Response'), 'should label the block as Response');
      assert.ok(
        html.includes('Argument \\"@defer(label:)\\" must be a static string.'),
        'message text should appear inside the JSON (quote-escaped)',
      );
      assert.ok(html.includes('"line"'), 'should include location keys');
      assert.ok(html.includes('"data"'), 'should include the data field');
      assert.ok(html.includes('null'), 'should include null data literal');
    });

    it('synthesizes {data:null, errors:[...]} for legacy records that only have errors', () => {
      const legacy = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        errors: [{ message: 'boom', path: ['foo', 0, 'bar'] }],
      };

      const html = render.formatFailureCard(legacy, { expanded: true });
      assert.ok(html.includes('json-diff-single'));
      assert.ok(html.includes('"data"'), 'synthesized data: null should be present');
      assert.ok(html.includes('"errors"'), 'errors array should be rendered');
      assert.ok(html.includes('"foo"'));
      assert.ok(html.includes('"bar"'));
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

    it('marks exclusions with a long response as expandable', () => {
      const response = {
        data: null,
        errors: Array.from({ length: 8 }, (_unused, i) => ({ message: `error ${i}` })),
      };
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        response,
      };

      assert.equal(render.canExpandFailure(exclusion), true);

      const collapsedHtml = render.formatFailureCard(exclusion, { expanded: false });
      assert.ok(collapsedHtml.includes('data-expandable="true"'));
      assert.ok(!collapsedHtml.includes('error 7'), 'last error hidden when collapsed');

      const expandedHtml = render.formatFailureCard(exclusion, { expanded: true });
      assert.ok(expandedHtml.includes('error 7'), 'last error visible when expanded');
    });

    it('escapes HTML in response content', () => {
      const exclusion = {
        testKey: 'aaaa/bbbb/cccc',
        error: 'reference returned errors',
        response: {
          data: null,
          errors: [{ message: '<script>alert(1)</script>', path: ['<evil>'] }],
        },
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
