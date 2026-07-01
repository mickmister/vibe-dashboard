# vardash SQLCipher packaging spike

Bead: **vkvw-d7ad.1 — Spike SQLCipher packaging for vardash store**

Date: 2026-07-01

## Decision

Use `@journeyapps/sqlcipher` as the first production SQLCipher package path for vardash storage, behind a `vardash-store` interface.

Do not use the existing `better-sqlite3` dependency for production vardash storage because it is not encrypted. Do not use a plaintext SQLite adapter except for tests or explicitly non-production development fixtures.

## Why this path

`@journeyapps/sqlcipher` is a maintained fork of `node-sqlite3` modified to use SQLCipher. Its README states that it bundles SQLCipher, supports macOS and Linux, always builds the native addon from source, and does not support Windows/prebuilt binaries in this phase. That matches the VD devbox Linux target while keeping the future standalone npm story honest.

The package currently reports:

```text
@journeyapps/sqlcipher@6.0.0
license: BSD-3-Clause
SQLCipher: 4.14.0 community
```

## Smoke test performed

Environment:

```text
node v22.23.1
npm 10.9.8
Debian bookworm devbox
```

Install test:

```bash
mkdir /tmp/vardash-sqlcipher-XXXXXX
cd /tmp/vardash-sqlcipher-XXXXXX
npm init -y
npm install @journeyapps/sqlcipher@6.0.0
```

Result:

```text
added 4 packages, and audited 5 packages in 6m
found 0 vulnerabilities
```

Native linkage check:

```text
node_modules/@journeyapps/sqlcipher/build/Release/node_sqlite3.node
  links libcrypto.so.3 from the system
```

Runtime smoke test:

- opened a new database;
- set `PRAGMA key`;
- verified `PRAGMA cipher_version` returned `4.14.0 community`;
- inserted and read a row;
- verified the file header was not `SQLite format 3`;
- verified opening with the wrong key failed with SQLCipher HMAC/decrypt errors;
- verified reopening with the correct key recovered the row.

Observed result:

```json
{
  "cipher": { "cipher_version": "4.14.0 community" },
  "row": { "value": "super-secret" },
  "wrongKeyFailed": true,
  "row2": { "value": "super-secret" }
}
```

## Devbox dependency implications

The package builds from source. Linux requirements from the package README are native build tooling plus OpenSSL development headers.

The current devbox image already has the required pieces installed in this environment:

```text
build-essential
python3
pkg-config
libssl-dev
```

`Dockerfile.vkvd` already installs `build-essential` and `python3`. Before adding the package to the production build, confirm `libssl-dev` and `pkg-config` are explicitly installed in every image stage that runs `npm/pnpm install` for the runtime package. Do not rely on transitive packages making headers available.

## Recommended store boundary

Keep SQLCipher behind a small interface so tests and future stores do not affect API or launch code:

```ts
export interface VardashStore {
  listRepoEnvKeys(repoId: string): Promise<RepoEnvKeyMetadata[]>;
  upsertRepoEnvKey(input: UpsertRepoEnvKeyInput): Promise<RepoEnvKeyMetadata>;
  createSavedValue(input: CreateSavedValueInput): Promise<RepoEnvSavedValueMetadata>;
  replaceSavedValue(input: ReplaceSavedValueInput): Promise<RepoEnvSavedValueMetadata>;
  setRepoDefaultSelection(input: SetRepoDefaultSelectionInput): Promise<void>;
  setWorkspaceRepoSelection(input: SetWorkspaceRepoSelectionInput): Promise<void>;
  resolveRepoEnvForLaunch(input: ResolveRepoEnvForLaunchInput): Promise<ResolvedRepoEnv>;
}
```

The production implementation should open the SQLCipher DB by applying key material before migrations/queries. Callers should never issue raw SQLCipher pragmas directly.

## Schema requirements for vkvw-d7ad.8

The encrypted store migration should support:

- repo env keys;
- repo-owned saved values;
- optional repo default selections;
- workspace-repo active selections keyed by `workspace_id + repo_id + env_key_id`;
- secret/plain distinction;
- metadata-only secret reads.

Suggested tables:

```sql
repo_env_keys (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('secret', 'plain')),
  required INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repo_id, key)
);

repo_env_saved_values (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  env_key_id TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_value BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (env_key_id, name)
);

repo_env_default_selections (
  repo_id TEXT NOT NULL,
  env_key_id TEXT NOT NULL,
  saved_value_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, env_key_id)
);

workspace_repo_env_selections (
  workspace_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  env_key_id TEXT NOT NULL,
  saved_value_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repo_id, env_key_id)
);
```

Even plain values may live in the encrypted DB. The `kind` controls recall/API behavior, not whether the underlying SQLCipher file encrypts the row.

## Risks and mitigations

1. **Source build time** — install took around six minutes in this devbox. Mitigation: rely on Docker layer caching and consider prebuilding VD runtime artifacts in image builds.
2. **System OpenSSL dependency** — Linux addon links to `libcrypto.so.3`. Mitigation: pin runtime base image family and explicitly install build/runtime dependencies.
3. **Async API mismatch** — package is `node-sqlite3` style, while the repo already uses `better-sqlite3` elsewhere. Mitigation: isolate behind `vardash-store`; do not leak driver types.
4. **Windows unsupported** — package README says Windows is unsupported. Mitigation: acceptable for Linux devbox MVP; standalone npm docs must state platform support.
5. **Temporary data** — SQLCipher docs note main DB and journals are encrypted, but transient files require attention. Mitigation: set safe pragmas in the store open path and avoid queries that materialize secrets into app logs/temp files.

## Alternatives considered but not selected for the production path

- `better-sqlite3-multiple-ciphers`: attractive synchronous API and active releases, but it is based on SQLite3MultipleCiphers rather than the official SQLCipher package path. Keep as fallback only if `@journeyapps/sqlcipher` becomes unworkable.
- `better-sqlite3-sqlcipher`: older fork/version surface compared with the current `@journeyapps/sqlcipher` package.
- plaintext `better-sqlite3`: acceptable only for tests/non-production fixtures, not shippable vardash storage.

## Next bead

Proceed to **vkvw-d7ad.8 — Implement vardash encrypted store and migrations** using `@journeyapps/sqlcipher` unless a later build proves it fails in the production Docker build stage.

## Sources

- `@journeyapps/sqlcipher` README: https://github.com/journeyapps/node-sqlcipher/blob/master/README.md
- SQLCipher design: https://www.zetetic.net/sqlcipher/design/
- `better-sqlite3-multiple-ciphers` npm package: https://www.npmjs.com/package/better-sqlite3-multiple-ciphers
