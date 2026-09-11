#!/usr/bin/env bash
set -euo pipefail

manifest="${VD_GAS_CITY_RUNTIME_MANIFEST:-/usr/local/share/vd/gas-city-runtime.json}"
test -r "${manifest}" || { echo "required packaged compiler manifest is unavailable" >&2; exit 1; }

readarray -t values < <(node -e '
const fs=require("fs"), crypto=require("crypto");
const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
for (const [pathKey,hashKey] of [["gasCityExecutable","gasCityExecutableSha256"],["beadsExecutable","beadsExecutableSha256"]]) {
  if (hash(m[pathKey]) !== m[hashKey]) throw new Error(`packaged ${pathKey} digest mismatch`);
}
for (const key of ["gasCityExecutable","beadsExecutable","gasCityExecutableSha256","beadsExecutableSha256","gasCityArchiveSha256","beadsArchiveSha256"]) console.log(m[key]);
' "${manifest}")
test "${#values[@]}" -eq 6
export VD_PINNED_GC_BIN="${values[0]}"
export VD_PINNED_BD_BIN="${values[1]}"
export VD_PINNED_GC_SHA256="${values[2]}"
export VD_PINNED_BD_SHA256="${values[3]}"
export VD_PINNED_GC_ARCHIVE_SHA256="${values[4]}"
export VD_PINNED_BD_ARCHIVE_SHA256="${values[5]}"
export VD_REQUIRE_PACKAGED_GC_COMPILER_TEST=1

npx vitest run --config vitest.server.config.ts \
  src/modules/plugins/workflows/server/gasCityExecutionBundleCompiler.test.ts \
  -t "executes and verifies the actual pinned packaged compiler"
