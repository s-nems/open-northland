#!/usr/bin/env bash
# Builds the dmrender binary the music stage shells out to (see stages/music/). One-time local
# setup, like owning the game copy: requires git, cmake and a C++ toolchain. Nothing it produces
# is committed; the result lands in tools/asset-pipeline/vendor/dmrender.
set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"
BUILD_DIR="$VENDOR_DIR/build"
PREFIX="$BUILD_DIR/prefix"
PATCH="$VENDOR_DIR/libdmusic-cultures.patch"

# Pinned upstream commits (all MIT): the patch is authored against this libdmusic revision.
LIBDMUSIC_REPO=https://github.com/frabert/libdmusic
LIBDMUSIC_REV=790662e71120ff70359033083eb5a8a5751d5300
SF2CUTE_REPO=https://github.com/gocha/sf2cute
SF2CUTE_REV=3c5fc83b6ba3d1feb377f9c86021fd77499eb7c0
ARGS_REPO=https://github.com/Taywee/args
ARGS_REV=903b07dfdf5120622c9998a48ce97d64c0066556

command -v cmake >/dev/null || { echo "build-dmrender: cmake not found (brew install cmake)"; exit 1; }

clone_pinned() {
  local repo="$1" rev="$2" dir="$3"
  if [ ! -d "$dir" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$repo"
  fi
  git -C "$dir" fetch -q --depth 1 origin "$rev"
  git -C "$dir" checkout -q -f "$rev"
}

mkdir -p "$BUILD_DIR" "$PREFIX/include"
clone_pinned "$LIBDMUSIC_REPO" "$LIBDMUSIC_REV" "$BUILD_DIR/libdmusic"
clone_pinned "$SF2CUTE_REPO" "$SF2CUTE_REV" "$BUILD_DIR/sf2cute"
clone_pinned "$ARGS_REPO" "$ARGS_REV" "$BUILD_DIR/args"

git -C "$BUILD_DIR/libdmusic" apply "$PATCH"

cmake -S "$BUILD_DIR/sf2cute" -B "$BUILD_DIR/sf2cute/build" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$BUILD_DIR/sf2cute/build" -j >/dev/null
cmake --install "$BUILD_DIR/sf2cute/build" >/dev/null

cp "$BUILD_DIR/args/args.hxx" "$PREFIX/include/"

cmake -S "$BUILD_DIR/libdmusic" -B "$BUILD_DIR/libdmusic/build" \
  -DCMAKE_PREFIX_PATH="$PREFIX" -DCMAKE_BUILD_TYPE=Release \
  -DDMUSIC_BUILD_DMPLAY=OFF -DDMUSIC_BUILD_DLS2SF=OFF -DDMUSIC_BUILD_SAMPLEDUMP=OFF >/dev/null
cmake --build "$BUILD_DIR/libdmusic/build" -j >/dev/null

cp "$BUILD_DIR/libdmusic/build/utils/dmrender/dmrender" "$VENDOR_DIR/dmrender"
echo "build-dmrender: built $VENDOR_DIR/dmrender"
