#!/usr/bin/env bash
#
# Regenerate the document .icns set from the canonical brand sources under
# branding/document-icons/. Runs automatically before the mac packaging
# steps (npm run dist / dist:mac / dist:all); safe to run by hand too.
#
# Mac-only: depends on Apple's `sips` and `iconutil`, both shipped in
# every macOS install. Use this rather than relying on electron-builder's
# PNG-to-icns conversion for FILE ASSOCIATIONS - it converts the app icon
# fine, but for fileAssociations it leaves the PNG path verbatim in the
# Info.plist CFBundleTypeIconFile, which macOS can't render (you get plain
# white document icons). Baking the .icns ourselves and pointing the
# fileAssociations entries at it side-steps that.
#
# Sources are the SQUARE masters under branding/document-icons/square/ -
# the brand document art is page-shaped (taller than wide), so it is
# pre-padded onto a 1024x1024 transparent canvas (sips -z would otherwise
# stretch a non-square source). Regenerate the squares with
# scripts/build-doc-squares.py if the page-shaped PNGs change.
#
# Input  (repo root):    branding/document-icons/square/{doc-patter,doc-patterproj,doc-patterc,doc-patterpack}.png  (1024x1024)
# Output (this package):  build/{doc-patter,doc-patterproj,doc-patterc,doc-patterpack}.icns
#   doc-patter      -> the .patter project package (macOS)
#   doc-patterproj  -> the project shards (.patterproj/.patterflow/.patterloc/.patterx)
#   doc-patterc     -> the compiled .patterc bundle
#   doc-patterpack  -> the .patterpack single-file project package
#
# The app icon stays a PNG (branding/icons/png/icon-patterpad-1024.png;
# electron-builder converts that one itself); only the doc associations need .icns.
set -euo pipefail

# Resolve the repo root from this script's own location, so it works no
# matter where the caller cd'd to.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
REPO_ROOT="$( cd "${APP_DIR}/../.." && pwd )"

SRC_DIR="${REPO_ROOT}/branding/document-icons/square"
OUT_DIR="${APP_DIR}/build"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-mac-icons.sh: skipping - sips/iconutil are mac-only" >&2
  exit 0
fi

for tool in sips iconutil; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "build-mac-icons.sh: required tool not found: $tool" >&2
    exit 1
  fi
done

mkdir -p "${OUT_DIR}"

generate_icns() {
  local name="$1"          # e.g. doc-patter
  local src="${SRC_DIR}/${name}.png"
  local out="${OUT_DIR}/${name}.icns"
  # `iconutil -c icns` insists the source directory's name end in exactly
  # `.iconset`. BSD mktemp -t appends its own random suffix AFTER our
  # template, so we make a temp PARENT and a fixed-name child inside it.
  local tmpparent
  tmpparent="$(mktemp -d -t build-mac-icons)"
  local iconset="${tmpparent}/${name}.iconset"
  mkdir -p "${iconset}"

  if [[ ! -f "${src}" ]]; then
    echo "build-mac-icons.sh: source missing: ${src}" >&2
    rm -rf "${tmpparent}"
    exit 1
  fi

  # The .icns format expects this exact set of sizes; the @2x files are the
  # Retina variants. iconutil refuses anything else.
  sips -z 16   16   "${src}" --out "${iconset}/icon_16x16.png"        >/dev/null
  sips -z 32   32   "${src}" --out "${iconset}/icon_16x16@2x.png"     >/dev/null
  sips -z 32   32   "${src}" --out "${iconset}/icon_32x32.png"        >/dev/null
  sips -z 64   64   "${src}" --out "${iconset}/icon_32x32@2x.png"     >/dev/null
  sips -z 128  128  "${src}" --out "${iconset}/icon_128x128.png"      >/dev/null
  sips -z 256  256  "${src}" --out "${iconset}/icon_128x128@2x.png"   >/dev/null
  sips -z 256  256  "${src}" --out "${iconset}/icon_256x256.png"      >/dev/null
  sips -z 512  512  "${src}" --out "${iconset}/icon_256x256@2x.png"   >/dev/null
  sips -z 512  512  "${src}" --out "${iconset}/icon_512x512.png"      >/dev/null
  sips -z 1024 1024 "${src}" --out "${iconset}/icon_512x512@2x.png"   >/dev/null

  iconutil -c icns "${iconset}" -o "${out}"
  rm -rf "${tmpparent}"
  echo "build-mac-icons.sh: built ${out#${REPO_ROOT}/}"
}

generate_icns doc-patter
generate_icns doc-patterproj
generate_icns doc-patterc
generate_icns doc-patterpack
