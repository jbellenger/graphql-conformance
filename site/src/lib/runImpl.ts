import type { Impl, Run } from '../repository/types';

export function implForRun(impl: Impl, run: Run): Impl {
  const meta = run._conformerMeta?.implMeta?.[impl.id];
  if (!meta || !('version' in meta)) return impl;

  const version = meta.version ?? undefined;
  return {
    ...impl,
    version,
    versionUrl: version ? versionUrlForRunVersion(impl, version, meta.versionUrl) : undefined,
  };
}

function versionUrlForRunVersion(
  impl: Impl,
  version: string,
  recordedVersionUrl?: string | null,
): string | undefined {
  if (recordedVersionUrl) return recordedVersionUrl;
  if (impl.versionUrlTemplate) {
    return impl.versionUrlTemplate.replace(/\{version\}/g, encodeURIComponent(version));
  }
  if (!impl.versionUrl) return undefined;
  if (!impl.version || impl.version === version) return impl.versionUrl;

  const currentEncoded = encodeURIComponent(impl.version);
  if (impl.versionUrl.includes(currentEncoded)) {
    return impl.versionUrl.replaceAll(currentEncoded, encodeURIComponent(version));
  }

  if (impl.versionUrl.includes(impl.version)) {
    return impl.versionUrl.replaceAll(impl.version, encodeURIComponent(version));
  }

  return undefined;
}
