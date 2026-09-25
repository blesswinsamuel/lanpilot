import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  Globe,
  Radio,
  Clock,
  ShieldCheck,
  AlertCircle,
  History,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { formatLatency, formatDuration, formatPercent, formatRelativeTime } from '@/lib/format'
import { rpcClient } from '@/lib/client'
import { cn } from '@/lib/utils'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from './ui/chart'

import { useRootOutletContext } from './RootLayout'
import { getPeriodRange } from '@/lib/period'
import { formatChartTime } from '@/lib/format'

function safeKey(addr: string): string {
  return addr.replace(/[^a-zA-Z0-9_-]/g, '_')
}

const PALETTE = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#14b8a6']

interface InternetHealthTabProps {
  health: any
}

type ChartMetric = 'latency' | 'loss' | 'jitter'

export function InternetHealthTab({ health }: InternetHealthTabProps) {
  const { period } = useRootOutletContext()
  const [chartMetric, setChartMetric] = useState<ChartMetric>('latency')
  const [chartHistory, setChartHistory] = useState<any[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  const targets = health?.targets || []
  const recentOutages = health?.recentOutages || []
  const overallStatus: string = health?.overallStatus || (health?.overallIsUp ? 'operational' : 'down')
  const isUp = health?.overallIsUp ?? true
  const overallLatency = health?.overallLatencySeconds ?? 0
  const overallLoss = health?.overallPacketLossRatio ?? 0
  const overallJitter = health?.overallJitterSeconds ?? 0

  useEffect(() => {
    let active = true

    async function fetchChartHistory() {
      setChartLoading(true)
      try {
        const { fromUnix: from, toUnix: now, stepSeconds: step } = getPeriodRange(period)

        let metricName = 'internet_latency_seconds'
        if (chartMetric === 'loss') {
          metricName = 'internet_packet_loss_ratio'
        } else if (chartMetric === 'jitter') {
          metricName = 'internet_jitter_seconds'
        }

        const res = await rpcClient.queryTimeSeries({
          queries: [{
            metricName,
            matchLabels: {},
          }],
          fromUnix: BigInt(from),
          toUnix: BigInt(now),
          stepSeconds: step,
        })

        if (!active) return

        const timeMap = new Map<number, any>()

        for (const s of res.series) {
          const rawTarget = s.labels['target'] || 'target'
          const targetKey = safeKey(rawTarget)
          for (const pt of s.points) {
            const ts = Number(pt.timestampUnix)
            let entry = timeMap.get(ts)
            if (!entry) {
              const d = new Date(ts * 1000)
              entry = {
                time: formatChartTime(d, period),
              }
              timeMap.set(ts, entry)
            }
            if (chartMetric === 'latency') {
              entry[targetKey] = Number((pt.value * 1000).toFixed(1))
            } else if (chartMetric === 'loss') {
              entry[targetKey] = Number((pt.value * 100).toFixed(1))
            } else {
              entry[targetKey] = Number((pt.value * 1000).toFixed(2))
            }
          }
        }

        const sorted = Array.from(timeMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, v]) => v)

        setChartHistory(sorted)
      } catch (err) {
        console.error('Failed to load internet health history:', err)
      } finally {
        if (active) setChartLoading(false)
      }
    }

    fetchChartHistory()
    const interval = setInterval(fetchChartHistory, 15000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [chartMetric, period])

  const chartConfig = useMemo(() => {
    const config: ChartConfig = {}
    targets.forEach((t: any, idx: number) => {
      config[safeKey(t.target || t.name)] = {
        label: t.name || t.target,
        color: PALETTE[idx % PALETTE.length],
      }
    })
    return config
  }, [targets])

  const isDegraded = overallStatus === 'degraded'
  const isDown = overallStatus === 'down' || !isUp

  return (
    <div className="space-y-6">
      {/* Hero Status Banner */}
      <div
        className={cn(
          "rounded-xl border p-5 transition-all shadow-xs",
          !isDown && !isDegraded && "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10",
          isDegraded && "border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10",
          isDown && "border-destructive/30 bg-destructive/5 dark:bg-destructive/10"
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={cn(
                "p-3 rounded-xl shrink-0 shadow-xs",
                !isDown && !isDegraded && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                isDegraded && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                isDown && "bg-destructive/15 text-destructive"
              )}
            >
              {!isDown && !isDegraded && <CheckCircle2 className="w-6 h-6" />}
              {isDegraded && <AlertTriangle className="w-6 h-6" />}
              {isDown && <XCircle className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">
                  {!isDown && !isDegraded && "Internet Connection Operational"}
                  {isDegraded && "Internet Performance Degraded"}
                  {isDown && "Internet Connection Offline"}
                </h2>
                <Badge
                  variant={isDown ? "destructive" : "outline"}
                  className={cn(
                    "text-xs font-semibold capitalize",
                    !isDown && !isDegraded && "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    isDegraded && "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  )}
                >
                  {overallStatus}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {!isDown && !isDegraded && "All network probes (ICMP, DNS, HTTP) are responding normally with low latency and 0% packet loss."}
                {isDegraded && "Network degradation detected: some probe targets have packet drops, high jitter, or partial failure."}
                {isDown && "Zero internet probe targets are reachable. Local gateway link or upstream ISP connection is down."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto font-mono text-xs text-muted-foreground bg-background/50 px-3 py-1.5 rounded-lg border">
            <Radio className={cn("w-3.5 h-3.5 animate-pulse", !isDown && !isDegraded ? "text-emerald-500" : isDegraded ? "text-amber-500" : "text-destructive")} />
            <span>Active Probes: <strong className="text-foreground">{targets.filter((t: any) => t.isUp).length}/{targets.length}</strong></span>
          </div>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Connection State</CardTitle>
            <ShieldCheck className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold font-mono tracking-tight capitalize">
                {overallStatus}
              </div>
              <Badge
                variant={isDown ? "destructive" : "outline"}
                className={cn(
                  "font-mono text-xs",
                  !isDown && !isDegraded && "border-emerald-500/20 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                  isDegraded && "border-amber-500/20 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                )}
              >
                {isUp ? "Online" : "Offline"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Composite health across all active tiers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Round-Trip Latency</CardTitle>
            <Activity className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight">
              {formatLatency(overallLatency)}
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>Jitter:</span>
              <span className="font-mono font-medium text-foreground">
                {formatLatency(overallJitter)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Packet Loss</CardTitle>
            <AlertCircle className={cn("w-4 h-4", overallLoss === 0 ? "text-emerald-500" : overallLoss > 0.1 ? "text-destructive" : "text-amber-500")} />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <div className={cn(
                "text-2xl font-bold font-mono tracking-tight",
                overallLoss === 0 ? "text-foreground" : overallLoss > 0.1 ? "text-destructive" : "text-amber-600 dark:text-amber-400"
              )}>
                {formatPercent(overallLoss)}
              </div>
              <Badge
                variant={overallLoss === 0 ? "outline" : "destructive"}
                className={overallLoss === 0 ? "border-emerald-500/20 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono text-xs" : "font-mono text-xs"}
              >
                {overallLoss === 0 ? "0% Loss" : "Loss Detected"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Average drops across 3-burst ICMP/DNS probes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Reachability</CardTitle>
            <Globe className="w-4 h-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight">
              {targets.filter((t: any) => t.isUp).length} / {targets.length}
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>Outages recorded:</span>
              <span className="font-mono font-medium text-foreground">
                {recentOutages.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Probe Targets Grid */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Active Probes & Multi-Tier Health
              </CardTitle>
              <CardDescription>
                Multi-protocol active probing (ICMP raw socket, DNS resolution, and L7 HTTP reachability)
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit text-xs font-mono">
              Live Probe Cycle: 5s
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {targets.map((t: any, idx: number) => {
              const probeType: string = (t.probeType || 'icmp').toLowerCase()
              const isTargetUp = t.isUp
              const lossRatio = t.packetLossRatio ?? 0

              let typeBadgeClass = 'border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400'
              if (probeType === 'dns') {
                typeBadgeClass = 'border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-400'
              } else if (probeType === 'http') {
                typeBadgeClass = 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }

              return (
                <div
                  key={`${t.target}-${idx}`}
                  className={cn(
                    "p-4 rounded-xl border transition-all space-y-3 bg-card",
                    !isTargetUp && "border-destructive/30 bg-destructive/5"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm tracking-tight">{t.name || t.target}</span>
                        <Badge variant="outline" className={cn("text-[10px] uppercase font-mono px-1.5 py-0", typeBadgeClass)}>
                          {probeType}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-[220px]" title={t.target}>
                        {t.target}
                      </p>
                    </div>
                    {isTargetUp ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive shrink-0" />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs font-mono">
                    <div>
                      <span className="text-muted-foreground text-[10px] block font-sans">Latency</span>
                      <span className="text-base font-bold text-foreground">
                        {formatLatency(t.latencySeconds)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-[10px] block font-sans">Packet Loss</span>
                      <span className={cn(
                        "text-base font-bold",
                        lossRatio === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                      )}>
                        {formatPercent(lossRatio)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono pt-1">
                    <span>Jitter: <strong className="text-foreground">{formatLatency(t.jitterSeconds)}</strong></span>
                    {t.avgLatencySeconds > 0 && (
                      <span>Avg: <strong className="text-foreground">{formatLatency(t.avgLatencySeconds)}</strong></span>
                    )}
                  </div>

                  {t.lastError && (
                    <div className="text-[11px] text-destructive font-mono truncate bg-destructive/10 px-2 py-1 rounded">
                      {t.lastError}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Historical Time-Series Chart */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Network Quality History
              </CardTitle>
              <CardDescription>
                Historical measurements recorded into embedded SQLite TSDB (100% data fidelity)
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Metric Selector Tabs */}
              <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg">
                <Button
                  variant={chartMetric === 'latency' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs px-2.5 font-medium"
                  onClick={() => setChartMetric('latency')}
                >
                  Latency (ms)
                </Button>
                <Button
                  variant={chartMetric === 'loss' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs px-2.5 font-medium"
                  onClick={() => setChartMetric('loss')}
                >
                  Packet Loss (%)
                </Button>
                <Button
                  variant={chartMetric === 'jitter' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs px-2.5 font-medium"
                  onClick={() => setChartMetric('jitter')}
                >
                  Jitter (ms)
                </Button>
              </div>

                <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                  {period}
                </Badge>
              </div>
            </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            {chartLoading && chartHistory.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground animate-pulse">
                Querying TSDB time series...
              </div>
            ) : chartHistory.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Collecting metrics into SQLite database... Check back in a moment.
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto">
                <LineChart data={chartHistory}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                  <XAxis
                    dataKey="time"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    fontSize={11}
                    className="font-mono text-[10px]"
                  />

                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    unit={chartMetric === 'loss' ? '%' : 'ms'}
                    width={45}
                    className="font-mono text-[10px]"
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        indicator="dot"
                        formatter={(val, name, item) => (
                          <>
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                              style={{ backgroundColor: item.color }}
                            />
                            <div className="flex flex-1 justify-between items-center leading-none gap-2">
                              <span className="text-muted-foreground font-mono text-xs">
                                {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                              </span>
                              <span className="font-mono font-medium text-foreground tabular-nums text-xs">
                                {val} {chartMetric === 'loss' ? '%' : 'ms'}
                              </span>
                            </div>
                          </>
                        )}
                      />
                    }
                  />
                  {targets.map((t: any) => {
                    const key = safeKey(t.target || t.name)
                    return (
                      <Line
                        key={t.target || t.name}
                        type="monotone"
                        dataKey={key}
                        stroke={`var(--color-${key})`}
                        strokeWidth={2}
                        dot={false}
                        name={key}
                        isAnimationActive={false}
                      />
                    )
                  })}
                </LineChart>
              </ChartContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Persistent Outage History Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="w-4 h-4 text-primary" />
                Persistent Outage & Degradation History
              </CardTitle>
              <CardDescription>
                Recorded downtime and degradation incidents stored in SQLite database
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {recentOutages.length} Incidents
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {recentOutages.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 text-emerald-500/40 mx-auto mb-2" />
              <span>No network degradation or outages recorded in database. 100% uptime!</span>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Start Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Root Cause / Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOutages.map((o: any, idx: number) => {
                    const isOutageDown = o.status === 'down'
                    const startTime = Number(o.startUnix)
                    const duration = Number(o.durationSeconds)

                    return (
                      <TableRow key={o.id || idx}>
                        <TableCell>
                          <Badge
                            variant={isOutageDown ? "destructive" : "outline"}
                            className={cn(
                              "capitalize text-xs font-mono",
                              !isOutageDown && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            )}
                          >
                            {o.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {startTime > 0 ? (
                            <span title={new Date(startTime * 1000).toLocaleString()}>
                              {formatRelativeTime(startTime)} ({new Date(startTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                            </span>
                          ) : "--"}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-medium">
                          {duration > 0 ? formatDuration(duration) : (
                            <span className="text-amber-500 flex items-center gap-1">
                              <Clock className="w-3 h-3 animate-spin" /> In progress
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {o.reason || "Connectivity failure"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
