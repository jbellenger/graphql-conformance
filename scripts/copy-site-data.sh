#!/usr/bin/env bash
# Stages runtime data and the corpus alongside the built site so the dashboard
# can serve results and per-test-case schema/query/variables as static assets.
# Used by both the local `_build-site` Makefile target and the GitHub Pages
# deploy workflow. Keeping the copy logic in one place prevents the two entry
# points from drifting (e.g. the Pages workflow previously forgot the corpus
# copy, which broke the Test Input section on the production site).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"
dist_data="$root_dir/site/dist/data"

mkdir -p "$dist_data"

if [ -d "$root_dir/results/data" ] && [ -n "$(ls -A "$root_dir/results/data" 2>/dev/null)" ]; then
  cp -R "$root_dir/results/data/." "$dist_data/"
fi

if [ -d "$root_dir/corpus" ] && [ -n "$(ls -A "$root_dir/corpus" 2>/dev/null)" ]; then
  rm -rf "$dist_data/corpus"
  cp -R "$root_dir/corpus" "$dist_data/corpus"
fi
