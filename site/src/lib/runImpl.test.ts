import { describe, expect, it } from 'vitest';
import type { Impl, Run } from '../repository/types';
import { implForRun } from './runImpl';
import { implRunResults } from '../repository/FakeRepository';

const run: Run = {
  id: 'run-old',
  timestamp: '2026-05-11T14:31:28.571Z',
  referenceImplId: 'graphql-js-17',
  implIds: ['graphql-js-17'],
  excluded: 0,
  resultsByImpl: {
    'graphql-js-17': implRunResults('graphql-js-17', { total: 1, passed: 1 }),
  },
  _conformerMeta: {
    implMeta: {
      'graphql-js-17': {
        imageDigest: 'sha256:old',
        version: '17.0.0-alpha.14',
      },
    },
  },
};

describe('implForRun', () => {
  it('overrides the current impl version with run-scoped metadata', () => {
    const impl: Impl = {
      id: 'graphql-js-17',
      name: 'graphql-js-17',
      language: 'JavaScript',
      version: '17.0.0-beta.1',
      versionUrl:
        'https://github.com/graphql/graphql-js/releases/tag/v17.0.0-beta.1',
    };

    expect(implForRun(impl, run)).toMatchObject({
      version: '17.0.0-alpha.14',
      versionUrl:
        'https://github.com/graphql/graphql-js/releases/tag/v17.0.0-alpha.14',
    });
  });

  it('uses a version URL template when available', () => {
    const impl: Impl = {
      id: 'graphql-js-17',
      name: 'graphql-js-17',
      language: 'JavaScript',
      version: '17.0.0-beta.1',
      versionUrlTemplate: 'https://example.test/pkg/{version}',
    };

    expect(implForRun(impl, run).versionUrl).toBe(
      'https://example.test/pkg/17.0.0-alpha.14',
    );
  });

  it('uses an explicitly recorded run version URL before deriving one', () => {
    const impl: Impl = {
      id: 'graphql-js-17',
      name: 'graphql-js-17',
      language: 'JavaScript',
      version: '17.0.0-beta.1',
      versionUrlTemplate: 'https://example.test/pkg/{version}',
    };
    const withUrl: Run = {
      ...run,
      _conformerMeta: {
        implMeta: {
          'graphql-js-17': {
            version: '17.0.0-alpha.14',
            versionUrl: 'https://recorded.test/alpha',
          },
        },
      },
    };

    expect(implForRun(impl, withUrl).versionUrl).toBe(
      'https://recorded.test/alpha',
    );
  });

  it('falls back to current impl data when a run has no metadata', () => {
    const impl: Impl = {
      id: 'graphql-js-17',
      name: 'graphql-js-17',
      language: 'JavaScript',
      version: '17.0.0-beta.1',
    };
    const noMeta = { ...run, _conformerMeta: undefined };

    expect(implForRun(impl, noMeta)).toBe(impl);
  });
});
