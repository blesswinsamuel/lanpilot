import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Globe,
  Network,
  HardDrive,
  Clock,
  Activity,
  Shield,
  Copy,
  Check,
  Radio,
  Layers,
  Share2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RefreshCw,
  Info,
  Calendar,
  Hash,
  Power,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  formatBytes,
  formatRate,
  formatPacketsRate,
  formatRelativeTime,
  formatDateTime,
  formatChartTime,
} from '@/lib/format'
import { rpcClient } from '@/lib/client'
import { useRootOutletContext } from '@/components/RootLayout'
import { getDeviceCategory, isLocallyAdministeredMac } from '@/lib/device-icons'
import { getPeriodRange } from '@/lib/period'
import type { Device, PingDeviceResponse, WakeOnLanResponse, ProtocolTraffic, PeerTraffic } from '@/gen/lanpilot/v1/lanpilot_pb'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'

const deviceChartConfig = {
  download: {
    label: 'Download (Ingress)',
    color: '#10b981',
  },
  upload: {
    label: 'Upload (Egress)',
    color: '#0ea5e9',
  },
} satisfies ChartConfig

const PROTOCOL_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  TCP: { bg: 'bg-sky-500/15', text: 'text-sky-600 dark:text-sky-400', bar: '#0284c7' },
  UDP: { bg: 'bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400', bar: '#8b5cf6' },
  ICMP: { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', bar: '#f59e0b' },
  IGMP: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', bar: '#10b981' },
  ESP: { bg: 'bg-indigo-500/15', text: 'text-indigo-600 dark:text-indigo-400', bar: '#6366f1' },
  GRE: { bg: 'bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400', bar: '#06b6d4' },
  OTHER: { bg: 'bg-slate-500/15', text: 'text-slate-600 dark:text-slate-400', bar: '#64748b' },
}

export function DeviceDetailPage() {
  const { ip } = useParams<{ ip: string }>()
  const { devices, isRefreshing, period } = useRootOutletContext()

  const [chartScope, setChartScope] = useState<'total' | 'wan' | 'lan'>('total')
  const [loading, setLoading] = useState(true)
  const [historyData, setHistoryData] = useState<{ time: string; download: number; upload: number }[]>([])
  const [fetchedDevice, setFetchedDevice] = useState<Device | null>(null)
  const [copiedField, setCopiedField] = useState<'ip' | 'mac' | null>(null)

  // Ping test state
  const [pingLoading, setPingLoading] = useState(false)
  const [pingResult, setPingResult] = useState<PingDeviceResponse | null>(null)
  const [pingError, setPingError] = useState<string | null>(null)

  // Wake-on-LAN state
  const [wolLoading, setWolLoading] = useState(false)
  const [wolResult, setWolResult] = useState<WakeOnLanResponse | null>(null)
  const [wolError, setWolError] = useState<string | null>(null)

  // Look up device from root context first
  const contextDevice = useMemo(() => {
    if (!ip) return null
    return devices.find((d) => d.ipAddr === ip) || null
  }, [devices, ip])

  const device = fetchedDevice || contextDevice

  const canWakeOnLan = useMemo(() => {
    return Boolean(
      device?.macAddr &&
      device.macAddr !== '00:00:00:00:00:00' &&
      device.macAddr.trim() !== ''
    )
  }, [device?.macAddr])

  const isRandomized = useMemo(() => {
    return isLocallyAdministeredMac(device?.macAddr)
  }, [device?.macAddr])

  const { icon: DeviceIcon, label: categoryLabel } = useMemo(() => {
    return getDeviceCategory(device?.hostname, device?.vendor)
  }, [device?.hostname, device?.vendor])

  // Ping diagnosis styling
  const pingQuality = useMemo(() => {
    if (!pingResult) return null
    if (!pingResult.isReachable || pingResult.packetLossRatio === 1) {
      return { label: 'Unreachable', color: 'text-destructive', badgeBg: 'border-destructive/20 bg-destructive/15 text-destructive' }
    }
    if (pingResult.packetLossRatio > 0) {
      return { label: 'Packet Loss Detected', color: 'text-amber-500', badgeBg: 'border-amber-500/20 bg-amber-500/15 text-amber-600 dark:text-amber-400' }
    }
    const avgMs = pingResult.avgLatencySeconds * 1000
    if (avgMs < 5) {
      return { label: 'Optimal (<5ms)', color: 'text-emerald-500', badgeBg: 'border-emerald-500/20 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' }
    }
    if (avgMs < 30) {
      return { label: 'Good (<30ms)', color: 'text-sky-500', badgeBg: 'border-sky-500/20 bg-sky-500/15 text-sky-600 dark:text-sky-400' }
    }
    return { label: 'High Latency', color: 'text-amber-500', badgeBg: 'border-amber-500/20 bg-amber-500/15 text-amber-600 dark:text-amber-400' }
  }, [pingResult])

  async function handleRunPing() {
    if (!ip) return
    setPingLoading(true)
    setPingError(null)
    try {
      const res = await rpcClient.pingDevice({
        ipAddr: ip,
        packetCount: 4,
      })
      setPingResult(res)
    } catch (err: any) {
      setPingError(err?.message || 'Failed to ping device')
    } finally {
      setPingLoading(false)
    }
  }

  async function handleWakeOnLan() {
    if (!device?.macAddr || !canWakeOnLan) return
    setWolLoading(true)
    setWolError(null)
    setWolResult(null)
    try {
      const res = await rpcClient.wakeOnLan({
        macAddr: device.macAddr,
        ipAddr: ip || '',
        interface: device.interface || device.arp?.interface || '',
      })
      if (!res.success) {
        setWolError(res.errorMessage || 'Failed to send Wake-on-LAN packet')
      } else {
        setWolResult(res)
      }
    } catch (err: any) {
      setWolError(err?.message || 'Failed to send Wake-on-LAN packet')
    } finally {
      setWolLoading(false)
    }
  }

  function handleCopy(text: string, field: 'ip' | 'mac') {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  useEffect(() => {
    if (!ip) return

    let active = true

    async function fetchDeviceHistory() {
      setLoading(true)
      try {
        const { fromUnix: from, toUnix: now, stepSeconds: step } = getPeriodRange(period)

        let metricName = 'device_traffic_bytes_rate'
        if (chartScope === 'wan') {
          metricName = 'device_wan_bytes_rate'
        } else if (chartScope === 'lan') {
          metricName = 'device_lan_bytes_rate'
        }

        const [tsRes, devRes] = await Promise.all([
          rpcClient.queryTimeSeries({
            queries: [{
              metricName,
              matchLabels: { ip: ip! },
            }],
            fromUnix: BigInt(from),
            toUnix: BigInt(now),
            stepSeconds: step,
          }),
          rpcClient.listDevices({
            fromUnix: BigInt(from),
            toUnix: BigInt(now),
          }),
        ])

        if (!active) return

        const updated = devRes.devices.find((d) => d.ipAddr === ip)
        if (updated) {
          setFetchedDevice(updated)
        }

        const dlPoints = tsRes.series.find((s) => s.labels['direction'] === 'ingress')?.points || []
        const ulPoints = tsRes.series.find((s) => s.labels['direction'] === 'egress')?.points || []

        const mergedMap = new Map<number, { time: string; download: number; upload: number }>()

        for (const p of dlPoints) {
          const ts = Number(p.timestampUnix)
          const d = new Date(ts * 1000)
          const timeStr = formatChartTime(d, period)
          mergedMap.set(ts, { time: timeStr, download: p.value, upload: 0 })
        }

        for (const p of ulPoints) {
          const ts = Number(p.timestampUnix)
          const entry = mergedMap.get(ts)
          if (entry) {
            entry.upload = p.value
          } else {
            const d = new Date(ts * 1000)
            const timeStr = formatChartTime(d, period)
            mergedMap.set(ts, { time: timeStr, download: 0, upload: p.value })
          }
        }


        const sorted = Array.from(mergedMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, v]) => v)

        setHistoryData(sorted)
      } catch (err) {
        console.error('Failed to load device history:', err)
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchDeviceHistory()

    return () => {
      active = false
    }
  }, [ip, period, chartScope])

  if (!device) {
    if (loading || isRefreshing) {
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/devices" className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium">
              <ArrowLeft className="w-4 h-4" /> Back to Devices
            </Link>
          </div>
          <Card className="text-center py-16 border-dashed">
            <CardContent className="flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading device details...</p>
            </CardContent>
          </Card>
        </div>
      )
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/devices" className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to Devices
          </Link>
        </div>
        <Card className="text-center py-12 border-dashed">
          <CardContent className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <DeviceIcon className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Device Not Found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                No recorded device with IP address <span className="font-mono text-foreground">{ip}</span> was found.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/devices">View All Devices</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const status = device?.status || (device?.arp?.isValid ? 'active' : 'unreachable')
  const isOnline = status === 'active' || status === 'static'

  const totalTraffic = device?.total
  const wanTraffic = device?.wan
  const lanTraffic = device?.lan

  const dlRate = Number(totalTraffic?.downloadBytesPerSec || 0)
  const ulRate = Number(totalTraffic?.uploadBytesPerSec || 0)
  const dlPktsRate = Number(totalTraffic?.downloadPacketsPerSec || 0)
  const ulPktsRate = Number(totalTraffic?.uploadPacketsPerSec || 0)

  const wanDlRate = Number(wanTraffic?.downloadBytesPerSec || 0)
  const wanUlRate = Number(wanTraffic?.uploadBytesPerSec || 0)
  const wanDlPktsRate = Number(wanTraffic?.downloadPacketsPerSec || 0)
  const wanUlPktsRate = Number(wanTraffic?.uploadPacketsPerSec || 0)

  const lanDlRate = Number(lanTraffic?.downloadBytesPerSec || 0)
  const lanUlRate = Number(lanTraffic?.uploadBytesPerSec || 0)
  const lanDlPktsRate = Number(lanTraffic?.downloadPacketsPerSec || 0)
  const lanUlPktsRate = Number(lanTraffic?.uploadPacketsPerSec || 0)

  const internetDl = Number(wanTraffic?.downloadBytes || 0)
  const internetUl = Number(wanTraffic?.uploadBytes || 0)
  const lanDl = Number(lanTraffic?.downloadBytes || 0)
  const lanUl = Number(lanTraffic?.uploadBytes || 0)

  const totalDl = Number(totalTraffic?.downloadBytes || (internetDl + lanDl))
  const totalUl = Number(totalTraffic?.uploadBytes || (internetUl + lanUl))
  const totalDlPkts = Number(totalTraffic?.downloadPackets || 0)
  const totalUlPkts = Number(totalTraffic?.uploadPackets || 0)

  // Protocol traffic calculation
  const protocols = device?.protocols || []
  const totalProtoBytes = protocols.reduce((acc: number, p: ProtocolTraffic) => {
    return acc + Number(p.traffic?.downloadBytes || 0) + Number(p.traffic?.uploadBytes || 0)
  }, 0)

  // Local Peers
  const peers = device?.peers || []

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            to="/devices"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium text-xs sm:text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Devices
          </Link>
          <span>/</span>
          <span className="font-mono text-foreground font-semibold text-xs sm:text-sm">
            {device?.hostname || ip}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleRunPing}
            disabled={pingLoading}
          >
            <Radio className={cn("w-3.5 h-3.5", pingLoading && "animate-spin text-primary")} />
            <span>{pingLoading ? 'Pinging...' : 'Ping Device'}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleWakeOnLan}
            disabled={wolLoading || !canWakeOnLan}
            title={!canWakeOnLan ? "MAC address required for Wake-on-LAN" : "Send Wake-on-LAN magic packet"}
          >
            <Power className={cn("w-3.5 h-3.5", wolLoading ? "animate-spin text-amber-500" : "text-amber-500")} />
            <span>{wolLoading ? 'Waking...' : 'Wake on LAN'}</span>
          </Button>
        </div>
      </div>

      {/* Main Device Identity Card */}
      <Card className="overflow-hidden">
        <CardHeader className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/15">
                <DeviceIcon className="w-7 h-7" />
              </div>
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                    {device?.hostname || (device?.vendor ? `${device.vendor} Device` : 'Unknown Device')}
                  </h2>

                  {/* Known / Unknown Classification Badge */}
                  {device?.isKnown ? (
                    <Badge
                      variant="outline"
                      className="text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
                      title="Verified via static reverse DNS mapping"
                    >
                      Known Device
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                      title="Unmanaged device without static reverse DNS entry"
                    >
                      {device?.dhcpLease?.hostname ? 'Unknown • DHCP' : 'Unknown Device'}
                    </Badge>
                  )}

                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-medium gap-1.5 px-2.5 py-0.5 capitalize',
                      status === 'active' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      status === 'static' && 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
                      status === 'unreachable' && 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                      status === 'offline' && 'border-muted bg-muted text-muted-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        status === 'active' && 'bg-emerald-500 animate-pulse',
                        status === 'static' && 'bg-sky-500',
                        status === 'unreachable' && 'bg-amber-500',
                        status === 'offline' && 'bg-muted-foreground'
                      )}
                    />
                    {status === 'unreachable' ? 'Unreachable' : status}
                  </Badge>

                  {/* Category Pill */}
                  <Badge variant="secondary" className="text-xs font-normal">
                    {categoryLabel}
                  </Badge>

                  {/* Hardware Vendor or MAC Classification Badge */}
                  {device?.vendor ? (
                    <Badge variant="outline" className="text-xs border-primary/25 bg-primary/5 text-primary font-medium">
                      {device.vendor}
                    </Badge>
                  ) : isRandomized ? (
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium cursor-help"
                      title="Locally Administered Address (Private / Randomized Wi-Fi MAC used by iOS, Android, or Windows for privacy)"
                    >
                      Randomized MAC
                    </Badge>
                  ) : (
                    device?.macAddr && device.macAddr !== '00:00:00:00:00:00' && (
                      <Badge variant="outline" className="text-xs text-muted-foreground bg-muted/40 font-normal">
                        Unregistered OUI
                      </Badge>
                    )
                  )}
                </div>

                {/* Device Meta Details Chips */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  {/* DHCP Client Name chip */}
                  {device?.dhcpLease?.hostname && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/60 transition-colors">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">DHCP Name</span>
                      <span className="font-mono font-medium text-foreground">{device.dhcpLease.hostname}</span>
                    </div>
                  )}

                  {/* IP Address chip */}
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 hover:bg-muted/80 border border-border/60 transition-colors">
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">IP</span>
                    <span className="font-mono font-medium text-foreground">{device?.ipAddr || ip}</span>
                    <button
                      type="button"
                      onClick={() => ip && handleCopy(ip, 'ip')}
                      className="text-muted-foreground hover:text-foreground transition-colors ml-0.5 p-0.5 rounded hover:bg-background/80"
                      title="Copy IP address"
                    >
                      {copiedField === 'ip' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* MAC Address chip */}
                  {device?.macAddr && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 hover:bg-muted/80 border border-border/60 transition-colors">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">MAC</span>
                      <span className="font-mono font-medium text-foreground">{device.macAddr}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(device.macAddr, 'mac')}
                        className="text-muted-foreground hover:text-foreground transition-colors ml-0.5 p-0.5 rounded hover:bg-background/80"
                        title="Copy MAC address"
                      >
                        {copiedField === 'mac' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Interface chip */}
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border/40 text-muted-foreground">
                    <Network className="w-3.5 h-3.5 text-primary/70" />
                    <span>Interface:</span>
                    <span className="font-mono font-medium text-foreground">{device?.interface || device?.arp?.interface || 'lan'}</span>
                  </div>

                  {/* Timeline */}
                  {Number(device?.lastSeenUnix) > 0 && (
                    <div
                      className="inline-flex items-center gap-1.5 text-muted-foreground pl-1 cursor-help"
                      title={formatDateTime(Number(device.lastSeenUnix))}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Last seen: <span className="text-foreground font-medium">{formatRelativeTime(Number(device.lastSeenUnix))}</span></span>
                    </div>
                  )}
                  {Number(device?.firstSeenUnix) > 0 && (
                    <div
                      className="inline-flex items-center gap-1.5 text-muted-foreground pl-1 cursor-help"
                      title={formatDateTime(Number(device.firstSeenUnix))}
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>First seen: <span className="text-foreground font-medium">{formatRelativeTime(Number(device.firstSeenUnix))}</span></span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Live Throughput Badge if online */}
            {isOnline && (dlRate > 0 || ulRate > 0) && (
              <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
                {(wanDlRate > 0 || wanUlRate > 0) && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 text-xs font-mono">
                    <Globe className="w-3.5 h-3.5 text-primary" />
                    <span className="text-muted-foreground text-[10px]">WAN:</span>
                    <span className="text-emerald-500 font-semibold">↓ {formatRate(wanDlRate)}</span>
                    <span className="text-sky-500 font-semibold">↑ {formatRate(wanUlRate)}</span>
                  </div>
                )}
                {(lanDlRate > 0 || lanUlRate > 0) && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 text-xs font-mono">
                    <Network className="w-3.5 h-3.5 text-sky-500" />
                    <span className="text-muted-foreground text-[10px]">LAN:</span>
                    <span className="text-emerald-500 font-semibold">↓ {formatRate(lanDlRate)}</span>
                    <span className="text-sky-500 font-semibold">↑ {formatRate(lanUlRate)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Traffic Breakdown Cards (WAN, LAN, Total) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Internet Traffic */}
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-primary" />
                Internet Traffic ({period})
              </span>
              {(wanDlRate > 0 || wanUlRate > 0) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary font-mono">
                  Live: {formatRate(wanDlRate + wanUlRate)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
              <div>
                <span className="text-muted-foreground text-[11px] block">Download</span>
                <span className="font-semibold text-emerald-500 text-base">{formatBytes(internetDl)}</span>
                <span className="text-[10px] text-muted-foreground block">
                  Live: {formatRate(wanDlRate)} ({formatPacketsRate(wanDlPktsRate)})
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-[11px] block">Upload</span>
                <span className="font-semibold text-sky-500 text-base">{formatBytes(internetUl)}</span>
                <span className="text-[10px] text-muted-foreground block">
                  Live: {formatRate(wanUlRate)} ({formatPacketsRate(wanUlPktsRate)})
                </span>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground pt-2 border-t flex justify-between">
              <span>Total WAN ({period}):</span>
              <strong className="text-foreground font-mono">{formatBytes(internetDl + internetUl)}</strong>
            </div>
          </CardContent>
        </Card>

        {/* Local LAN Traffic */}
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Network className="w-4 h-4 text-sky-500" />
                Local Traffic ({period})
              </span>
              {(lanDlRate > 0 || lanUlRate > 0) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sky-500/30 text-sky-500 font-mono">
                  Live: {formatRate(lanDlRate + lanUlRate)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
              <div>
                <span className="text-muted-foreground text-[11px] block">Download</span>
                <span className="font-semibold text-emerald-500 text-base">{formatBytes(lanDl)}</span>
                <span className="text-[10px] text-muted-foreground block">
                  Live: {formatRate(lanDlRate)} ({formatPacketsRate(lanDlPktsRate)})
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-[11px] block">Upload</span>
                <span className="font-semibold text-sky-500 text-base">{formatBytes(lanUl)}</span>
                <span className="text-[10px] text-muted-foreground block">
                  Live: {formatRate(lanUlRate)} ({formatPacketsRate(lanUlPktsRate)})
                </span>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground pt-2 border-t flex justify-between">
              <span>Total LAN ({period}):</span>
              <strong className="text-foreground font-mono">{formatBytes(lanDl + lanUl)}</strong>
            </div>
          </CardContent>
        </Card>

        {/* Total & Timestamps */}
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                Total Combined Traffic ({period})
              </span>
              {(dlRate > 0 || ulRate > 0) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono">
                  Live: {formatRate(dlRate + ulRate)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
              <div>
                <span className="text-muted-foreground text-[11px] block">Total In</span>
                <span className="font-semibold text-emerald-500 text-base">{formatBytes(totalDl)}</span>
                <span className="text-[10px] text-muted-foreground block">
                  Live: {formatRate(dlRate)} ({formatPacketsRate(dlPktsRate)})
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-[11px] block">Total Out</span>
                <span className="font-semibold text-sky-500 text-base">{formatBytes(totalUl)}</span>
                <span className="text-[10px] text-muted-foreground block">
                  Live: {formatRate(ulRate)} ({formatPacketsRate(ulPktsRate)})
                </span>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground pt-2 border-t flex items-center justify-between">
              <span>Overall Total ({period}):</span>
              <strong className="text-foreground font-mono">{formatBytes(totalDl + totalUl)}</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Historical Bandwidth Chart with Legend & Scope Selector */}
      <Card>
        <CardHeader className="space-y-2 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Bandwidth History & Activity
              </CardTitle>
              <CardDescription>
                Historical ingress and egress data sampled from embedded SQLite TSDB
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Chart Scope Selector */}
              <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg">
                {(['total', 'wan', 'lan'] as const).map((scope) => (
                  <Button
                    key={scope}
                    variant={chartScope === scope ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 text-xs px-2.5 capitalize font-medium"
                    onClick={() => setChartScope(scope)}
                  >
                    {scope === 'total' ? 'Total' : scope === 'wan' ? 'WAN (Internet)' : 'LAN (Local)'}
                  </Button>
                ))}
              </div>

                <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                  {period}
                </Badge>
              </div>
            </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-card p-4">
            {historyData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground text-xs text-center px-4">
                <Activity className="w-8 h-8 opacity-25 mb-2" />
                <span>No historical time series samples recorded for this device in the last {period}.</span>
                <span className="text-[11px] opacity-75 mt-1">Data begins recording as soon as the device transmits network traffic.</span>
              </div>
            ) : (
              <ChartContainer config={deviceChartConfig} className="h-64 w-full">
                <AreaChart data={historyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dev-detail-dl-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="dev-detail-ul-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                  <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} className="text-[10px] font-mono" />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(val) => formatRate(val)} className="text-[10px] font-mono" />
                  <ChartTooltip content={<ChartTooltipContent formatter={(val) => <span className="font-mono">{formatRate(Number(val))}</span>} />} />
                  <Area
                    type="monotone"
                    dataKey="download"
                    name="download"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#dev-detail-dl-grad)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="upload"
                    name="upload"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#dev-detail-ul-grad)"
                    isAnimationActive={false}
                  />
                  <ChartLegend content={<ChartLegendContent className="text-xs pt-3" />} />
                </AreaChart>
              </ChartContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transport Protocol Distribution Card */}
      {protocols.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Transport Protocol Breakdown
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                Observed L4/L3 IP protocols ({period})
              </span>
            </div>
            <CardDescription className="text-xs">
              Bandwidth and packet distribution categorized by transport protocol over the last {period}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Multi-segment Progress Bar */}
            {totalProtoBytes > 0 && (
              <div className="space-y-1.5">
                <div className="h-3 w-full rounded-full overflow-hidden flex bg-muted/60">
                  {protocols.map((p: ProtocolTraffic) => {
                    const pBytes = Number(p.traffic?.downloadBytes || 0) + Number(p.traffic?.uploadBytes || 0)
                    const pct = (pBytes / totalProtoBytes) * 100
                    if (pct <= 0) return null
                    const color = PROTOCOL_COLORS[p.protocol]?.bar || '#64748b'
                    return (
                      <div
                        key={p.protocol}
                        style={{ width: `${pct}%`, backgroundColor: color }}
                        className="h-full transition-all"
                        title={`${p.protocol}: ${pct.toFixed(1)}% (${formatBytes(pBytes)})`}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* Protocol Badges & Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {protocols.map((p: ProtocolTraffic) => {
                const dl = Number(p.traffic?.downloadBytes || 0)
                const ul = Number(p.traffic?.uploadBytes || 0)
                const pkts = Number(p.traffic?.downloadPackets || 0) + Number(p.traffic?.uploadPackets || 0)
                const dlR = Number(p.traffic?.downloadBytesPerSec || 0)
                const ulR = Number(p.traffic?.uploadBytesPerSec || 0)
                const styling = PROTOCOL_COLORS[p.protocol] || PROTOCOL_COLORS.OTHER
                const pct = totalProtoBytes > 0 ? (((dl + ul) / totalProtoBytes) * 100).toFixed(1) : '0'

                return (
                  <div key={p.protocol} className="p-3 rounded-lg border bg-card/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className={cn("text-xs font-semibold px-2 py-0.5", styling.bg, styling.text)}>
                        {p.protocol}
                      </Badge>
                      <span className="text-xs font-mono font-medium text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="text-xs font-mono space-y-0.5">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Volume ({period}):</span>
                        <strong className="text-foreground">{formatBytes(dl + ul)}</strong>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Packets:</span>
                        <span>{pkts.toLocaleString()} pkts</span>
                      </div>
                      {(dlR > 0 || ulR > 0) && (
                        <div className="flex justify-between text-[10px] text-primary pt-1 border-t border-muted/60">
                          <span>Live:</span>
                          <span>↓{formatRate(dlR)} ↑{formatRate(ulR)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Local LAN Peers Card */}
      {peers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Share2 className="w-4 h-4 text-primary" />
                Local Network Peers (LAN Device-to-Device)
              </CardTitle>
              <Badge variant="outline" className="text-[10px] font-mono">
                {peers.length} {peers.length === 1 ? 'Peer' : 'Peers'}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Internal subnet devices that this client directly communicated with over LAN in the last {period}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Peer Device / IP</TableHead>
                    <TableHead className="text-right">Sent ({period})</TableHead>
                    <TableHead className="text-right">Received ({period})</TableHead>
                    <TableHead className="text-right">Total Transferred ({period})</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peers.map((peer: PeerTraffic, idx: number) => {
                    const sentB = Number(peer.traffic?.uploadBytes || 0)
                    const rcvdB = Number(peer.traffic?.downloadBytes || 0)
                    const sentP = Number(peer.traffic?.uploadPackets || 0)
                    const rcvdP = Number(peer.traffic?.downloadPackets || 0)
                    const sentRate = Number(peer.traffic?.uploadBytesPerSec || 0)
                    const rcvdRate = Number(peer.traffic?.downloadBytesPerSec || 0)

                    return (
                      <TableRow key={`${peer.ipAddr}-${idx}`}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                              {peer.hostname || 'Local Client'}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {peer.ipAddr}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <div className="flex flex-col items-end">
                            <span className="text-sky-500 font-semibold">{formatBytes(sentB)}</span>
                            <span className="text-[10px] text-muted-foreground">{sentP.toLocaleString()} pkts</span>
                            {sentRate > 0 && (
                              <span className="text-[10px] text-sky-500 font-medium">{formatRate(sentRate)}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <div className="flex flex-col items-end">
                            <span className="text-emerald-500 font-semibold">{formatBytes(rcvdB)}</span>
                            <span className="text-[10px] text-muted-foreground">{rcvdP.toLocaleString()} pkts</span>
                            {rcvdRate > 0 && (
                              <span className="text-[10px] text-emerald-500 font-medium">{formatRate(rcvdRate)}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <span className="font-bold text-foreground">{formatBytes(sentB + rcvdB)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <Link to={`/devices/${encodeURIComponent(peer.ipAddr)}`}>
                              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LAN Connection Quality & Ping Diagnostics (Moved here per user request) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary" />
                LAN Connection Quality & Ping Diagnostics
              </CardTitle>
              <CardDescription className="text-xs">
                On-demand ICMP round-trip probe directly from the router to verify latency, jitter, and packet loss.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 self-start sm:self-auto"
              onClick={handleRunPing}
              disabled={pingLoading}
            >
              {pingLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin text-primary" />
              ) : (
                <Zap className="w-3 h-3 text-amber-500" />
              )}
              <span>{pingLoading ? 'Testing...' : pingResult ? 'Re-run Ping' : 'Run Ping Test'}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {pingError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{pingError}</span>
            </div>
          )}

          {!pingResult && !pingLoading && !pingError && (
            <div className="py-6 flex flex-col items-center justify-center text-muted-foreground text-xs text-center">
              <Radio className="w-8 h-8 opacity-25 mb-2" />
              <span>No ping test executed yet for this device.</span>
              <span className="text-[11px] opacity-75 mt-0.5">Click "Run Ping Test" to measure live packet latency and packet loss.</span>
            </div>
          )}

          {pingLoading && !pingResult && (
            <div className="py-6 flex flex-col items-center justify-center text-muted-foreground text-xs text-center animate-pulse">
              <RefreshCw className="w-8 h-8 opacity-40 mb-2 animate-spin text-primary" />
              <span>Sending 4 ICMP Echo packets to {ip}...</span>
            </div>
          )}

          {pingResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
                  <span className="text-[11px] text-muted-foreground block">Connection Quality</span>
                  {pingQuality && (
                    <Badge variant="outline" className={cn("text-xs font-semibold", pingQuality.badgeBg)}>
                      {pingQuality.label}
                    </Badge>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
                  <span className="text-[11px] text-muted-foreground block">Packet Loss</span>
                  <div className="font-mono text-base font-semibold">
                    <span className={cn(pingResult.packetLossRatio > 0 ? "text-destructive" : "text-emerald-500")}>
                      {(pingResult.packetLossRatio * 100).toFixed(0)}%
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-1">
                      ({Math.round((1 - pingResult.packetLossRatio) * 4)}/4 received)
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
                  <span className="text-[11px] text-muted-foreground block">Average RTT</span>
                  <div className="font-mono text-base font-semibold text-foreground">
                    {pingResult.isReachable ? `${(pingResult.avgLatencySeconds * 1000).toFixed(2)} ms` : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
                  <span className="text-[11px] text-muted-foreground block">Jitter / Variance</span>
                  <div className="font-mono text-base font-semibold text-foreground">
                    {pingResult.isReachable ? `${(pingResult.jitterSeconds * 1000).toFixed(2)} ms` : '—'}
                  </div>
                </div>
              </div>

              {/* Individual Packet Results */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-medium text-muted-foreground">Individual ICMP Probe Packets:</span>
                <div className="flex flex-wrap gap-2">
                  {pingResult.roundTripTimesMs.map((rtt, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-mono flex items-center gap-1.5 border",
                        rtt >= 0
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 border-destructive/20 text-destructive"
                      )}
                    >
                      <span className="text-[10px] opacity-75">Packet #{idx + 1}:</span>
                      <strong>{rtt >= 0 ? `${rtt.toFixed(2)} ms` : 'Timeout'}</strong>
                    </div>
                  ))}
                  {pingResult.isReachable && (
                    <div className="px-2.5 py-1 rounded-md text-xs font-mono bg-muted/50 border text-muted-foreground flex items-center gap-1.5">
                      <span>Min: <strong className="text-foreground">{(pingResult.minLatencySeconds * 1000).toFixed(2)} ms</strong></span>
                      <span>•</span>
                      <span>Max: <strong className="text-foreground">{(pingResult.maxLatencySeconds * 1000).toFixed(2)} ms</strong></span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wake-on-LAN (Magic Packet) Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Power className="w-4 h-4 text-amber-500" />
                Wake-on-LAN (Magic Packet)
              </CardTitle>
              <CardDescription className="text-xs">
                Broadcast an AMD Magic Packet over UDP port 9 to power on or resume this device from network standby.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 self-start sm:self-auto"
              onClick={handleWakeOnLan}
              disabled={wolLoading || !canWakeOnLan}
            >
              {wolLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin text-amber-500" />
              ) : (
                <Power className="w-3 h-3 text-amber-500" />
              )}
              <span>{wolLoading ? 'Transmitting...' : 'Send Magic Packet'}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {wolError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{wolError}</span>
            </div>
          )}

          {wolResult && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                <Check className="w-4 h-4 shrink-0" />
                <span>Wake-on-LAN magic packet successfully transmitted!</span>
              </div>
              <div className="text-muted-foreground text-[11px] font-mono flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Target MAC: <strong className="text-foreground">{wolResult.macAddr}</strong></span>
                <span>Broadcast: <strong className="text-foreground">{wolResult.broadcastAddr}</strong></span>
                {wolResult.interface && (
                  <span>Interface: <strong className="text-foreground">{wolResult.interface}</strong></span>
                )}
              </div>
              <div className="pt-1 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] px-2 gap-1 text-primary hover:text-primary/80"
                  onClick={handleRunPing}
                  disabled={pingLoading}
                >
                  <Radio className="w-3 h-3" />
                  <span>Check if device has booted (Ping Test)</span>
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
              <span className="text-[11px] text-muted-foreground block">Target MAC Address</span>
              <span className="font-mono font-semibold text-foreground">
                {device?.macAddr || 'Not available'}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
              <span className="text-[11px] text-muted-foreground block">Network Interface</span>
              <span className="font-mono font-semibold text-foreground">
                {device?.interface || device?.arp?.interface || 'lan'}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border space-y-1">
              <span className="text-[11px] text-muted-foreground block">Default Port & Protocol</span>
              <span className="font-mono font-semibold text-foreground">
                UDP Port 9 (Discard)
              </span>
            </div>
          </div>

          {!canWakeOnLan && (
            <div className="p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>Wake-on-LAN is unavailable because this device does not have an Ethernet MAC address registered in ARP or DHCP.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Improved ARP & Layer 2 Discovery Details Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              ARP & Layer 2 Network Discovery
            </CardTitle>
            <Badge variant="outline" className="text-[10px] font-mono">
              RFC 826 • IEEE 802
            </Badge>
          </div>
          <CardDescription className="text-xs">
            Link layer address resolution, MAC hardware classification, and kernel neighbor cache diagnostics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 text-xs">
            {/* MAC Architecture */}
            <div className="p-3.5 rounded-lg border bg-card/60 space-y-2">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <HardDrive className="w-3.5 h-3.5 text-primary" />
                <span>MAC Architecture</span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Address:</span>
                  <strong className="text-foreground">{device?.macAddr || 'Unknown'}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scope:</span>
                  <span className={cn("font-medium", isRandomized ? "text-amber-500" : "text-foreground")}>
                    {isRandomized ? 'Locally Administered' : 'Globally Unique'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">OUI Prefix:</span>
                  <span className="text-foreground font-mono">
                    {device?.macAddr && device.macAddr.length >= 8 ? device.macAddr.slice(0, 8).toUpperCase() : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vendor:</span>
                  <span className="text-foreground truncate max-w-[130px]" title={device?.vendor || (isRandomized ? 'Randomized by Client OS' : 'Unknown')}>
                    {device?.vendor || (isRandomized ? 'Private / Randomized' : 'Unregistered')}
                  </span>
                </div>
              </div>
            </div>

            {/* ARP Protocol State */}
            <div className="p-3.5 rounded-lg border bg-card/60 space-y-2">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
                <span>ARP Cache State</span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolution:</span>
                  <span className={cn("font-medium", device?.arp?.isValid ? "text-emerald-500" : "text-amber-500")}>
                    {device?.arp?.isValid ? 'Resolved (Neighbor Reachable)' : 'Incomplete / Unresolved'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kernel Flags:</span>
                  <strong className="text-foreground">0x{Number(device?.arp?.flags ?? 0).toString(16)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entry Type:</span>
                  <span className="text-foreground">
                    {Number(device?.arp?.flags ?? 0) & 4 ? 'Static (Permanent)' : 'Dynamic (Learned)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Interface:</span>
                  <strong className="text-foreground">{device?.interface || device?.arp?.interface || 'lan'}</strong>
                </div>
              </div>
            </div>

            {/* DHCP Lease & Network Identity */}
            <div className="p-3.5 rounded-lg border bg-card/60 space-y-2">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <Network className="w-3.5 h-3.5 text-indigo-500" />
                <span>DHCP & DNS Identity</span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verification:</span>
                  <span className={cn("font-medium", device?.isKnown ? "text-emerald-500" : "text-amber-500")}>
                    {device?.isKnown ? 'Known (Static DNS)' : 'Unknown (Dynamic)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reverse DNS:</span>
                  <span className="text-foreground truncate max-w-[130px]" title={device?.isKnown ? device.hostname : 'No PTR (NXDOMAIN)'}>
                    {device?.isKnown ? device.hostname : 'Unregistered'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DHCP Name:</span>
                  <span className="text-foreground truncate max-w-[130px]" title={device?.dhcpLease?.hostname || 'None'}>
                    {device?.dhcpLease?.hostname || 'None'}
                  </span>
                </div>
                {device?.dhcpLease?.clientId ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Client ID:</span>
                    <span className="text-foreground truncate max-w-[130px]" title={device.dhcpLease.clientId}>
                      {device.dhcpLease.clientId}
                    </span>
                  </div>
                ) : null}
                {device?.dhcpLease && Number(device.dhcpLease.subnetId) > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kea Subnet:</span>
                    <span className="text-foreground font-semibold">
                      Subnet {Number(device.dhcpLease.subnetId)}
                    </span>
                  </div>
                ) : null}
                {device?.dhcpLease && Number(device.dhcpLease.expireUnix) > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Lease Expiry:</span>
                    <span className="text-foreground" title={new Date(Number(device.dhcpLease.expireUnix) * 1000).toLocaleString()}>
                      {formatRelativeTime(Number(device.dhcpLease.expireUnix))}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Network Lifespan & Timeline */}
            <div className="p-3.5 rounded-lg border bg-card/60 space-y-2">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <Calendar className="w-3.5 h-3.5 text-sky-500" />
                <span>Device Timeline</span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">First Seen:</span>
                  <span className="text-foreground" title={Number(device?.firstSeenUnix) > 0 ? new Date(Number(device?.firstSeenUnix) * 1000).toLocaleString() : ''}>
                    {Number(device?.firstSeenUnix) > 0 ? formatRelativeTime(Number(device.firstSeenUnix)) : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Active:</span>
                  <span className="text-foreground" title={Number(device?.lastSeenUnix) > 0 ? new Date(Number(device?.lastSeenUnix) * 1000).toLocaleString() : ''}>
                    {Number(device?.lastSeenUnix) > 0 ? formatRelativeTime(Number(device.lastSeenUnix)) : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Status:</span>
                  <span className={cn("capitalize font-semibold", isOnline ? "text-emerald-500" : "text-muted-foreground")}>
                    {status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Protocol:</span>
                  <span className="text-foreground">Ethernet (IPv4)</span>
                </div>
              </div>
            </div>

            {/* Frame & Traffic Efficiency */}
            <div className="p-3.5 rounded-lg border bg-card/60 space-y-2">
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <Hash className="w-3.5 h-3.5 text-amber-500" />
                <span>Frame & Packet Metrics</span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frames In:</span>
                  <span className="text-emerald-500">{totalDlPkts.toLocaleString()} pkts</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frames Out:</span>
                  <span className="text-sky-500">{totalUlPkts.toLocaleString()} pkts</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Packet Size:</span>
                  <span className="text-foreground">
                    {totalDlPkts + totalUlPkts > 0
                      ? formatBytes((totalDl + totalUl) / (totalDlPkts + totalUlPkts))
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DL/UL Ratio:</span>
                  <span className="text-foreground">
                    {totalUl > 0 ? `${(totalDl / totalUl).toFixed(1)} : 1` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Educational Note about Unknown / Unverified Device */}
          {!device?.isKnown && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Unverified Device:</strong> This device does not have a static reverse DNS PTR record configured in the router's DNS server. {device?.dhcpLease?.hostname ? `Its hostname "${device.dhcpLease.hostname}" was reported via DHCP option 12 during lease negotiation.` : 'No hostname was reported by DHCP or DNS.'}
              </span>
            </div>
          )}

          {/* Educational Note about MAC Randomization if present */}
          {isRandomized && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Private Wi-Fi Address Detected:</strong> This device is using a randomized MAC address (standard privacy feature in iOS 14+, Android 10+, and Windows 11). Because the hardware address is generated dynamically by the operating system, it does not match a factory manufacturer OUI prefix in the IEEE registry.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
