# AGENTS.md

Guidance for AI coding agents and contributors working in this repository.
Read this before making changes.

## What this project is

`lanpilot` is a lightweight LAN control plane and observability daemon for Linux routers and gateways. It manages DHCP and DNS (dnsmasq) from a device inventory, performs dynamic DNS updates (Cloudflare/DuckDNS/generic HTTP), provides Wake-on-LAN, and renders managed nftables sets. For observability it collects eBPF traffic counters at TC ingress/egress, does ARP-based device discovery with DHCP lease resolution, and runs TCP internet reachability checks. It exposes Prometheus metrics, runs a Connect-RPC service with an embedded SQLite time-series database, and embeds a web dashboard SPA.

## Essential Commands

### Go Backend
```bash
go test ./...                       # run all unit tests
GOARCH=amd64 go test ./...          # run tests targeting amd64 (eBPF stubs/collectors)
go build ./...                      # build all packages
task go-build                       # build Linux amd64 binary
```

### Protobuf & Code Generation
```bash
task buf-generate                   # generate protobuf and Connect-RPC definitions
task go-generate                    # regenerate eBPF artifacts via Docker
```

### Web UI (Frontend)
The web application is located in `web/` (React 19 + Vite 8 + TypeScript + Tailwind CSS v4). It is embedded into the Go binary at `internal/web/dist/`.

```bash
cd web && bun install               # install frontend dependencies (or task web-install)
cd web && bun run dev               # start Vite dev server on :9157 (or task web-dev)
cd web && bun run build             # typecheck & build frontend
task web-build                      # builds web frontend and syncs to internal/web/dist/
```

## Frontend & shadcn/ui Guidelines

- **Always use shadcn CLI tooling**: All UI component primitives in `web/src/components/ui/` **must** be generated using the official shadcn tooling (`bunx --bun shadcn@latest add <component>`). **Never manually write or hand-craft shadcn component primitives.**
- **Preset `bJMVaeaO`**: The project uses shadcn preset `bJMVaeaO` (`radix-nova` style, `stone` base palette, Tailwind CSS v4 with OKLCH variables). To apply or re-apply this preset, run:
  ```bash
  cd web && bunx --bun shadcn@latest apply --preset bJMVaeaO -y
  ```
- **Adding components**: To add a new UI primitive, navigate to `web/` and run:
  ```bash
  bunx --bun shadcn@latest add <component-name>
  ```
  Or with `--overwrite` if updating existing ones:
  ```bash
  bunx --bun shadcn@latest add <component-name> --overwrite
  ```
- **Configuration**: Configuration lives in `web/components.json`. It specifies the Vite template, Tailwind CSS v4 configuration, path aliases (`@/components/ui`, `@/lib/utils`), and Lucide icons.
- **Custom Utilities vs shadcn `utils.ts`**: shadcn CLI overwrites `web/src/lib/utils.ts` during initialization and preset application (keeping only `export { cn } from "cn"`). Therefore, domain utilities and formatters must live in `web/src/lib/format.ts` (or other files), not in `utils.ts`.
- **Custom Styling**: Do not modify generated component primitives in `web/src/components/ui/` with custom non-standard variants unless strictly necessary. Instead, use standard variants and compose styling via `className` and `cn(...)` in application components.
- **Package Manager**: Use `bun` for frontend package management and script execution in `web/`.

## Repo Structure

```
cmd/lanpilot/                 # CLI entrypoint
internal/
  api/                        # Connect-RPC service implementation
  lanpilot/                   # eBPF collector (C and Go), ARP discovery, DHCP leases, DDNS, internet reachability
  networkmgr/                 # Device inventory, dnsmasq DHCP/hosts rendering, nftables sets, config watcher
  tsdb/                       # Embedded SQLite time-series database & background sampler
  web/                        # Embedded web SPA assets (dist/) and HTTP handler
proto/                        # Protobuf definitions
gen/go/                       # Generated Go protobuf/Connect code (do not edit)
web/                          # React SPA frontend (Vite, Tailwind, shadcn/ui, Connect-RPC)
  src/
    components/ui/            # shadcn/ui components (generated via shadcn CLI)
    components/               # Domain-specific UI tabs and header
    gen/                      # Generated TypeScript protobuf/Connect code (do not edit)
    lib/                      # Connect-RPC client and utilities
Taskfile.yaml                 # Task runner commands
```

## Conventions

- **Target & Testing Environment**: There is no local testing; testing and deployment are done directly on the Linux router (`task deploy-dev`, `ssh root@router`). Target Linux environments directly (processes run with capabilities `CAP_NET_ADMIN CAP_NET_RAW CAP_BPF CAP_PERFMON`). Do not write mock fallbacks or bypasses for non-root local dev environments unless explicitly requested.
- **No Backwards Compatibility**: When refactoring or redesigning features, do not maintain legacy backwards compatibility, obsolete proto fields, deprecated metric aliases, or old environment variables. Build clean, modern implementations directly.
- Run tests (`go test ./...`) and web build (`cd web && bun run build`) before committing.
- Follow conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Check `git status` after changes and maintain a clean commit history.
