#!/usr/bin/env bash
# Verifies the universal, ad-hoc-signed macOS build. Shared by release.yml and mac-build.yml.
set -euo pipefail
app="${1:-dist/mac-universal/MDZip Studio.app}"
bin="$app/Contents/MacOS/MDZip Studio"
archs="$(lipo -archs "$bin")"
echo "Architectures: $archs"
case "$archs" in
  *x86_64*arm64*|*arm64*x86_64*) ;;
  *) echo "::error::Expected both x86_64 and arm64, got: $archs"; exit 1 ;;
esac
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv --verbose=4 "$app" 2>&1 | tee codesign.txt
grep -q "Signature=adhoc" codesign.txt || { echo "::error::Expected an ad-hoc signature"; exit 1; }
