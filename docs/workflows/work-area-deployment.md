# Workflow work-area deployment capability

Production work-area creation is supported only for an explicitly declared
single-host deployment. Every VD process that can create a work area must run
on that host and use the same canonical, server-controlled lock filesystem.
The filesystem must support atomic hard links, durable file synchronization,
and directory synchronization.

Startup must use the `production` runtime classification and provide
`production_single_host` configuration with an absolute
server-state root, a stable lock-domain identifier, and a stable host
identifier. Initialization canonicalizes the root, verifies private ownership
and permissions, probes atomic hard links and synchronization, and binds a
digest of that capability into the durable work-area registry. Missing or
different configuration disables work-area creation.

The server creates a private mode-0600 host-instance identity in the protected
state root and binds it to a kernel/OS host fingerprint. Creation is atomic and
crash-durable. The durable registry binds both values in addition to the
operator labels, so copying the same configuration or state directory to a
different host fails closed. Container restarts must retain the state volume
and OS machine identity. Rotating either identity requires a future explicit,
audited migration after all work-area activity has been reconciled; deleting or
copying the identity file is not a supported rotation procedure.

`development_temporary` requires a `development` or `test` runtime
classification, an explicit unsafe-development opt-in, and a separate registry
namespace. Its process-local temporary fallback is never accepted as
production configuration, and a registry cannot drift between production and
development modes.

Development must also use a physically separate database/registry configured
with the durable `development` registry-kind marker before the provider starts.
Production registries must be pre-designated `production`. Provider startup is
read-only until that marker matches, so accidentally pointing development at a
production database—or production at a development database—fails without
creating lock-domain, work-area, operation, lease, repository, or audit rows.
An unmarked database is disabled rather than inferred or adopted. Registry kind
cannot be changed after designation; create a separate database instead.

## Legacy production registry adoption

A populated registry created before the registry-kind marker remains disabled
after migration. It is never inferred from its contents. A server-only
maintenance operation may designate it as production exactly once. The
operation is not exposed through workflow, browser, agent, or normal request
routes. It requires an authenticated maintenance actor and idempotency key and
verifies the exact legacy lock-domain digest against the canonical lock root,
configured production labels, private host identity, and compatible work-area,
repository, operation, lease, audit, and reservation records. It atomically
writes the production marker and an immutable adoption audit record. Normal
provider initialization then performs the existing exact legacy-domain upgrade.
Development adoption and ambiguous, absent, or mismatched legacy state are
rejected without mutation.

Multi-host work-area creation is unsupported. It requires a future distributed
Git-registry coordinator that fences mutations using durable host and boot
identity. Deployments must not attempt to emulate multi-host support with
separate local lock roots.
