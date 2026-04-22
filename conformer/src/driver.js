'use strict';

const fs = require('fs');
const path = require('path');
const docker = require('./docker');
const { buildRequestBody, executeHttp, checkHealth } = require('./execute');

const DEFAULT_RUNTIME = {
  port: 8080,
  healthPath: '/health',
  executePath: '/execute',
  readinessTimeoutMs: 30_000,
  requestTimeoutMs: 30_000,
};

function readManifest(implDir) {
  const manifestPath = path.join(implDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.runtime) parsed.runtime = {};
  parsed.runtime = { ...DEFAULT_RUNTIME, ...parsed.runtime };
  return parsed;
}

function containerNameFor(name, runId) {
  return `conformer-${name}-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function resolveDriverHost() {
  if (process.env.DRIVER_HOST) return process.env.DRIVER_HOST;
  if (fs.existsSync('/.dockerenv')) return 'host.docker.internal';
  return '127.0.0.1';
}

class DockerDriver {
  constructor({ name, implDir, manifest, runId }) {
    this.name = name;
    this.implDir = implDir;
    this.manifest = manifest;
    this.runId = runId;
    this.container = null;
    this.host = resolveDriverHost();
    this.hostPort = null;
    this.imageTag = null;
    this.imageDigest = null;
    this.libraryVersion = null;
  }

  async ensureImage({ onProgress } = {}) {
    const { image } = this.manifest;
    if (image && image.repository) {
      const ref = `${image.repository}:${image.tag || 'latest'}`;
      const existing = await docker.inspectImage(ref);
      if (!existing) {
        await docker.pullImage({ ref, onProgress });
      }
      this.imageTag = ref;
    } else if (image && image.build) {
      const tag = `conformer/${this.name}:dev`;
      const useExisting = Boolean(process.env.CONFORMER_USE_EXISTING_IMAGE)
        && process.env.CONFORMER_USE_EXISTING_IMAGE !== '0'
        && process.env.CONFORMER_USE_EXISTING_IMAGE !== 'false';
      const preExisting = useExisting ? await docker.inspectImage(tag) : null;
      if (!preExisting) {
        await docker.buildImage({
          contextDir: path.resolve(this.implDir, image.build.context || '.'),
          dockerfile: image.build.dockerfile || 'Dockerfile',
          tag,
          buildArgs: image.build.args,
          onProgress,
        });
      }
      this.imageTag = tag;
    } else {
      throw new Error(`driver ${this.name}: manifest has neither image.repository nor image.build`);
    }

    const info = await docker.inspectImage(this.imageTag);
    this.imageDigest = info && info.Id ? info.Id : null;
    this.libraryVersion = await docker.readImageFile(this.imageTag, '/impl-version').catch(() => null);
    return { tag: this.imageTag, digest: this.imageDigest, version: this.libraryVersion };
  }

  async start() {
    const { runtime } = this.manifest;
    const name = containerNameFor(this.name, this.runId);
    const { container, hostPort } = await docker.runContainer({
      image: this.imageTag,
      name,
      containerPort: runtime.port,
      env: runtime.env,
      labels: { 'graphql-conformance.driver': this.name, 'graphql-conformance.run-id': this.runId },
    });
    this.container = container;
    this.hostPort = hostPort;
    await this.awaitReady();
  }

  async awaitReady() {
    const { runtime } = this.manifest;
    const deadline = Date.now() + runtime.readinessTimeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      const ok = await checkHealth({
        host: this.host,
        port: this.hostPort,
        path: runtime.healthPath,
        timeoutMs: 2000,
      });
      if (ok) return;
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(500, 50 * attempt)));
    }
    const logs = this.container ? await docker.getContainerLogs(this.container).catch(() => '') : '';
    throw new Error(`driver ${this.name}: health check timed out after ${runtime.readinessTimeoutMs}ms\nlogs:\n${logs}`);
  }

  async execute(test) {
    const { runtime } = this.manifest;
    const body = buildRequestBody(test);
    return executeHttp({
      host: this.host,
      port: this.hostPort,
      path: runtime.executePath,
      body,
      timeoutMs: runtime.requestTimeoutMs,
    });
  }

  async stop() {
    if (this.container) {
      await docker.stopContainer(this.container, { removeOnStop: true });
      this.container = null;
    }
  }
}

module.exports = {
  DEFAULT_RUNTIME,
  readManifest,
  DockerDriver,
  containerNameFor,
  resolveDriverHost,
};
