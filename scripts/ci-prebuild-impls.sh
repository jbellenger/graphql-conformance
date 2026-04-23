#!/usr/bin/env bash
#
# Pre-build all in-tree impl images using buildx with per-impl GHA cache scopes.
# Intended to run on a GitHub Actions runner (or any host with buildx + the GHA
# cache env vars `ACTIONS_RUNTIME_TOKEN` / `ACTIONS_CACHE_URL` present).
#
# Each image is loaded into the local docker daemon tagged `conformer/<name>:dev`
# so that the conformer can skip rebuilding when `CONFORMER_USE_EXISTING_IMAGE=1`.

set -euo pipefail

REGISTRY_JSON="${REGISTRY_JSON:-registry.json}"
CONCURRENCY="${IMPL_PREBUILD_CONCURRENCY:-4}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "error: docker buildx is required" >&2
  exit 1
fi

if [[ -n "${ACTIONS_RUNTIME_TOKEN:-}" && -n "${ACTIONS_CACHE_URL:-${ACTIONS_RESULTS_URL:-}}" ]]; then
  USE_GHA_CACHE=1
else
  USE_GHA_CACHE=0
  echo "note: ACTIONS_RUNTIME_TOKEN/ACTIONS_CACHE_URL not set; building without GHA cache" >&2
fi

build_one() {
  local driver="$1"
  local manifest impl_dir context_dir dockerfile_rel
  manifest="$(jq -r --arg n "$driver" '.drivers[] | select(.name==$n) | .manifestPath' "$REGISTRY_JSON")"
  if [[ -z "$manifest" || "$manifest" == "null" ]]; then
    echo "error: no manifest for driver $driver" >&2
    return 1
  fi
  impl_dir="$(dirname "$manifest")"
  context_dir="$impl_dir/$(jq -r '.image.build.context // "."' "$manifest")"
  dockerfile_rel="$(jq -r '.image.build.dockerfile // "Dockerfile"' "$manifest")"

  echo "::group::pre-build $driver"
  if (( USE_GHA_CACHE )); then
    docker buildx build \
      --load \
      --cache-from "type=gha,scope=impl-$driver" \
      --cache-to "type=gha,mode=max,scope=impl-$driver" \
      --file "$context_dir/$dockerfile_rel" \
      --tag "conformer/$driver:dev" \
      "$context_dir"
  else
    docker buildx build \
      --load \
      --file "$context_dir/$dockerfile_rel" \
      --tag "conformer/$driver:dev" \
      "$context_dir"
  fi
  echo "::endgroup::"
}

DRIVERS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && DRIVERS+=("$line")
done < <(jq -r '.drivers[].name' "$REGISTRY_JSON")

if (( ${#DRIVERS[@]} == 0 )); then
  echo "no drivers in $REGISTRY_JSON" >&2
  exit 1
fi

echo "Pre-building ${#DRIVERS[@]} impl image(s) (concurrency=$CONCURRENCY)"

pids=()
fail=0

wait_for_any() {
  local i pid
  while :; do
    for i in "${!pids[@]}"; do
      pid="${pids[i]}"
      if ! kill -0 "$pid" 2>/dev/null; then
        if ! wait "$pid"; then fail=1; fi
        unset 'pids[i]'
        pids=("${pids[@]}")
        return
      fi
    done
    sleep 0.2
  done
}

for driver in "${DRIVERS[@]}"; do
  build_one "$driver" &
  pids+=("$!")
  if (( ${#pids[@]} >= CONCURRENCY )); then
    wait_for_any
  fi
done
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then fail=1; fi
done

exit "$fail"
