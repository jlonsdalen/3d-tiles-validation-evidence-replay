#!/usr/bin/env bash
set -euo pipefail

packet_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_root="${packet_root}/witness-lock"
runtime_cache="${runtime_root}/.npm-cache"
libvips_cache="${runtime_cache}/_libvips/libvips-8.14.5-linux-x64.tar.br"
sharp_cache="${runtime_cache}/_prebuilds/dbcc16-sharp-v0.32.6-napi-v7-linux-x64.tar.gz"

download_verified() {
  local url="$1" expected_sha256="$2" target="$3" temporary
  if [[ -f "$target" ]]; then
    printf '%s  %s\n' "$expected_sha256" "$target" | sha256sum --check --status
    printf 'exact_runtime_cache_hit:%s\n' "$(basename "$target")"
    return
  fi
  mkdir -p "$(dirname "$target")"
  temporary="${target}.partial.$$"
  trap 'rm -f "${temporary:-}"' RETURN
  curl --fail --location --silent --show-error \
    --retry 2 --retry-all-errors --retry-delay 2 \
    --connect-timeout 20 --max-time 120 \
    --output "$temporary" "$url"
  printf '%s  %s\n' "$expected_sha256" "$temporary" | sha256sum --check --status
  mv "$temporary" "$target"
  trap - RETURN
  printf 'exact_runtime_cache_filled:%s\n' "$(basename "$target")"
}

node -e '
const major = Number(process.versions.node.split(".")[0]);
if (major !== 22 || process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("V4 exact runtime requires Node 22 on Linux x64");
}
'

download_verified \
  "https://github.com/lovell/sharp-libvips/releases/download/v8.14.5/libvips-8.14.5-linux-x64.tar.br" \
  "11959c03864960f812d861bf7291020540a49fafd2c746b7a3228d9f2bd2200d" \
  "$libvips_cache"
download_verified \
  "https://github.com/lovell/sharp/releases/download/v0.32.6/sharp-v0.32.6-napi-v7-linux-x64.tar.gz" \
  "994679b5089fee0608f94f1b5f6f75a0dcc79a64f3a929d147503e8d0e91dd2f" \
  "$sharp_cache"

npm ci --prefix "${runtime_root}" --cache "${runtime_cache}" --ignore-scripts --engine-strict --no-audit --no-fund

(
  cd "${runtime_root}/node_modules/sharp"
  SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm_config_cache="${runtime_cache}" node install/libvips
  npm_config_cache="${runtime_cache}" node install/dll-copy
  npm_config_cache="${runtime_cache}" ../.bin/prebuild-install
)

node -e '
const path = require("node:path");
const root = process.argv[1];
const validator = require(path.join(root, "node_modules/3d-tiles-validator/package.json"));
const gltf = require(path.join(root, "node_modules/gltf-validator/package.json"));
const sharp = require(path.join(root, "node_modules/sharp"));
if (validator.version !== "0.6.1" || gltf.version !== "2.0.0-dev.3.10" || sharp.versions.sharp !== "0.32.6") {
  throw new Error("exact validator runtime identity mismatch");
}
console.log(JSON.stringify({
  status: "EXACT_FIXTURE_PROFILE_RUNTIME_READY",
  validator: validator.version,
  embedded_gltf_validator: gltf.version,
  sharp: sharp.versions.sharp,
  node: process.version
}));
' "${runtime_root}"
