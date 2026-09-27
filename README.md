# LAN Pilot

LAN Pilot is a lightweight LAN control plane and observability daemon for Linux routers and gateways. It manages DHCP and DNS (dnsmasq), keeps DNS records in sync with dynamic WAN IPs, discovers and inventories LAN devices, and monitors traffic and internet reachability — all from a single binary with an embedded web dashboard.

![Screenshot 1](https://github.com/blesswinsamuel/lanpilot/assets/815723/25391261-ecb0-438a-a1b3-9c61af3f3434)
![Screenshot 2](https://github.com/blesswinsamuel/lanpilot/assets/815723/1dd72a04-1c39-489c-9a55-0227a6e026e4)

## Features

- **Traffic visibility**: eBPF-based packet and byte accounting at TC ingress/egress, with local-vs-internet classification via a configurable LAN subnet CIDR
- **Device discovery**: ARP table polling combined with DHCP lease resolution (Kea and dnsmasq)
- **DHCP management**: device inventory (`devices.yaml`) rendered into dnsmasq DHCP host entries with live reload
- **DNS management**: managed DNS records rendered into dnsmasq hosts files with live reload
- **Dynamic DNS**: automatic WAN IP sync to Cloudflare, DuckDNS, or any generic HTTP provider
- **Wake-on-LAN**: power on devices from the dashboard
- **nftables integration**: managed nftables sets rendered and reloaded from device inventory
- **Internet health**: TCP reachability checks with latency, jitter, and packet-loss metrics
- **Time-series storage**: embedded SQLite TSDB with background sampler and retention
- **Prometheus metrics** and a Grafana dashboard generator
- **Connect-RPC API** and embedded web dashboard SPA
- Graceful shutdown and runtime configuration via environment variables

## Requirements

- Linux host/router
- Kernel support for TC eBPF attach (SchedACT/TCX)
- Privileges required to load and attach eBPF programs (`CAP_NET_ADMIN CAP_NET_RAW CAP_BPF CAP_PERFMON`)
- Go toolchain (for local builds)
- Docker (for generating eBPF artifacts)

## Quick Start

### 1) Run from source

```bash
go run ./cmd/lanpilot <network-interface>
```

Example:

```bash
HOST=0.0.0.0 \
PORT=9156 \
LAN_SUBNET_CIDR=192.168.1.0/24 \
INTERNET_CHECK_TARGETS=1.1.1.1:53,8.8.8.8:53 \
go run ./cmd/lanpilot eth0
```

### 2) Scrape with Prometheus

Expose and scrape:

```text
http://<router-host>:9156/metrics
```

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `HOST` | Bind host for the HTTP server | `0.0.0.0` |
| `PORT` | Bind port for the HTTP server | `9156` |
| `INTERNET_CHECK_TARGETS` | Comma-separated `host:port` TCP targets used for internet checks | — |
| `INTERNET_CHECK_INTERVAL` | Interval between internet reachability checks | `15s` |
| `LAN_SUBNET_CIDR` | Local IPv4 subnet used for internet/local traffic classification | `10.100.0.0/16` |
| `SAMPLE_INTERVAL` | Interval for TSDB sampling | `15s` |
| `DB_PATH` | Path to the embedded SQLite time-series database | `/var/lib/lanpilot/lanpilot.db` |
| `DHCP_LEASES_FILE` | Path to the DHCP leases file (Kea or dnsmasq) | — |
| `DHCP_TYPE` | DHCP lease file type (`kea` or `dnsmasq`) | — |
| `DEVICES_CONFIG_PATH` | Path to the managed device inventory (`devices.yaml`) | `/var/lib/lanpilot/devices.yaml` |
| `DNSMASQ_DHCP_HOSTS_PATH` | dnsmasq DHCP hosts file rendered from the device inventory | — |
| `DNSMASQ_HOSTS_PATH` | dnsmasq hosts file rendered from managed DNS records | — |
| `DNSMASQ_ADDRESSES_PATH` | dnsmasq config file rendered from wildcard DNS records (`address=` lines) | — |
| `NFTABLES_SETS_PATH` | nftables sets file rendered from the device inventory | — |
| `DOMAIN_SUFFIX` | Search domain used for device hostnames | empty |
| `DDNS_ENABLED` | Enable dynamic DNS updates | auto |
| `DDNS_PROVIDER` | DDNS provider: `cloudflare`, `duckdns`, or `generic` | empty |
| `DDNS_DOMAINS` | Comma-separated domains to update | empty |
| `DDNS_CHECK_INTERVAL` | WAN IP check interval | `5m` |
| `DDNS_IP_SOURCE` | WAN IP detection source | auto |

## Dashboard

The Grafana dashboard source lives in the [grafana-dashboards](https://github.com/blesswinsamuel/grafana-dashboards) repo (`dashboards/lanpilot.ts`). The embedded web dashboard is served at `http://<router-host>:9156/`.

## Development

Useful commands:

```bash
# Generate protobuf / Connect-RPC code
task buf-generate

# Generate eBPF artifacts (Docker-based)
task go-generate

# Build Linux amd64 binary
task go-build

# Run tests
go test ./...

# Build web frontend and sync to internal/web/dist
task web-build

# Deploy dev build to the router
task deploy-dev
```

## Troubleshooting

- If eBPF loading fails, verify kernel support and required privileges.
- If labels are mostly `internet`, verify `LAN_SUBNET_CIDR` matches your LAN.
- If the dashboard fails to load data, verify the service is running on the router.

## Contributing

Issues and pull requests are welcome. For substantial changes, open an issue first so scope and design can be aligned.
