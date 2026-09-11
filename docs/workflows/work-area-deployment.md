# Workflow work-area deployment capability

Production work-area creation is supported only for an explicitly declared
single-host deployment. Every VD process that can create a work area must run
on that host and use the same canonical, server-controlled lock filesystem.
The filesystem must support atomic hard links, durable file synchronization,
and directory synchronization.

Startup must provide `production_single_host` configuration with an absolute
server-state root, a stable lock-domain identifier, and a stable host
identifier. Initialization canonicalizes the root, verifies private ownership
and permissions, probes atomic hard links and synchronization, and binds a
digest of that capability into the durable work-area registry. Missing or
different configuration disables work-area creation.

`development_temporary` is an explicit test/development mode. Its temporary
process-local default is not accepted as production configuration.

Multi-host work-area creation is unsupported. It requires a future distributed
Git-registry coordinator that fences mutations using durable host and boot
identity. Deployments must not attempt to emulate multi-host support with
separate local lock roots.
