package networkmgr

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"gopkg.in/yaml.v3"
)

type Device struct {
	ID        string   `yaml:"id" json:"id"`
	Name      string   `yaml:"name" json:"name"`
	MAC       string   `yaml:"mac" json:"mac"`
	Vlan      string   `yaml:"vlan,omitempty" json:"vlan,omitempty"`
	IP        string   `yaml:"ip" json:"ip"`
	Hostnames []string `yaml:"hostnames" json:"hostnames"`
	Tags      []string `yaml:"tags" json:"tags"`
	LockToAPs []string `yaml:"lock_to_aps,omitempty" json:"lock_to_aps,omitempty"`
}

type DnsRecord struct {
	Name    string   `yaml:"name" json:"name"`
	IP      string   `yaml:"ip" json:"ip"`
	Aliases []string `yaml:"aliases" json:"aliases"`
}

type DevicesConfig struct {
	Version    int         `yaml:"version" json:"version"`
	Devices    []Device    `yaml:"devices" json:"devices"`
	DnsRecords []DnsRecord `yaml:"dns_records" json:"dns_records"`
}

// isWildcardName reports whether a DNS name is a wildcard (e.g. "*.home.bless.win").
func isWildcardName(name string) bool {
	return strings.HasPrefix(name, "*.")
}

// wildcardDomain strips the leading "*." and trailing dot from a wildcard name,
// returning the domain to use in a dnsmasq address=/domain/ip entry.
func wildcardDomain(name string) string {
	return strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(name), "*."), ".")
}

type Manager struct {
	mu                  sync.RWMutex
	cfg                 DevicesConfig
	devicesPath         string
	dnsmasqDhcpHosts    string
	dnsmasqHosts        string
	dnsmasqAddresses    string
	nftablesSets        string
	searchDomain        string
	isApplying          bool
	lastExternalModTime time.Time
}

type Options struct {
	DevicesPath          string
	DnsmasqDhcpHostsPath string
	DnsmasqHostsPath     string
	DnsmasqAddressesPath string
	NftablesSetsPath     string
	SearchDomain         string
}

func NewManager(opts Options) (*Manager, error) {
	devicesPath := opts.DevicesPath
	if devicesPath == "" {
		devicesPath = os.Getenv("DEVICES_CONFIG_PATH")
	}
	if devicesPath == "" {
		devicesPath = "/var/lib/lanpilot/devices.yaml"
	}
	if abs, err := filepath.Abs(devicesPath); err == nil {
		devicesPath = abs
	}

	stateDir := filepath.Dir(devicesPath)
	dhcpHosts := opts.DnsmasqDhcpHostsPath
	if dhcpHosts == "" {
		dhcpHosts = filepath.Join(stateDir, "dnsmasq.dhcp-hosts")
	}
	hosts := opts.DnsmasqHostsPath
	if hosts == "" {
		hosts = filepath.Join(stateDir, "dnsmasq.hosts")
	}
	addresses := opts.DnsmasqAddressesPath
	if addresses == "" {
		addresses = filepath.Join(stateDir, "dnsmasq.addresses")
	}
	nftSets := opts.NftablesSetsPath
	if nftSets == "" {
		nftSets = filepath.Join(stateDir, "nftables-sets.nft")
	}

	domain := opts.SearchDomain
	if domain == "" {
		domain = strings.Trim(os.Getenv("DOMAIN_SUFFIX"), ".")
		if domain == "" {
			domain = "home.lan"
		}
	}

	m := &Manager{
		devicesPath:      devicesPath,
		dnsmasqDhcpHosts: dhcpHosts,
		dnsmasqHosts:     hosts,
		dnsmasqAddresses: addresses,
		nftablesSets:     nftSets,
		searchDomain:     domain,
	}

	if err := m.Load(); err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("failed to load %s: %w", devicesPath, err)
		}
		log.Printf("info: %s does not exist yet; will initialize empty config", devicesPath)
		m.cfg = DevicesConfig{Version: 1}
	} else {
		// Render initial files from existing devices.yaml on startup
		m.mu.Lock()
		_ = m.renderAndReloadLocked()
		m.mu.Unlock()
	}

	return m, nil
}

func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.devicesPath)
	if err != nil {
		return err
	}

	var cfg DevicesConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("unmarshal yaml: %w", err)
	}

	m.cfg = cfg
	if info, err := os.Stat(m.devicesPath); err == nil {
		m.lastExternalModTime = info.ModTime()
	}

	return nil
}

func (m *Manager) SaveAndApply() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	return m.saveAndApplyLocked()
}

func (m *Manager) saveAndApplyLocked() error {
	data, err := yaml.Marshal(m.cfg)
	if err != nil {
		return fmt.Errorf("marshal yaml: %w", err)
	}

	dir := filepath.Dir(m.devicesPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}

	tmpFile := fmt.Sprintf("%s.tmp.%d", m.devicesPath, time.Now().UnixNano())
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return fmt.Errorf("write tmp file: %w", err)
	}
	if err := os.Rename(tmpFile, m.devicesPath); err != nil {
		return fmt.Errorf("rename to %s: %w", m.devicesPath, err)
	}

	if info, err := os.Stat(m.devicesPath); err == nil {
		m.lastExternalModTime = info.ModTime()
	}

	return m.renderAndReloadLocked()
}

func (m *Manager) renderAndReloadLocked() error {
	// 1. Render dnsmasq.dhcp-hosts
	var dhcpHostsLines []string
	for _, dev := range m.cfg.Devices {
		if dev.MAC == "" || dev.IP == "" {
			continue
		}
		var primaryHostname string
		if len(dev.Hostnames) > 0 {
			primaryHostname = dev.Hostnames[0]
		} else if dev.Name != "" {
			primaryHostname = dev.Name
		}
		var entry string
		if primaryHostname != "" {
			entry = fmt.Sprintf("%s,%s,%s", dev.MAC, dev.IP, primaryHostname)
		} else {
			entry = fmt.Sprintf("%s,%s", dev.MAC, dev.IP)
		}
		if dev.Vlan != "" {
			entry = fmt.Sprintf("tag:%s,%s", dev.Vlan, entry)
		}
		dhcpHostsLines = append(dhcpHostsLines, entry)
	}
	if err := os.WriteFile(m.dnsmasqDhcpHosts, []byte(strings.Join(dhcpHostsLines, "\n")+"\n"), 0644); err != nil {
		log.Printf("warn: failed writing %s: %v", m.dnsmasqDhcpHosts, err)
	}

	// 2. Render dnsmasq.hosts (regular names) and dnsmasq.addresses (wildcard names)
	var hostsLines []string
	var addressLines []string
	seenAddresses := map[string]bool{}

	addAddress := func(rawName, ip string) {
		domain := wildcardDomain(rawName)
		if domain == "" {
			return
		}
		line := fmt.Sprintf("address=/%s/%s", domain, ip)
		if seenAddresses[line] {
			log.Printf("warn: duplicate dns address entry %s; ignoring", line)
			return
		}
		seenAddresses[line] = true
		addressLines = append(addressLines, line)
	}

	for _, dev := range m.cfg.Devices {
		if dev.IP == "" {
			continue
		}
		var names []string
		for _, h := range dev.Hostnames {
			if isWildcardName(h) {
				addAddress(h, dev.IP)
				continue
			}
			names = append(names, h)
		}
		if len(names) == 0 && dev.Name != "" && !isWildcardName(dev.Name) {
			names = append(names, dev.Name)
		}
		if len(names) > 0 {
			hostsLines = append(hostsLines, fmt.Sprintf("%s\t%s", dev.IP, strings.Join(names, " ")))
		}
	}
	for _, rec := range m.cfg.DnsRecords {
		if rec.IP == "" {
			continue
		}
		var names []string
		for _, name := range append([]string{rec.Name}, rec.Aliases...) {
			if name == "" {
				continue
			}
			if isWildcardName(name) {
				addAddress(name, rec.IP)
				continue
			}
			names = append(names, name)
		}
		if len(names) > 0 {
			hostsLines = append(hostsLines, fmt.Sprintf("%s\t%s", rec.IP, strings.Join(names, " ")))
		}
	}
	if err := os.WriteFile(m.dnsmasqHosts, []byte(strings.Join(hostsLines, "\n")+"\n"), 0644); err != nil {
		log.Printf("warn: failed writing %s: %v", m.dnsmasqHosts, err)
	}
	if err := os.WriteFile(m.dnsmasqAddresses, []byte(strings.Join(addressLines, "\n")+"\n"), 0644); err != nil {
		log.Printf("warn: failed writing %s: %v", m.dnsmasqAddresses, err)
	}

	// 3. Render nftables-sets.nft
	var iotInternetMACs, chromecastMACs, fireMACs, atombergMACs []string
	var haIPs, haMACs, blessMacIPs []string

	for _, dev := range m.cfg.Devices {
		if slices.Contains(dev.Tags, "allow_internet") && dev.MAC != "" {
			iotInternetMACs = append(iotInternetMACs, dev.MAC)
		}
		if slices.Contains(dev.Tags, "cast_target") && dev.MAC != "" {
			chromecastMACs = append(chromecastMACs, dev.MAC)
		}
		if slices.Contains(dev.Tags, "kiosk") && dev.MAC != "" {
			fireMACs = append(fireMACs, dev.MAC)
		}
		if (dev.ID == "den-atomberg-fan" || slices.Contains(dev.Hostnames, "den-atomberg-fan")) && dev.MAC != "" {
			atombergMACs = append(atombergMACs, dev.MAC)
		}
		if dev.ID == "home-assistant" || slices.Contains(dev.Hostnames, "home-assistant") {
			if dev.IP != "" {
				haIPs = append(haIPs, dev.IP)
			}
			if dev.MAC != "" {
				haMACs = append(haMACs, dev.MAC)
			}
		}
		if (dev.ID == "bless-mac-wired" || slices.Contains(dev.Hostnames, "bless-mac-wired")) && dev.IP != "" {
			blessMacIPs = append(blessMacIPs, dev.IP)
		}
	}

	formatSet := func(name string, setType string, elements []string) string {
		if len(elements) == 0 {
			return fmt.Sprintf("set %s {\n  typeof %s\n}\n", name, setType)
		}
		return fmt.Sprintf("set %s {\n  typeof %s\n  elements = {\n    %s\n  }\n}\n",
			name, setType, strings.Join(elements, ",\n    "))
	}

	setsNFT := strings.Join([]string{
		"# Generated by lanpilot -- DO NOT EDIT DIRECTLY\n",
		formatSet("iot_devices_requiring_internet", "ether saddr", iotInternetMACs),
		formatSet("google_chromecast_devices", "ether saddr", chromecastMACs),
		formatSet("amazon_fire", "ether saddr", fireMACs),
		formatSet("atomberg_fan", "ether saddr", atombergMACs),
		formatSet("home_assistant_ips", "ip daddr", haIPs),
		formatSet("home_assistant_macs", "ether saddr", haMACs),
		formatSet("bless_mac_ips", "ip daddr", blessMacIPs),
	}, "\n")

	if err := os.WriteFile(m.nftablesSets, []byte(setsNFT), 0644); err != nil {
		log.Printf("warn: failed writing %s: %v", m.nftablesSets, err)
	}

	// 4. Signal dnsmasq SIGHUP
	m.reloadDnsmasq()

	// 5. Apply nftables sets
	m.reloadNftables()

	return nil
}

func (m *Manager) reloadDnsmasq() {
	// Attempt pkill -HUP dnsmasq or systemctl kill -s HUP dnsmasq
	if _, err := exec.LookPath("systemctl"); err == nil {
		out, err := exec.Command("systemctl", "kill", "-s", "HUP", "dnsmasq").CombinedOutput()
		if err == nil {
			log.Printf("info: successfully sent SIGHUP to dnsmasq via systemctl")
			return
		}
		log.Printf("debug: systemctl kill -s HUP dnsmasq: %v (%s)", err, strings.TrimSpace(string(out)))
	}

	if _, err := exec.LookPath("pkill"); err == nil {
		out, err := exec.Command("pkill", "-HUP", "dnsmasq").CombinedOutput()
		if err == nil {
			log.Printf("info: successfully sent SIGHUP to dnsmasq via pkill")
			return
		}
		log.Printf("debug: pkill -HUP dnsmasq: %v (%s)", err, strings.TrimSpace(string(out)))
	}
}

func (m *Manager) reloadNftables() {
	if _, err := exec.LookPath("nft"); err == nil {
		out, err := exec.Command("nft", "-f", m.nftablesSets).CombinedOutput()
		if err != nil {
			log.Printf("warn: nft -f %s failed: %v (%s)", m.nftablesSets, err, strings.TrimSpace(string(out)))
			return
		}
		log.Printf("info: successfully reloaded nftables sets from %s", m.nftablesSets)
	}
}

func (m *Manager) StartWatcher(ctx context.Context) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create watcher: %w", err)
	}

	dir := filepath.Dir(m.devicesPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}

	if err := watcher.Add(dir); err != nil {
		return fmt.Errorf("watch %s: %w", dir, err)
	}

	go func() {
		defer watcher.Close()
		var debounceTimer *time.Timer
		var debounceMu sync.Mutex

		triggerReload := func() {
			debounceMu.Lock()
			defer debounceMu.Unlock()
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.AfterFunc(200*time.Millisecond, func() {
				info, err := os.Stat(m.devicesPath)
				if err != nil {
					return
				}
				m.mu.Lock()
				if !info.ModTime().After(m.lastExternalModTime) {
					m.mu.Unlock()
					return
				}
				m.mu.Unlock()

				log.Printf("info: detected change to %s, reloading dnsmasq and nftables...", m.devicesPath)
				if err := m.Load(); err != nil {
					log.Printf("warn: failed reloading %s: %v", m.devicesPath, err)
					return
				}
				m.mu.Lock()
				_ = m.renderAndReloadLocked()
				m.mu.Unlock()
			})
		}

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if filepath.Clean(event.Name) == filepath.Clean(m.devicesPath) {
					if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) != 0 {
						triggerReload()
					}
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("warn: file watcher error: %v", err)
			}
		}
	}()

	log.Printf("info: file watcher active on %s", m.devicesPath)
	return nil
}

// In-memory CRUD methods

func (m *Manager) GetDevices() []Device {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]Device, len(m.cfg.Devices))
	copy(res, m.cfg.Devices)
	return res
}

func (m *Manager) UpsertDevice(dev Device) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	found := false
	for i, existing := range m.cfg.Devices {
		if existing.ID == dev.ID || (dev.MAC != "" && existing.MAC == dev.MAC && existing.Vlan == dev.Vlan) {
			m.cfg.Devices[i] = dev
			found = true
			break
		}
	}
	if !found {
		m.cfg.Devices = append(m.cfg.Devices, dev)
	}

	return m.saveAndApplyLocked()
}

func (m *Manager) DeleteDevice(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := -1
	for i, existing := range m.cfg.Devices {
		if existing.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("device not found: %s", id)
	}

	m.cfg.Devices = append(m.cfg.Devices[:idx], m.cfg.Devices[idx+1:]...)
	return m.saveAndApplyLocked()
}

func (m *Manager) GetDnsRecords() []DnsRecord {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]DnsRecord, len(m.cfg.DnsRecords))
	copy(res, m.cfg.DnsRecords)
	return res
}

func (m *Manager) UpsertDnsRecord(rec DnsRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	found := false
	for i, existing := range m.cfg.DnsRecords {
		if existing.Name == rec.Name {
			m.cfg.DnsRecords[i] = rec
			found = true
			break
		}
	}
	if !found {
		m.cfg.DnsRecords = append(m.cfg.DnsRecords, rec)
	}

	return m.saveAndApplyLocked()
}

func (m *Manager) DeleteDnsRecord(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := -1
	for i, existing := range m.cfg.DnsRecords {
		if existing.Name == name {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("dns record not found: %s", name)
	}

	m.cfg.DnsRecords = append(m.cfg.DnsRecords[:idx], m.cfg.DnsRecords[idx+1:]...)
	return m.saveAndApplyLocked()
}
