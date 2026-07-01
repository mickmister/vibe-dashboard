# vardash encrypted store and migrations

Bead: **vkvw-d7ad.8 — Implement vardash encrypted store and migrations**

## Production storage path

The production vardash store uses `@journeyapps/sqlcipher@6.0.0` behind `SqlcipherVardashStore` in `src/server/vardash/store.ts`.

Callers should depend on the `VardashStore` interface, not SQLCipher driver types. This keeps API, resolver, launch, and UI code independent from the native package.

## Key management MVP

The MVP uses a devbox-local generated key file:

- a random 32-byte key is generated with `node:crypto.randomBytes`;
- the key is stored under VD private data, outside repos/worktrees;
- default location: `~/.local/share/vibe-dashboard-runtime/data/vardash/sqlcipher.key`;
- `VARDASH_PRIVATE_DATA_DIR` may override the private directory for deployments/tests;
- containing directory is forced/validated as `0700`;
- key file is forced/validated as `0600`;
- corrupt/unsupported key file contents throw `VardashKeyError` and do not auto-regenerate over existing data.

The key is never logged by the key manager/store and is not returned by any store metadata method. Future API layers must preserve this boundary.

If the key is missing for a new store, a new key is generated. If the encrypted DB already exists and the key is missing, startup/access fails with an explicit key-missing error rather than generating a replacement key that cannot decrypt existing data. Recovery should be treated as an operator/user restore problem for MVP. If the key file is corrupt, startup/access fails with an explicit key error rather than silently creating a new key.

## Schema

Migration version 1 creates:

- `repo_env_keys`
- `repo_env_saved_values`
- `repo_env_default_selections`
- `workspace_repo_env_selections`
- `vardash_schema_migrations`

The schema supports repo-owned saved values, optional repo defaults, and workspace-repo selections keyed by `workspace_id + repo_id + env_key_id`.

## Secret/plain behavior

SQLCipher encrypts the full DB file, so both secret and plain values live in encrypted storage. The `kind` field controls product/API semantics:

- `secret` saved values return metadata only (`hasValue`, name, timestamps); raw value is available only through explicit launch resolution;
- `plain` saved values may be recalled by metadata/list operations for UX convenience;
- launch resolution returns raw env values for the selected repo/process and must remain an explicit vardash launch path.

## Migration/backward compatibility path

There is no prior vardash store schema in production. Version 1 is therefore an additive initial schema.

Backward compatibility rules for future migrations:

1. Add a new integer row to `vardash_schema_migrations` per migration.
2. Keep migrations idempotent where practical.
3. Never migrate by exporting plaintext secrets to files.
4. If a migration must rewrite secret values, do it inside the already-unlocked SQLCipher connection.
5. Preserve metadata-only secret read semantics after every migration.

## Native packaging validation

`@journeyapps/sqlcipher` builds from source. The Dockerfile explicitly installs `pkg-config` and `libssl-dev` alongside existing native build tooling in both the dashboard builder stage and runtime stage.

Validation path:

- targeted Vitest coverage for key manager and SQLCipher store;
- `npm run check-types` for TypeScript/native import boundary;
- full Docker build validation should be run before shipping image changes that rely on the native addon.
