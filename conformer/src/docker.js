'use strict';

const fs = require('fs');
const path = require('path');
const Docker = require('dockerode');

let sharedDocker = null;
function getDocker() {
  if (!sharedDocker) {
    sharedDocker = new Docker();
  }
  return sharedDocker;
}

function listContext(contextDir) {
  const results = [];
  const ignore = new Set(['node_modules', 'build', '.git']);
  (function walk(rel) {
    const abs = path.join(contextDir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue;
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile()) {
        results.push(childRel);
      }
    }
  })('');
  return results;
}

async function buildImage({ contextDir, dockerfile = 'Dockerfile', tag, buildArgs, onProgress }) {
  const docker = getDocker();
  const contextPath = path.resolve(contextDir);
  if (!fs.existsSync(path.join(contextPath, dockerfile))) {
    throw new Error(`Dockerfile not found: ${path.join(contextPath, dockerfile)}`);
  }

  const src = listContext(contextPath);
  const stream = await docker.buildImage(
    { context: contextPath, src },
    { t: tag, dockerfile, buildargs: buildArgs },
  );

  return new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err, output) => {
        if (err) return reject(err);
        const last = output[output.length - 1];
        if (last && last.errorDetail) {
          return reject(new Error(last.errorDetail.message || 'docker build failed'));
        }
        resolve({ tag, output });
      },
      (event) => {
        if (onProgress) onProgress(event);
      },
    );
  });
}

async function inspectImage(tag) {
  const docker = getDocker();
  try {
    return await docker.getImage(tag).inspect();
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function pullImage({ ref, onProgress }) {
  const docker = getDocker();
  const stream = await docker.pull(ref);
  return new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err, output) => (err ? reject(err) : resolve(output)),
      (event) => { if (onProgress) onProgress(event); },
    );
  });
}

async function runContainer({ image, name, hostPort, containerPort, env, labels }) {
  const docker = getDocker();
  const exposed = `${containerPort}/tcp`;
  const container = await docker.createContainer({
    Image: image,
    name,
    Env: Object.entries(env || {}).map(([k, v]) => `${k}=${v}`),
    Labels: labels,
    ExposedPorts: { [exposed]: {} },
    HostConfig: {
      PortBindings: { [exposed]: [{ HostPort: String(hostPort ?? 0) }] },
      AutoRemove: false,
    },
  });

  await container.start();
  const info = await container.inspect();
  const binding = info.NetworkSettings.Ports[exposed];
  const mappedPort = binding && binding[0] ? Number(binding[0].HostPort) : null;
  if (!mappedPort) {
    throw new Error(`could not determine host port binding for ${name}`);
  }

  return { container, hostPort: mappedPort, inspect: info };
}

async function stopContainer(container, { removeOnStop = true, timeout = 10 } = {}) {
  try {
    await container.stop({ t: timeout });
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err;
  }
  if (removeOnStop) {
    try {
      await container.remove({ force: true });
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
  }
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

async function getContainerLogs(container, { tail = 200 } = {}) {
  const stream = await container.logs({
    stdout: true,
    stderr: true,
    tail,
    follow: false,
  });
  if (Buffer.isBuffer(stream)) return stream.toString('utf8');
  return collectStream(stream);
}

module.exports = {
  getDocker,
  buildImage,
  inspectImage,
  pullImage,
  runContainer,
  stopContainer,
  getContainerLogs,
};
