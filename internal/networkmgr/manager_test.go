package networkmgr

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNetworkMgr_RenderFiles(t *testing.T) {
	tmpDir := t.TempDir()
	devicesPath := filepath.Join(tmpDir, "devices.yaml")
	dhcpHostsPath := filepath.Join(tmpDir, "dnsmasq.dhcp-hosts")
	hostsPath := filepath.Join(tmpDir, "dnsmasq.hosts")
	nftSetsPath := filepath.Join(tmpDir, "nftables-sets.nft")

	mgr, err := NewManager(Options{
		DevicesPath:          devicesPath,
		DnsmasqDhcpHostsPath: dhcpHostsPath,
		DnsmasqHostsPath:     hostsPath,
		NftablesSetsPath:     nftSetsPath,
		SearchDomain:         "home.lan",
	})
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	// 1. Add devices with tags and VLANs
	err = mgr.UpsertDevice(Device{
		ID:        "appletv",
		Name:      "Apple TV",
		MAC:       "aa:bb:cc:dd:ee:01",
		Vlan:      "trusted",
		IP:        "10.100.1.20",
		Hostnames: []string{"appletv", "living-room-appletv"},
		Tags:      []string{"cast_target"},
	})
	if err != nil {
		t.Fatalf("UpsertDevice failed: %v", err)
	}

	err = mgr.UpsertDevice(Device{
		ID:        "camera-front",
		Name:      "Front Camera",
		MAC:       "aa:bb:cc:dd:ee:02",
		Vlan:      "cameras",
		IP:        "10.100.3.10",
		Hostnames: []string{"camera-front"},
		Tags:      []string{"allow_internet"},
	})
	if err != nil {
		t.Fatalf("UpsertDevice failed: %v", err)
	}

	// 2. Add DNS records
	err = mgr.UpsertDnsRecord(DnsRecord{
		Name:    "photos",
		IP:      "10.100.1.200",
		Aliases: []string{"photos.home.lan", "immich.home.lan"},
	})
	if err != nil {
		t.Fatalf("UpsertDnsRecord failed: %v", err)
	}

	// 3. Verify dhcp-hosts file content
	dhcpData, err := os.ReadFile(dhcpHostsPath)
	if err != nil {
		t.Fatalf("ReadFile dhcp-hosts failed: %v", err)
	}
	dhcpStr := string(dhcpData)
	if !strings.Contains(dhcpStr, "tag:trusted,aa:bb:cc:dd:ee:01,10.100.1.20,appletv") {
		t.Errorf("missing expected appletv entry in dhcp-hosts: %s", dhcpStr)
	}
	if !strings.Contains(dhcpStr, "tag:cameras,aa:bb:cc:dd:ee:02,10.100.3.10,camera-front") {
		t.Errorf("missing expected camera entry in dhcp-hosts: %s", dhcpStr)
	}

	// 4. Verify dnsmasq hosts file content
	hostsData, err := os.ReadFile(hostsPath)
	if err != nil {
		t.Fatalf("ReadFile hosts failed: %v", err)
	}
	hostsStr := string(hostsData)
	if !strings.Contains(hostsStr, "10.100.1.20\tappletv living-room-appletv") {
		t.Errorf("missing expected appletv entry in hosts: %s", hostsStr)
	}
	if !strings.Contains(hostsStr, "10.100.1.200\tphotos photos.home.lan immich.home.lan") {
		t.Errorf("missing expected photos record in hosts: %s", hostsStr)
	}

	// 5. Verify nftables sets file content
	nftData, err := os.ReadFile(nftSetsPath)
	if err != nil {
		t.Fatalf("ReadFile nftables-sets failed: %v", err)
	}
	nftStr := string(nftData)
	if !strings.Contains(nftStr, "set google_chromecast_devices {") || !strings.Contains(nftStr, "aa:bb:cc:dd:ee:01") {
		t.Errorf("missing aa:bb:cc:dd:ee:01 in google_chromecast_devices set: %s", nftStr)
	}
	if !strings.Contains(nftStr, "set iot_devices_requiring_internet {") || !strings.Contains(nftStr, "aa:bb:cc:dd:ee:02") {
		t.Errorf("missing aa:bb:cc:dd:ee:02 in iot_devices_requiring_internet set: %s", nftStr)
	}

	// 6. Test delete device
	if err := mgr.DeleteDevice("appletv"); err != nil {
		t.Fatalf("DeleteDevice failed: %v", err)
	}
	devs := mgr.GetDevices()
	if len(devs) != 1 {
		t.Errorf("expected 1 device after delete, got %d", len(devs))
	}

	// Verify dhcp-hosts regenerated without appletv
	dhcpDataAfter, _ := os.ReadFile(dhcpHostsPath)
	if strings.Contains(string(dhcpDataAfter), "appletv") {
		t.Errorf("appletv should have been removed from dhcp-hosts")
	}
}
