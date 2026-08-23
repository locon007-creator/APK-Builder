#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$ROOT/out"
rm -rf "$OUT"
mkdir -p "$OUT"
find "$ROOT/src/main/java" "$ROOT/src/test/java" -name '*.java' -print > "$ROOT/.sources"
javac --release 17 -Xlint:all -Werror -d "$OUT" @"$ROOT/.sources"
rm -f "$ROOT/.sources"
java -cp "$OUT" com.osulsa.apkbuilder.engine.EngineSelfTest
java -cp "$OUT" com.osulsa.apkbuilder.engine.ProjectArchiveSelfTest
java -cp "$OUT" com.osulsa.apkbuilder.engine.ApkProjectInjectorSelfTest
