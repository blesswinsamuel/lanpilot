import { useState, useMemo, useDeferredValue } from 'react'
import {
  Search,
  Laptop,
  ArrowDown,
  ArrowUp,
  Network,
  ChevronRight,
  HelpCircle,
  Globe,
  HardDrive,
  PieChart as PieChartIcon,
  XCircle,
  Power,
  Pencil,
  Plus,
  Tag,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn } from '@/lib/utils'
import { DeviceTrafficCharts } from './DeviceTrafficCharts'
import { EditDeviceModal } from './EditDeviceModal'
import {
  formatBytes,
  formatRate,
  formatPacketsRate,
  formatRelativeTime,
  formatDateTime,
} from '@/lib/format'
import { useNavigate } from 'react-router-dom'
import { getDeviceCategory } from '@/lib/device-icons'
import { rpcClient } from '@/lib/client'
import type { Device } from '@/gen/lanpilot/v1/lanpilot_pb'

import { useRootOutletContext } from './RootLayout'

interface DevicesTabProps {
  devices: Device[]
}

export function DevicesTab({ devices }: DevicesTabProps) {
  const { period, fetchAllData } = useRootOutletContext()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [selectedInterface, setSelectedInterface] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'offline'>('all')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  const [trafficScope, setTrafficScope] = useState<'total' | 'wan' | 'lan' | 'split'>('total')
  const [showUnknownOnly, setShowUnknownOnly] = useState(false)
  const [selectedDeviceIp, setSelectedDeviceIp] = useState<string | null>(null)
  const [showCharts, setShowCharts] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDevice, setEditingDevice] = useState<Device | null>(null)
  const [wakingMacs, setWakingMacs] = useState<Record<string, 'loading' | 'success' | 'error'>>({})
  const navigate = useNavigate()

  async function handleQuickWol(e: React.MouseEvent, device: Device) {
    e.stopPropagation()
    if (!device.macAddr || device.macAddr === '00:00:00:00:00:00') return
    const mac = device.macAddr
    setWakingMacs((prev) => ({ ...prev, [mac]: 'loading' }))
    try {
      const res = await rpcClient.wakeOnLan({
        macAddr: mac,
        ipAddr: device.ipAddr,
        interface: device.interface || device.arp?.interface || '',
      })
      if (res.success) {
        setWakingMacs((prev) => ({ ...prev, [mac]: 'success' }))
        setTimeout(() => {
          setWakingMacs((prev) => {
            const next = { ...prev }
            delete next[mac]
            return next
          })
        }, 3000)
      } else {
        setWakingMacs((prev) => ({ ...prev, [mac]: 'error' }))
      }
    } catch {
      setWakingMacs((prev) => ({ ...prev, [mac]: 'error' }))
    }
  }

  const activeDeviceList = devices

  // Count unknown devices (devices not configured in devices.yaml)
  const unknownCount = useMemo(() => {
    return activeDeviceList.filter((d) => !d.isConfigured).length
  }, [activeDeviceList])

  // Extract unique interface names
  const interfaces = useMemo(() => {
    const set = new Set<string>()
    for (const d of activeDeviceList) {
      set.add(d.interface || d.arp?.interface || 'lan')
    }
    return Array.from(set).sort()
  }, [activeDeviceList])

  // Count devices per interface
  const interfaceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const d of activeDeviceList) {
      const iface = d.interface || d.arp?.interface || 'lan'
      counts[iface] = (counts[iface] || 0) + 1
    }
    return counts
  }, [activeDeviceList])

  // Count devices by status
  const statusCounts = useMemo(() => {
    let active = 0
    let offline = 0
    for (const d of activeDeviceList) {
      const s = d.status || (d.arp?.isValid ? 'active' : 'unreachable')
      if (s === 'active' || s === 'static') {
        active++
      } else if (s === 'offline') {
        offline++
      }
    }
    return { active, offline, all: activeDeviceList.length }
  }, [activeDeviceList])

  // Extract unique tags across devices
  const availableTags = useMemo(() => {
    const set = new Set<string>()
    for (const d of activeDeviceList) {
      if (d.tags) {
        for (const t of d.tags) {
          if (t) set.add(t)
        }
      }
    }
    return Array.from(set).sort()
  }, [activeDeviceList])

  // Fallback to 'all' if selected interface is no longer present
  const currentInterface =
    selectedInterface === 'all' || interfaces.includes(selectedInterface)
      ? selectedInterface
      : 'all'

  const filtered = useMemo(() => {
    return activeDeviceList.filter((d) => {
      if (selectedDeviceIp && d.ipAddr !== selectedDeviceIp) {
        return false
      }

      const iface = d.interface || d.arp?.interface || 'lan'
      if (currentInterface !== 'all' && iface !== currentInterface) {
        return false
      }

      const s = d.status || (d.arp?.isValid ? 'active' : 'unreachable')
      if (statusFilter === 'active' && s !== 'active' && s !== 'static') {
        return false
      }
      if (statusFilter === 'offline' && s !== 'offline') {
        return false
      }

      if (selectedTag !== 'all' && (!d.tags || !d.tags.includes(selectedTag))) {
        return false
      }

      if (showUnknownOnly && d.isConfigured) {
        return false
      }

      if (!deferredSearch.trim()) return true
      const q = deferredSearch.toLowerCase()
      return (
        d.hostname?.toLowerCase().includes(q) ||
        d.configName?.toLowerCase().includes(q) ||
        d.vlan?.toLowerCase().includes(q) ||
        d.tags?.some((t) => t.toLowerCase().includes(q)) ||
        d.dhcpLease?.hostname?.toLowerCase().includes(q) ||
        d.ipAddr?.toLowerCase().includes(q) ||
        d.macAddr?.toLowerCase().includes(q) ||
        d.interface?.toLowerCase().includes(q) ||
        d.arp?.interface?.toLowerCase().includes(q) ||
        d.vendor?.toLowerCase().includes(q)
      )
    })
  }, [activeDeviceList, currentInterface, statusFilter, selectedTag, showUnknownOnly, deferredSearch, selectedDeviceIp])

  const totalDl = activeDeviceList.reduce((acc, d) => acc + Number(d.total?.downloadBytes || 0), 0)
  const totalUl = activeDeviceList.reduce((acc, d) => acc + Number(d.total?.uploadBytes || 0), 0)
  const filteredDl = filtered.reduce((acc, d) => acc + Number(d.total?.downloadBytes || 0), 0)
  const filteredUl = filtered.reduce((acc, d) => acc + Number(d.total?.uploadBytes || 0), 0)

  return (
    <div className="space-y-6">
      {showCharts && (
        <DeviceTrafficCharts
          devices={activeDeviceList}
          trafficScope={trafficScope}
          selectedDeviceIp={selectedDeviceIp}
          onSelectDevice={setSelectedDeviceIp}
          period={period}
        />
      )}

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Laptop className="w-5 h-5 text-primary" />
                Connected & Discovered Devices
              </CardTitle>
              <CardDescription>
                Inspect real-time rates (bytes/s & pps) and period-accurate bandwidth from SQLite TSDB. Click any row for details.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCharts((prev) => !prev)}
                className="h-9 text-xs gap-1.5 shrink-0"
              >
                <PieChartIcon className="w-3.5 h-3.5 text-primary" />
                <span>{showCharts ? 'Hide Charts' : 'Show Charts'}</span>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditingDevice(null)
                  setModalOpen(true)
                }}
                className="h-9 text-xs gap-1.5 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Reservation</span>
              </Button>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by IP, MAC, Hostname..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
            <div className="flex flex-wrap items-center gap-3">
              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground shrink-0">Status:</span>
                <Tabs value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)} className="shrink-0">
                  <TabsList className="h-8">
                    <TabsTrigger value="all" className="text-xs px-2.5 py-1">
                      All (<span className="font-mono">{statusCounts.all}</span>)
                    </TabsTrigger>
                    <TabsTrigger value="active" className="text-xs px-2.5 py-1">
                      Active (<span className="font-mono">{statusCounts.active}</span>)
                    </TabsTrigger>
                    {statusCounts.offline > 0 && (
                      <TabsTrigger value="offline" className="text-xs px-2.5 py-1">
                        Offline (<span className="font-mono">{statusCounts.offline}</span>)
                      </TabsTrigger>
                    )}
                  </TabsList>
                </Tabs>
              </div>

              {/* Tag Filter */}
              {availableTags.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground shrink-0 flex items-center gap-1">
                    <Tag className="w-3 h-3 text-muted-foreground" />
                    Tag:
                  </span>
                  <Tabs value={selectedTag} onValueChange={(v: any) => setSelectedTag(v)} className="shrink-0">
                    <TabsList className="h-8">
                      <TabsTrigger value="all" className="text-xs px-2 py-1">
                        All
                      </TabsTrigger>
                      {availableTags.map((t) => (
                        <TabsTrigger key={t} value={t} className="text-xs px-2 py-1">
                          {t}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              )}

              {/* Unknown Only Quick Filter */}
              <Button
                variant={showUnknownOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setShowUnknownOnly((prev) => !prev)}
                className={cn(
                  "h-8 text-xs gap-1.5 shrink-0 transition-all",
                  showUnknownOnly
                    ? "bg-amber-600 hover:bg-amber-700 text-white border-amber-600 shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={showUnknownOnly ? "Showing unknown devices only. Click to show all." : "Show only unknown devices (not configured in devices.yaml)"}
              >
                <HelpCircle className={cn("w-3.5 h-3.5", showUnknownOnly ? "text-white" : "text-amber-500")} />
                <span>Unknown Only</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                    showUnknownOnly
                      ? "bg-white/20 text-white font-semibold"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {unknownCount}
                </span>
              </Button>

              {/* Active Device Filter Chip */}
              {selectedDeviceIp && (
                <Badge
                  variant="secondary"
                  className="text-xs gap-1.5 cursor-pointer hover:bg-destructive/15 hover:text-destructive transition-colors py-1 px-2.5"
                  onClick={() => setSelectedDeviceIp(null)}
                  title="Click to clear device filter"
                >
                  <span>Device: {selectedDeviceIp}</span>
                  <XCircle className="w-3.5 h-3.5" />
                </Badge>
              )}

              {/* Unknown Filter Active Chip */}
              {showUnknownOnly && (
                <Badge
                  variant="secondary"
                  className="text-xs gap-1.5 cursor-pointer hover:bg-destructive/15 hover:text-destructive transition-colors py-1 px-2.5 border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  onClick={() => setShowUnknownOnly(false)}
                  title="Click to show all devices"
                >
                  <span>Filter: Unknown Only</span>
                  <XCircle className="w-3.5 h-3.5" />
                </Badge>
              )}

              {/* Traffic Scope Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground shrink-0">Traffic Scope:</span>
                <Tabs value={trafficScope} onValueChange={(v: any) => setTrafficScope(v)} className="shrink-0">
                  <TabsList className="h-8">
                    <TabsTrigger value="total" className="text-xs px-2.5 py-1 flex items-center gap-1.5">
                      <HardDrive className="w-3 h-3" />
                      <span>Total</span>
                    </TabsTrigger>
                    <TabsTrigger value="wan" className="text-xs px-2.5 py-1 flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-emerald-500" />
                      <span>WAN (Internet)</span>
                    </TabsTrigger>
                    <TabsTrigger value="lan" className="text-xs px-2.5 py-1 flex items-center gap-1.5">
                      <Network className="w-3 h-3 text-blue-500" />
                      <span>LAN (Local)</span>
                    </TabsTrigger>
                    <TabsTrigger value="split" className="text-xs px-2.5 py-1">
                      All (Split)
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {/* Interface Tabs */}
            {interfaces.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 shrink-0">
                  <Network className="w-3.5 h-3.5" />
                  <span>Interface:</span>
                </div>
                <Tabs value={currentInterface} onValueChange={setSelectedInterface} className="shrink-0">
                  <TabsList className="h-8">
                    <TabsTrigger value="all" className="text-xs px-2.5 py-1 flex items-center gap-1.5">
                      <span>All</span>
                      <span
                        className={cn(
                          "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                          currentInterface === 'all'
                            ? "bg-primary/15 text-primary font-semibold"
                            : "bg-muted-foreground/15 text-muted-foreground"
                        )}
                      >
                        {activeDeviceList.length}
                      </span>
                    </TabsTrigger>
                    {interfaces.map((iface) => (
                      <TabsTrigger
                        key={iface}
                        value={iface}
                        className="text-xs px-2.5 py-1 flex items-center gap-1.5"
                      >
                        <span>{iface}</span>
                        <span
                          className={cn(
                            "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                            currentInterface === iface
                              ? "bg-primary/15 text-primary font-semibold"
                              : "bg-muted-foreground/15 text-muted-foreground"
                          )}
                        >
                          {interfaceCounts[iface] || 0}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                {trafficScope !== 'split' ? (
                  <TableRow>
                    <TableHead>Hostname / Name</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Interface</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        Current Rate {trafficScope === 'wan' ? '(WAN)' : trafficScope === 'lan' ? '(LAN)' : '(Total)'}
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        Bandwidth Used (<span className="font-mono">{period}</span>)
                      </span>
                    </TableHead>
                    <TableHead className="w-16 text-right"></TableHead>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableHead>Hostname / Name</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <Globe className="w-3.5 h-3.5" /> WAN (<span className="font-mono">{period}</span>)
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <Network className="w-3.5 h-3.5" /> LAN (<span className="font-mono">{period}</span>)
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <HardDrive className="w-3.5 h-3.5" /> Total (<span className="font-mono">{period}</span>)
                      </span>
                    </TableHead>
                    <TableHead className="w-16 text-right"></TableHead>
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={trafficScope === 'split' ? 8 : 8} className="h-24 text-center text-muted-foreground">
                      {activeDeviceList.length === 0
                        ? "No devices detected or stored yet."
                        : currentInterface !== 'all' && !search
                          ? `No devices detected on interface "${currentInterface}".`
                          : "No devices matching filter criteria."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((device, idx) => {
                    const status = device.status || (device.arp?.isValid ? 'active' : 'unreachable')
                    const isOnline = status === 'active' || status === 'static'
                    const firstSeen = Number(device.firstSeenUnix || 0)
                    const lastSeen = Number(device.lastSeenUnix || 0)
                    const hasSeenInfo = lastSeen > 0 || firstSeen > 0 || status === 'unreachable'

                    const activeTraffic = trafficScope === 'wan' ? device.wan : trafficScope === 'lan' ? device.lan : device.total
                    const activeDlRate = Number(activeTraffic?.downloadBytesPerSec || 0)
                    const activeUlRate = Number(activeTraffic?.uploadBytesPerSec || 0)
                    const activeDlPktsRate = Number(activeTraffic?.downloadPacketsPerSec || 0)
                    const activeUlPktsRate = Number(activeTraffic?.uploadPacketsPerSec || 0)
                    const activeDlBytes = Number(activeTraffic?.downloadBytes || 0)
                    const activeUlBytes = Number(activeTraffic?.uploadBytes || 0)

                    // Individual scope metrics
                    const totalDlBytes = Number(device.total?.downloadBytes || 0)
                    const totalUlBytes = Number(device.total?.uploadBytes || 0)
                    const totalDlRate = Number(device.total?.downloadBytesPerSec || 0)
                    const totalUlRate = Number(device.total?.uploadBytesPerSec || 0)

                    const wanDlBytes = Number(device.wan?.downloadBytes || 0)
                    const wanUlBytes = Number(device.wan?.uploadBytes || 0)
                    const wanDlRate = Number(device.wan?.downloadBytesPerSec || 0)
                    const wanUlRate = Number(device.wan?.uploadBytesPerSec || 0)

                    const lanDlBytes = Number(device.lan?.downloadBytes || 0)
                    const lanUlBytes = Number(device.lan?.uploadBytes || 0)
                    const lanDlRate = Number(device.lan?.downloadBytesPerSec || 0)
                    const lanUlRate = Number(device.lan?.uploadBytesPerSec || 0)

                    const { icon: RowIcon } = getDeviceCategory(device.hostname, device.vendor)

                    return (
                      <TableRow
                        key={`${device.ipAddr}-${idx}`}
                        onClick={() => navigate(`/devices/${encodeURIComponent(device.ipAddr)}`)}
                        className="cursor-pointer hover:bg-muted/40 transition-colors group"
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-md bg-muted/60 text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors shrink-0">
                              <RowIcon className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5 flex-wrap">
                                <span>{device.configName || device.hostname || (device.vendor ? `${device.vendor} Device` : 'Unknown Device')}</span>
                                {device.vlan && (
                                  <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 border-primary/30 text-primary">
                                    {device.vlan}
                                  </Badge>
                                )}
                                {device.isConfigured ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-normal px-1.5 py-0"
                                    title="Configured device in devices.yaml"
                                  >
                                    Configured
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-normal px-1.5 py-0"
                                    title="Unmanaged device not defined in devices.yaml"
                                  >
                                    {device.dhcpLease?.hostname || device.hostname ? 'Dynamic • DHCP' : 'Unmanaged'}
                                  </Badge>
                                )}
                              </span>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                                <span>{device.ipAddr}</span>
                                {device.configName && device.hostname && device.hostname !== device.configName && (
                                  <>
                                    <span>•</span>
                                    <span className="text-[11px] text-muted-foreground/80 font-sans">{device.hostname}</span>
                                  </>
                                )}
                                {device.vendor && (
                                  <>
                                    <span>•</span>
                                    <span className="text-[11px] text-muted-foreground/80 font-sans truncate max-w-[150px]">
                                      {device.vendor}
                                    </span>
                                  </>
                                )}
                              </div>
                              {device.tags && device.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {device.tags.map((t) => (
                                    <Badge key={t} variant="secondary" className="text-[9px] font-mono px-1.5 py-0">
                                      {t}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{device.ipAddr}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{device.macAddr}</TableCell>
                        {trafficScope !== 'split' && (
                          <TableCell className="font-mono text-xs">
                            <div className="flex flex-col gap-1 items-start">
                              <Badge variant="outline">{device.interface || device.arp?.interface || 'lan'}</Badge>
                              {device.vlan && (
                                <span className="text-[10px] text-muted-foreground font-mono">{device.vlan}</span>
                              )}
                            </div>
                          </TableCell>
                        )}
                        <TableCell>
                          <div
                            className="flex flex-col items-start gap-1 cursor-default"
                            title={
                              hasSeenInfo
                                ? [
                                    status === 'unreachable' ? 'ARP probe sent, but no response received' : '',
                                    lastSeen > 0 ? `Last seen: ${formatRelativeTime(lastSeen)} (${formatDateTime(lastSeen)})` : '',
                                    firstSeen > 0 ? `First seen: ${formatRelativeTime(firstSeen)} (${formatDateTime(firstSeen)})` : '',
                                  ]
                                    .filter(Boolean)
                                    .join('\n')
                                : undefined
                            }
                          >
                            {status === 'active' && (
                              <Badge
                                variant="outline"
                                className="text-[11px] border-emerald-500/20 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              >
                                Active
                              </Badge>
                            )}
                            {status === 'static' && (
                              <Badge
                                variant="outline"
                                className="text-[11px] border-sky-500/20 bg-sky-500/15 text-sky-600 dark:text-sky-400"
                              >
                                Static
                              </Badge>
                            )}
                            {status === 'unreachable' && (
                              <Badge
                                variant="secondary"
                                className="text-[11px] border-amber-500/20 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              >
                                <span className="flex items-center gap-1">
                                  Unreachable
                                  <HelpCircle className="w-2.5 h-2.5 opacity-60" />
                                </span>
                              </Badge>
                            )}
                            {status === 'offline' && (
                              <Badge
                                variant="secondary"
                                className="text-[11px] text-muted-foreground bg-muted"
                              >
                                Offline
                              </Badge>
                            )}
                            {(status === 'active' || status === 'static') && firstSeen > 0 && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                First seen {formatRelativeTime(firstSeen)}
                              </span>
                            )}
                            {(status === 'offline' || status === 'unreachable') && lastSeen > 0 && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                Last seen {formatRelativeTime(lastSeen)}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {trafficScope !== 'split' ? (
                          <>
                            {/* Current Rate Column */}
                            <TableCell className="text-right font-mono">
                              {isOnline && (activeDlRate > 0 || activeUlRate > 0) ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium text-xs flex items-center gap-1">
                                    <ArrowDown className="w-3 h-3 text-emerald-500" />
                                    {formatRate(activeDlRate)}
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                      ({formatPacketsRate(activeDlPktsRate)})
                                    </span>
                                  </span>
                                  <span className="text-sky-600 dark:text-sky-400 font-medium text-xs flex items-center gap-1">
                                    <ArrowUp className="w-3 h-3 text-sky-500" />
                                    {formatRate(activeUlRate)}
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                      ({formatPacketsRate(activeUlPktsRate)})
                                    </span>
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">Idle</span>
                              )}
                            </TableCell>

                            {/* Bandwidth Used Column */}
                            <TableCell className="text-right font-mono">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-foreground font-semibold text-xs flex items-center gap-1">
                                  <span className="text-emerald-500 font-bold">↓</span>
                                  {formatBytes(activeDlBytes)}
                                </span>
                                <span className="text-foreground font-semibold text-xs flex items-center gap-1">
                                  <span className="text-sky-500 font-bold">↑</span>
                                  {formatBytes(activeUlBytes)}
                                </span>
                                {trafficScope === 'total' && (wanDlBytes + wanUlBytes > 0 || lanDlBytes + lanUlBytes > 0) && (
                                  <span className="text-[10px] text-muted-foreground/80 flex items-center gap-1 mt-0.5 font-mono">
                                    <span className="text-emerald-600 dark:text-emerald-400">WAN {formatBytes(wanDlBytes + wanUlBytes)}</span>
                                    <span>•</span>
                                    <span className="text-blue-600 dark:text-blue-400">LAN {formatBytes(lanDlBytes + lanUlBytes)}</span>
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            {/* WAN Column */}
                            <TableCell className="text-right font-mono">
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="text-xs font-semibold text-foreground">
                                  ↓ {formatBytes(wanDlBytes)} ↑ {formatBytes(wanUlBytes)}
                                </div>
                                {(wanDlRate > 0 || wanUlRate > 0) ? (
                                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                    Rate: ↓{formatRate(wanDlRate)} ↑{formatRate(wanUlRate)}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground/60">
                                    Idle
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            {/* LAN Column */}
                            <TableCell className="text-right font-mono">
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="text-xs font-semibold text-foreground">
                                  ↓ {formatBytes(lanDlBytes)} ↑ {formatBytes(lanUlBytes)}
                                </div>
                                {(lanDlRate > 0 || lanUlRate > 0) ? (
                                  <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                                    Rate: ↓{formatRate(lanDlRate)} ↑{formatRate(lanUlRate)}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground/60">
                                    Idle
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            {/* Total Column */}
                            <TableCell className="text-right font-mono">
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="text-xs font-semibold text-foreground">
                                  ↓ {formatBytes(totalDlBytes)} ↑ {formatBytes(totalUlBytes)}
                                </div>
                                {(totalDlRate > 0 || totalUlRate > 0) ? (
                                  <div className="text-[10px] text-primary font-medium">
                                    Rate: ↓{formatRate(totalDlRate)} ↑{formatRate(totalUlRate)}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground/60">
                                    Idle
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </>
                        )}

                        <TableCell className="text-right p-0 pr-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                              title={device.configName ? 'Edit DHCP Reservation & Tags' : 'Add DHCP Reservation'}
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingDevice(device)
                                setModalOpen(true)
                              }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>

                            {device.macAddr && device.macAddr !== '00:00:00:00:00:00' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                                title={
                                  wakingMacs[device.macAddr] === 'loading'
                                    ? 'Sending Magic Packet...'
                                    : wakingMacs[device.macAddr] === 'success'
                                    ? 'Magic Packet Sent!'
                                    : wakingMacs[device.macAddr] === 'error'
                                    ? 'Failed to send packet'
                                    : 'Wake on LAN (Send Magic Packet)'
                                }
                                onClick={(e) => handleQuickWol(e, device)}
                                disabled={wakingMacs[device.macAddr] === 'loading'}
                              >
                                <Power className={cn(
                                  "w-3.5 h-3.5",
                                  wakingMacs[device.macAddr] === 'loading' && "animate-spin text-amber-500",
                                  wakingMacs[device.macAddr] === 'success' && "text-emerald-500",
                                  wakingMacs[device.macAddr] === 'error' && "text-destructive"
                                )} />
                              </Button>
                            )}
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted-foreground px-1">
            <span>
              Showing {filtered.length} of {activeDeviceList.length} {activeDeviceList.length === 1 ? 'device' : 'devices'}
              {currentInterface !== 'all' && ` (interface: ${currentInterface})`}
              {statusFilter !== 'all' && ` (${statusFilter})`}
              {trafficScope !== 'total' && ` [Scope: ${trafficScope.toUpperCase()}]`}
              {` [Period: ${period}]`}
            </span>
            <span>
              Total Volume ({period}): <span className="font-semibold text-foreground">{formatBytes(totalDl + totalUl)}</span>
              {filtered.length < activeDeviceList.length && (
                <span className="ml-1.5 text-muted-foreground">
                  (Filtered: <strong className="text-foreground">{formatBytes(filteredDl + filteredUl)}</strong>)
                </span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      <EditDeviceModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        device={editingDevice}
        onSaved={fetchAllData}
      />
    </div>
  )
}
