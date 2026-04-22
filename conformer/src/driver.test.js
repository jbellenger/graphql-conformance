'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const docker = require('./docker');
const { DockerDriver } = require('./driver');

function makeDriver() {
  return new DockerDriver({
    name: 'fake',
    implDir: '/tmp/fake-impl',
    manifest: {
      image: { build: { dockerfile: 'Dockerfile', context: '.' } },
      runtime: { port: 8080, healthPath: '/health', executePath: '/execute' },
    },
    runId: 'test-run',
  });
}

describe('DockerDriver.ensureImage — skip-if-present', () => {
  let prevEnv;
  let buildCalls;
  let inspectCalls;

  beforeEach(() => {
    prevEnv = process.env.CONFORMER_USE_EXISTING_IMAGE;
    buildCalls = 0;
    inspectCalls = 0;
    mock.method(docker, 'buildImage', async () => { buildCalls += 1; });
    mock.method(docker, 'inspectImage', async () => {
      inspectCalls += 1;
      return { Id: 'sha256:preexisting' };
    });
    mock.method(docker, 'readImageFile', async () => null);
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CONFORMER_USE_EXISTING_IMAGE;
    else process.env.CONFORMER_USE_EXISTING_IMAGE = prevEnv;
    mock.restoreAll();
  });

  it('skips building when env var is set AND image already exists', async () => {
    process.env.CONFORMER_USE_EXISTING_IMAGE = '1';
    const driver = makeDriver();
    await driver.ensureImage();
    assert.equal(buildCalls, 0, 'build must not run when existing image is reused');
    assert.equal(driver.imageTag, 'conformer/fake:dev');
    assert.equal(driver.imageDigest, 'sha256:preexisting');
  });

  it('builds when env var is unset, even if image exists', async () => {
    delete process.env.CONFORMER_USE_EXISTING_IMAGE;
    const driver = makeDriver();
    await driver.ensureImage();
    assert.equal(buildCalls, 1, 'build must run when env var is unset');
  });

  it('treats "0" and "false" as disabled', async () => {
    for (const val of ['0', 'false']) {
      buildCalls = 0;
      process.env.CONFORMER_USE_EXISTING_IMAGE = val;
      const driver = makeDriver();
      await driver.ensureImage();
      assert.equal(buildCalls, 1, `build must run when env is "${val}"`);
    }
  });

  it('builds when env var is set but image is absent', async () => {
    process.env.CONFORMER_USE_EXISTING_IMAGE = '1';
    mock.restoreAll();
    let firstInspect = true;
    mock.method(docker, 'buildImage', async () => { buildCalls += 1; });
    mock.method(docker, 'inspectImage', async () => {
      if (firstInspect) {
        firstInspect = false;
        return null;
      }
      return { Id: 'sha256:built' };
    });
    mock.method(docker, 'readImageFile', async () => null);

    const driver = makeDriver();
    await driver.ensureImage();
    assert.equal(buildCalls, 1, 'must fall through to build when image is absent');
    assert.equal(driver.imageDigest, 'sha256:built');
  });
});
