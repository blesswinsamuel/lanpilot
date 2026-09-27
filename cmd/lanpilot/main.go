package main

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/blesswinsamuel/lanpilot/gen/go/lanpilot/v1/lanpilotv1connect"
	"github.com/blesswinsamuel/lanpilot/internal/api"
	"github.com/blesswinsamuel/lanpilot/internal/networkmgr"
	"github.com/blesswinsamuel/lanpilot/internal/lanpilot"
	"github.com/blesswinsamuel/lanpilot/internal/lanpilot/ddns"
	"github.com/blesswinsamuel/lanpilot/internal/tsdb"
	"github.com/blesswinsamuel/lanpilot/internal/web"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
)

const defaultLANSubnetCIDR = "10.100.0.0/16"

func parseLANSubnet(raw string) (uint32, uint32, error) {
	cidr := strings.TrimSpace(raw)
	if cidr == "" {
		cidr = defaultLANSubnetCIDR
	}

	_, subnet, err := net.ParseCIDR(cidr)
	if err != nil {
		return 0, 0, fmt.Errorf("parse CIDR %q: %w", cidr, err)
	}

	ip := subnet.IP.To4()
	if ip == nil {
		return 0, 0, fmt.Errorf("LAN_SUBNET_CIDR must be IPv4, got %q", cidr)
	}
	if len(subnet.Mask) != net.IPv4len {
		return 0, 0, fmt.Errorf("unexpected subnet mask size for %q", cidr)
	}

	lanSubnetIP := binary.LittleEndian.Uint32(ip)
	lanSubnetMask := binary.LittleEndian.Uint32(subnet.Mask)
	return lanSubnetIP, lanSubnetMask, nil
}

func parseDurationWithDefault(raw string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback, nil
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, err
	}
	return duration, nil
}

func parseBoolWithDefault(raw string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(raw))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func parseDomains(raw string) []string {
	parts := strings.Split(raw, ",")
	var domains []string
	for _, p := range parts {
		d := strings.TrimSpace(p)
		if d != "" {
			domains = append(domains, d)
		}
	}
	return domains
}

func setupDDNS(ctx context.Context, tsdbDB *tsdb.DB) *ddns.Manager {
	providerName := strings.ToLower(strings.TrimSpace(os.Getenv("DDNS_PROVIDER")))
	domains := parseDomains(os.Getenv("DDNS_DOMAINS"))

	enabledRaw := os.Getenv("DDNS_ENABLED")
	enabled := false
	if enabledRaw != "" {
		enabled = parseBoolWithDefault(enabledRaw, false)
	} else if providerName != "" && len(domains) > 0 {
		enabled = true
	}

	checkInterval, err := parseDurationWithDefault(os.Getenv("DDNS_CHECK_INTERVAL"), 5*time.Minute)
	if err != nil {
		log.Printf("warn: invalid DDNS_CHECK_INTERVAL: %v, defaulting to 5m", err)
		checkInterval = 5 * time.Minute
	}

	checkIPv4 := parseBoolWithDefault(os.Getenv("DDNS_IPV4"), true)
	checkIPv6 := parseBoolWithDefault(os.Getenv("DDNS_IPV6"), false)

	detector := ddns.NewDetector(ddns.DetectorConfig{
		Source: os.Getenv("DDNS_IP_SOURCE"),
	})

	var provider ddns.Provider
	switch providerName {
	case "cloudflare":
		token := os.Getenv("CLOUDFLARE_API_TOKEN")
		zoneID := os.Getenv("CLOUDFLARE_ZONE_ID")
		proxied := parseBoolWithDefault(os.Getenv("CLOUDFLARE_PROXIED"), false)
		cfProvider, err := ddns.NewCloudflareProvider(ddns.CloudflareConfig{
			APIToken: token,
			ZoneID:   zoneID,
			Proxied:  proxied,
		})
		if err != nil {
			log.Printf("warn: failed to initialize Cloudflare DDNS provider: %v", err)
		} else {
			provider = cfProvider
		}
	case "duckdns":
		token := os.Getenv("DUCKDNS_TOKEN")
		duckProvider, err := ddns.NewDuckDNSProvider(ddns.DuckDNSConfig{
			Token: token,
		})
		if err != nil {
			log.Printf("warn: failed to initialize DuckDNS provider: %v", err)
		} else {
			provider = duckProvider
		}
	case "generic_http", "generic":
		updateURL := os.Getenv("DDNS_UPDATE_URL")
		genProvider, err := ddns.NewGenericProvider(ddns.GenericConfig{
			URLTemplate: updateURL,
			HTTPMethod:  os.Getenv("DDNS_HTTP_METHOD"),
		})
		if err != nil {
			log.Printf("warn: failed to initialize Generic HTTP DDNS provider: %v", err)
		} else {
			provider = genProvider
		}
	default:
		if providerName != "" {
			log.Printf("warn: unknown DDNS provider: %q", providerName)
		}
	}

	mgr := ddns.NewManager(ddns.ManagerConfig{
		Enabled:   enabled && provider != nil,
		Provider:  provider,
		Detector:  detector,
		Domains:   domains,
		Interval:  checkInterval,
		CheckIPv4: checkIPv4,
		CheckIPv6: checkIPv6,
		Store:     tsdbDB,
	})

	if enabled && provider != nil {
		mgr.Register(prometheus.DefaultRegisterer)
		go mgr.Start(ctx)
	}

	return mgr
}

func main() {
	if len(os.Args) < 2 {
		log.Fatalf("Please specify a network interface")
	}

	// Look up the network interface by name.
	ifaceName := os.Args[1]
	iface, err := net.InterfaceByName(ifaceName)
	if err != nil {
		log.Fatalf("lookup network iface %q: %s", ifaceName, err)
	}

	checkTargets, err := lanpilot.ParseTargetConfigs(os.Getenv("INTERNET_CHECK_TARGETS"))
	if err != nil {
		log.Fatalf("invalid INTERNET_CHECK_TARGETS: %v", err)
	}

	checkInterval, err := parseDurationWithDefault(os.Getenv("INTERNET_CHECK_INTERVAL"), 15*time.Second)
	if err != nil {
		log.Fatalf("invalid INTERNET_CHECK_INTERVAL: %v", err)
	}

	lanSubnetIP, lanSubnetMask, err := parseLANSubnet(os.Getenv("LAN_SUBNET_CIDR"))
	if err != nil {
		log.Fatalf("invalid LAN_SUBNET_CIDR: %v", err)
	}

	ebpfFirewallCollector := lanpilot.NewEbpfCollector()
	ebpfFirewallCollector.SetLANSubnet(lanSubnetIP, lanSubnetMask)
	if err := ebpfFirewallCollector.Load(); err != nil {
		log.Fatalf("could not load ebpfFirewall: %s", err)
	}
	defer ebpfFirewallCollector.Close()
	if err := ebpfFirewallCollector.Attach(iface); err != nil {
		log.Fatalf("could not attach ebpfFirewall to iface %q: %s", iface.Name, err)
	}

	log.Printf("Attached program to iface %q (index %d)", iface.Name, iface.Index)
	log.Printf("Press Ctrl-C to exit and remove the program")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Initialize SQLite TSDB
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "/var/lib/lanpilot/lanpilot.db"
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		dbPath = "./lanpilot.db"
	}
	tsdbDB, err := tsdb.Open(dbPath)
	if err != nil {
		log.Printf("warn: failed to open TSDB at %s, falling back to in-memory: %v", dbPath, err)
		tsdbDB, err = tsdb.Open(":memory:")
		if err != nil {
			log.Fatalf("failed to open in-memory TSDB: %v", err)
		}
	}
	defer tsdbDB.Close()
	tsdbDB.StartRetentionWorker(ctx, 1*time.Hour, 7*24*time.Hour)

	arpCollector := lanpilot.NewArpCollector("/proc/net/arp")
	internetChecker := lanpilot.NewInternetChecker(checkInterval, checkTargets, tsdbDB)
	internetChecker.SetSampleSink(func(samples []lanpilot.MetricSample) {
		dbSamples := make([]tsdb.Sample, len(samples))
		for i, s := range samples {
			dbSamples[i] = tsdb.Sample{
				Metric:    s.Metric,
				Labels:    s.Labels,
				Timestamp: s.Timestamp,
				Value:     s.Value,
			}
		}
		_ = tsdbDB.InsertSamples(dbSamples)
	})

	prometheus.MustRegister(ebpfFirewallCollector)
	prometheus.MustRegister(arpCollector)
	internetChecker.Register(prometheus.DefaultRegisterer)

	go internetChecker.Start(ctx)

	sampleInterval, err := parseDurationWithDefault(os.Getenv("SAMPLE_INTERVAL"), 15*time.Second)
	if err != nil {
		log.Fatalf("invalid SAMPLE_INTERVAL: %v", err)
	}

	sampler := tsdb.NewSampler(tsdbDB, ebpfFirewallCollector, arpCollector, internetChecker, sampleInterval)
	sampler.Start(ctx)

	dhcpReader := lanpilot.NewDHCPLeaseReader(os.Getenv("DHCP_LEASES_FILE"), os.Getenv("DHCP_TYPE"))
	ddnsManager := setupDDNS(ctx, tsdbDB)

	networkMgr, err := networkmgr.NewManager(networkmgr.Options{
		DevicesPath:          os.Getenv("DEVICES_CONFIG_PATH"),
		DnsmasqDhcpHostsPath: os.Getenv("DNSMASQ_DHCP_HOSTS_PATH"),
		DnsmasqHostsPath:     os.Getenv("DNSMASQ_HOSTS_PATH"),
		DnsmasqAddressesPath: os.Getenv("DNSMASQ_ADDRESSES_PATH"),
		NftablesSetsPath:     os.Getenv("NFTABLES_SETS_PATH"),
		SearchDomain:         os.Getenv("DOMAIN_SUFFIX"),
	})
	if err != nil {
		log.Printf("warn: failed to initialize network manager: %v", err)
	} else {
		if err := networkMgr.StartWatcher(ctx); err != nil {
			log.Printf("warn: failed to start config file watcher: %v", err)
		}
	}

	routerService := api.NewLanpilotService(
		iface.Name,
		os.Getenv("LAN_SUBNET_CIDR"),
		ebpfFirewallCollector,
		arpCollector,
		internetChecker,
		tsdbDB,
		sampler,
		dhcpReader,
		ddnsManager,
		networkMgr,
	)
	rpcPath, rpcHandler := lanpilotv1connect.NewLanpilotServiceHandler(routerService)

	port := os.Getenv("PORT")
	if port == "" {
		port = "9156"
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{
			"Accept-Encoding",
			"Content-Encoding",
			"Content-Type",
			"Connect-Protocol-Version",
			"Connect-Timeout-Ms",
			"Connect-Accept-Encoding",
			"Connect-Content-Encoding",
			"Grpc-Timeout",
			"X-Grpc-Web",
			"X-User-Agent",
		},
		ExposedHeaders: []string{
			"Content-Encoding",
			"Connect-Content-Encoding",
			"Grpc-Status",
			"Grpc-Message",
			"Grpc-Status-Details-Bin",
		},
	})

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.Handle(rpcPath, rpcHandler)
	mux.Handle("/", web.Handler())

	server := &http.Server{
		Addr:              net.JoinHostPort(host, port),
		Handler:           corsHandler.Handler(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	serverErrCh := make(chan error, 1)
	go func() {
		log.Printf("Serving metrics on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Print("Received signal, shutting down")
	case err := <-serverErrCh:
		log.Fatalf("metrics server failed: %v", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
