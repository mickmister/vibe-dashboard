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

Multi-host work-area creation is unsupported. It requires a future distributed
Git-registry coordinator that fences mutations using durable host and boot
identity. Deployments must not attempt to emulate multi-host support with
separate local lock roots.
