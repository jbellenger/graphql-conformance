import { describe, expect, it, vi } from 'vitest';
import {
  corpusPathsForTestCase,
  loadCorpusArtifacts,
} from './corpusArtifacts';

function makeFetch(map: Record<string, string | number>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = Object.keys(map).find((k) => url.endsWith(k));
    if (!key) {
      return new Response(`no fixture for ${url}`, {
        status: 500,
        statusText: 'no fixture',
      });
    }
    const value = map[key];
    if (typeof value === 'number') {
      return new Response('nope', { status: value, statusText: 'http error' });
    }
    return new Response(value, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }) as unknown as typeof fetch;
}

describe('corpusPathsForTestCase', () => {
  it('derives schema+query+variables paths from a 3-part test case id', () => {
    const paths = corpusPathsForTestCase('aa/bb/cc');
    expect(paths).toEqual({
      schemaPath: 'corpus/aa/schema.graphqls',
      queryPath: 'corpus/aa/bb/query.graphql',
      variablesPath: 'corpus/aa/bb/cc/variables.json',
    });
  });

  it('returns null variables path when the test case has no variables id', () => {
    const paths = corpusPathsForTestCase('aa/bb');
    expect(paths).toEqual({
      schemaPath: 'corpus/aa/schema.graphqls',
      queryPath: 'corpus/aa/bb/query.graphql',
      variablesPath: null,
    });
  });

  it('returns null for malformed ids', () => {
    expect(corpusPathsForTestCase('just-one')).toBeNull();
    expect(corpusPathsForTestCase('')).toBeNull();
  });
});

describe('loadCorpusArtifacts', () => {
  it('fetches schema, query, and variables text in parallel', async () => {
    const fetchImpl = makeFetch({
      '/corpus/aa/schema.graphqls': 'type Query { x: Int }',
      '/corpus/aa/bb/query.graphql': '{ x }',
      '/corpus/aa/bb/cc/variables.json': '{"v":1}',
    });
    const result = await loadCorpusArtifacts('aa/bb/cc', '/data/', fetchImpl);
    expect(result?.schema.text).toBe('type Query { x: Int }');
    expect(result?.schema.path).toBe('corpus/aa/schema.graphqls');
    expect(result?.schema.blobUrl).toMatch(
      /\/blob\/master\/corpus\/aa\/schema\.graphqls$/,
    );
    expect(result?.query.text).toBe('{ x }');
    expect(result?.variables?.text).toBe('{"v":1}');
  });

  it('returns null variables when the test case has none', async () => {
    const fetchImpl = makeFetch({
      '/corpus/aa/schema.graphqls': 'schema',
      '/corpus/aa/bb/query.graphql': 'query',
    });
    const result = await loadCorpusArtifacts('aa/bb', '/data/', fetchImpl);
    expect(result?.variables).toBeNull();
  });

  it('returns null for a malformed test case id without calling fetch', async () => {
    const fetchImpl = makeFetch({});
    const result = await loadCorpusArtifacts('', '/data/', fetchImpl);
    expect(result).toBeNull();
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls)
      .toHaveLength(0);
  });

  it('prepends the data base URL when fetching each artifact', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      seen.push(url);
      return new Response('x', { status: 200 });
    }) as unknown as typeof fetch;
    await loadCorpusArtifacts('aa/bb/cc', '/base/data/', fetchImpl);
    expect(seen).toEqual([
      '/base/data/corpus/aa/schema.graphqls',
      '/base/data/corpus/aa/bb/query.graphql',
      '/base/data/corpus/aa/bb/cc/variables.json',
    ]);
  });

  it('throws a descriptive error when a fetch fails', async () => {
    const fetchImpl = makeFetch({
      '/corpus/aa/schema.graphqls': 404,
      '/corpus/aa/bb/query.graphql': 'query',
    });
    await expect(
      loadCorpusArtifacts('aa/bb', '/data/', fetchImpl),
    ).rejects.toThrow(/corpus\/aa\/schema\.graphqls.*404/);
  });
});
