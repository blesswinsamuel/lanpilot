import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PieChart as PieChartIcon,
  Activity,
  Globe,
  Network,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card'
import { Badge } from './ui/badge'
import { formatBytes, formatRate, formatPercent, formatChartTime } from '@/lib/format'
import { rpcClient } from '@/lib/client'
import { getPeriodRange, type Period } from '@/lib/period'
import { getDeviceCategory } from '@/lib/device-icons'
import { cn } from '@/lib/utils'
import type { Device } from '@/gen/lanpilot/v1/lanpilot_pb'
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from './ui/chart'

export const DEVICE_PALETTE = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
  '#e11d48', // rose
]
export const OTHER_COLOR = '#64748b'

interface DeviceTrafficChartsProps {
  devices: Device[]
  trafficScope: 'total' | 'wan' | 'lan' | 'split'
  selectedDeviceIp?: string | null
  onSelectDevice?: (ip: string | null) => void
  period?: Period
}

export interface DeviceSliceData {
  ip: string
  name: string
  vendor: string
  total: number
  dl: number
  ul: number
  percent: number
  color: string
}

interface DeviceTimeSeriesEntry {
  time: string
  timestamp: number
  [ip: string]: number | string
}

export const DeviceTrafficCharts = React.memo(function DeviceTrafficCharts({
  devices,
  trafficScope,
  selectedDeviceIp,
  onSelectDevice,
  period = '1d',
}: DeviceTrafficChartsProps) {
  const [historyLoading, setHistoryLoading] = useState(false)
  const [timeseriesData, setTimeseriesData] = useState<DeviceTimeSeriesEntry[]>([])

  const scopeKey = trafficScope === 'split' ? 'total' : trafficScope

  // 1. Process devices into ranked slices for Donut chart
  const { slices, grandTotal, topDevices } = useMemo(() => {
    if (!devices || devices.length === 0) {
      return { slices: [], grandTotal: 0, topDevices: [] }
    }

    const devData = devices
      .map((d) => {
        let dl = 0
        let ul = 0
        if (scopeKey === 'wan') {
          dl = Number(d.wan?.downloadBytes || 0)
          ul = Number(d.wan?.uploadBytes || 0)
        } else if (scopeKey === 'lan') {
          dl = Number(d.lan?.downloadBytes || 0)
          ul = Number(d.lan?.uploadBytes || 0)
        } else {
          dl = Number(d.total?.downloadBytes || 0)
          ul = Number(d.total?.uploadBytes || 0)
        }

        const total = dl + ul
        const rawName = d.hostname || (d.vendor || d.ipAddr)
        return {
          device: d,
          ip: d.ipAddr,
          name: rawName || d.ipAddr,
          vendor: d.vendor || '',
          total,
          dl,
          ul,
        }
      })
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total)

    const sumTotal = devData.reduce((acc, d) => acc + d.total, 0)
    if (sumTotal === 0) {
      return { slices: [], grandTotal: 0, topDevices: [] }
    }

    const topCount = 10
    const top = devData.slice(0, topCount)
    const rest = devData.slice(topCount)

    const resultSlices: DeviceSliceData[] = top.map((d, index) => ({
      ip: d.ip,
      name: d.name,
      vendor: d.vendor,
      total: d.total,
      dl: d.dl,
      ul: d.ul,
      percent: (d.total / sumTotal) * 100,
      color: DEVICE_PALETTE[index % DEVICE_PALETTE.length],
    }))

    if (rest.length > 0) {
      const otherTotal = rest.reduce((acc, d) => acc + d.total, 0)
      const otherDl = rest.reduce((acc, d) => acc + d.dl, 0)
      const otherUl = rest.reduce((acc, d) => acc + d.ul, 0)
      resultSlices.push({
        ip: '',
        name: `Other (${rest.length} devices)`,
        vendor: '',
        total: otherTotal,
        dl: otherDl,
        ul: otherUl,
        percent: (otherTotal / sumTotal) * 100,
        color: OTHER_COLOR,
      })
    }

    return { slices: resultSlices, grandTotal: sumTotal, topDevices: top }
  }, [devices, scopeKey])

  // 2. Fetch timeseries telemetry for top devices (top 5 for readable chart)
  const timeseriesDevices = useMemo(() => topDevices.slice(0, 5), [topDevices])
  const topIpsKey = useMemo(() => timeseriesDevices.map((d) => d.ip).join(','), [timeseriesDevices])

  const fetchTimeseries = useCallback(async () => {
    const currentIps = topIpsKey ? topIpsKey.split(',') : []
    if (currentIps.length === 0) {
      setTimeseriesData([])
      return
    }

    setHistoryLoading(true)
    try {
      const { fromUnix: from, toUnix: now, stepSeconds: step } = getPeriodRange(period)

      let metricName = 'device_traffic_bytes_rate'
      if (scopeKey === 'wan') {
        metricName = 'device_wan_bytes_rate'
      } else if (scopeKey === 'lan') {
        metricName = 'device_lan_bytes_rate'
      }

      // Query ingress & egress rates for all top IPs in a single batch RPC
      const queries = currentIps.map((ip) => ({
        metricName,
        matchLabels: { ip },
      }))

      const res = await rpcClient.queryTimeSeries({
        queries,
        fromUnix: BigInt(from),
        toUnix: BigInt(now),
        stepSeconds: step,
      })

      // Map IP -> Map<timestamp, totalRate>
      const ipMaps = new Map<string, Map<number, number>>()
      for (const ip of currentIps) {
        ipMaps.set(ip, new Map())
      }

      for (const s of res.series) {
        const ip = s.labels['ip']
        const ipMap = ipMaps.get(ip)
        if (!ipMap) continue
        for (const p of s.points) {
          const ts = Number(p.timestampUnix)
          ipMap.set(ts, (ipMap.get(ts) || 0) + p.value)
        }
      }

      const mergedMap = new Map<number, DeviceTimeSeriesEntry>()
      for (const [ip, ipMap] of ipMaps.entries()) {
        for (const [ts, rate] of ipMap.entries()) {
          let entry = mergedMap.get(ts)
          if (!entry) {
            const d = new Date(ts * 1000)
            const timeStr = formatChartTime(d, period)
            entry = { time: timeStr, timestamp: ts }
            for (const otherIp of currentIps) {
              entry[otherIp] = 0
            }
            mergedMap.set(ts, entry)
          }
          entry[ip] = rate
        }
      }

      const sortedEntries = Array.from(mergedMap.values()).sort((a, b) => a.timestamp - b.timestamp)
      setTimeseriesData(sortedEntries)
    } catch (err) {
      console.error('Failed to load device timeseries from TSDB:', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [topIpsKey, scopeKey, period])

  useEffect(() => {
    fetchTimeseries()
    const interval = setInterval(fetchTimeseries, 20000)
    return () => clearInterval(interval)
  }, [fetchTimeseries])

  // Chart config for shadcn ChartContainer
  const timeseriesChartConfig = useMemo(() => {
    const config: ChartConfig = {}
    timeseriesDevices.forEach((d, idx) => {
      config[d.ip] = {
        label: d.name,
        color: DEVICE_PALETTE[idx % DEVICE_PALETTE.length],
      }
    })
    return config
  }, [timeseriesDevices])

  if (slices.length === 0) {
    return null
  }

  const scopeLabel =
    scopeKey === 'wan'
      ? 'Internet (WAN)'
      : scopeKey === 'lan'
      ? 'Local (LAN)'
      : 'Combined (Total)'

  return (
    <Card className="border-border/80 shadow-xs">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'p-1.5 rounded-md',
                scopeKey === 'wan'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : scopeKey === 'lan'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-primary/10 text-primary'
              )}
            >
              {scopeKey === 'wan' ? (
                <Globe className="w-4 h-4" />
              ) : scopeKey === 'lan' ? (
                <Network className="w-4 h-4" />
              ) : (
                <PieChartIcon className="w-4 h-4" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold">
                  Device Traffic Analytics ({scopeLabel})
                </CardTitle>
                {selectedDeviceIp && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/15 hover:text-destructive transition-colors"
                    onClick={() => onSelectDevice?.(null)}
                    title="Click to clear filter"
                  >
                    <span>Filtered: {selectedDeviceIp}</span>
                    <XCircle className="w-3 h-3" />
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Bandwidth distribution and historical throughput for top devices ({period})
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-1">
        <div
          className={cn(
            'grid gap-6',
            'grid-cols-1 lg:grid-cols-12'
          )}
        >
          {/* LEFT: Donut Chart & Device Share Breakdown */}
          <div
            className={cn(
              'flex flex-col md:flex-row items-center gap-6 p-4 rounded-lg border bg-muted/20',
              'lg:col-span-5'
            )}
          >
              {/* Donut Chart with center total */}
              <div className="relative w-44 h-44 shrink-0 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <ChartTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null
                        const data = payload[0].payload as DeviceSliceData
                        return (
                          <div className="rounded-lg border bg-background p-2.5 shadow-md text-xs space-y-1">
                            <div className="flex items-center gap-2 font-medium">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: data.color }}
                              />
                              <span className="text-foreground truncate max-w-[160px]">
                                {data.name}
                              </span>
                              {data.ip && (
                                <span className="font-mono text-muted-foreground text-[10px]">
                                  ({data.ip})
                                </span>
                              )}
                            </div>
                            <div className="text-muted-foreground font-mono flex items-center justify-between gap-3">
                              <span>Volume:</span>
                              <span className="font-bold text-foreground">
                                {formatBytes(data.total)} ({formatPercent(data.percent / 100)})
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between gap-3 pt-1 border-t">
                              <span>↓ {formatBytes(data.dl)}</span>
                              <span>↑ {formatBytes(data.ul)}</span>
                            </div>
                          </div>
                        )
                      }}
                    />
                    <Pie
                      data={slices}
                      dataKey="total"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={70}
                      paddingAngle={2}
                      stroke="transparent"
                      isAnimationActive={false}
                      onClick={(entry) => {
                        const payload = entry?.payload as DeviceSliceData | undefined
                        if (payload?.ip && onSelectDevice) {
                          onSelectDevice(selectedDeviceIp === payload.ip ? null : payload.ip)
                        }
                      }}
                    >
                      {slices.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.color}
                          className={cn(
                            'cursor-pointer transition-opacity duration-150 hover:opacity-80',
                            selectedDeviceIp && entry.ip && selectedDeviceIp !== entry.ip && 'opacity-30'
                          )}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>

                {/* Center hole metrics */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
                    Total
                  </span>
                  <span className="text-sm font-bold font-mono text-foreground leading-tight">
                    {formatBytes(grandTotal)}
                  </span>
                  <span className="text-[9px] text-muted-foreground mt-0.5">
                    {slices.length} {slices.length === 1 ? 'slice' : 'slices'}
                  </span>
                </div>
              </div>

              {/* Slices legend & click-to-filter items */}
              <div className="w-full space-y-1.5 min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground pb-1 border-b flex items-center justify-between">
                  <span>Device Traffic Share</span>
                  <span>Volume ({period})</span>
                </div>
                {slices.map((slice) => {
                  const isSelected = selectedDeviceIp === slice.ip && !!slice.ip
                  const { icon: DevIcon } = getDeviceCategory(slice.name, slice.vendor)

                  return (
                    <div
                      key={slice.name}
                      onClick={() => {
                        if (slice.ip && onSelectDevice) {
                          onSelectDevice(isSelected ? null : slice.ip)
                        }
                      }}
                      className={cn(
                        'flex items-center justify-between text-xs p-1.5 rounded-md transition-all',
                        slice.ip ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default',
                        isSelected && 'bg-primary/10 border border-primary/30'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: slice.color }}
                        />
                        <DevIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <span
                            className={cn(
                              'truncate block font-medium text-[11px]',
                              isSelected ? 'text-primary font-semibold' : 'text-foreground'
                            )}
                            title={slice.ip ? `${slice.name} (${slice.ip})` : slice.name}
                          >
                            {slice.name}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0 flex items-center gap-2 font-mono">
                        <span className="text-[10px] text-muted-foreground">
                          {formatPercent(slice.percent / 100)}
                        </span>
                        <span className="text-[11px] font-semibold text-foreground">
                          {formatBytes(slice.total)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

          {/* RIGHT: Top Devices Timeseries Bandwidth Chart */}
          <div
            className={cn(
              'space-y-3 p-4 rounded-lg border bg-muted/20 flex flex-col justify-between',
              'lg:col-span-7'
            )}
          >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-primary" />
                  <span className="font-semibold text-foreground">
                    Top Devices Bandwidth Over Time
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                  {historyLoading ? (
                    <span>Updating rates...</span>
                  ) : (
                    <span>Throughput (Down + Up)</span>
                  )}
                </div>
              </div>

              <div className="h-[210px] w-full">
                {timeseriesData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    {historyLoading ? 'Loading device timeseries...' : 'No timeseries activity recorded yet.'}
                  </div>
                ) : (
                  <ChartContainer
                    config={timeseriesChartConfig}
                    className="h-[210px] w-full aspect-auto"
                  >
                    <AreaChart data={timeseriesData}>
                      <defs>
                        {timeseriesDevices.map((d, index) => {
                          const color = DEVICE_PALETTE[index % DEVICE_PALETTE.length]
                          const gradId = `devGrad-${d.ip.replace(/[^a-zA-Z0-9]/g, '_')}`
                          return (
                            <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                              <stop offset="95%" stopColor={color} stopOpacity={0.0} />
                            </linearGradient>
                          )
                        })}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="time"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={28}
                        fontSize={10}
                        className="font-mono"
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        fontSize={10}
                        tickFormatter={(val) => formatRate(val)}
                        width={68}
                        className="font-mono"
                      />
                      <ChartTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null
                          return (
                            <div className="rounded-lg border bg-background p-2 shadow-md text-xs space-y-1.5 min-w-[180px]">
                              <div className="font-mono font-medium text-[11px] border-b pb-1 text-muted-foreground">
                                {label}
                              </div>
                              {payload.map((item) => {
                                const ip = item.dataKey as string
                                const dev = timeseriesDevices.find((d) => d.ip === ip)
                                const val = Number(item.value || 0)
                                if (val === 0 && timeseriesDevices.length > 3) return null

                                return (
                                  <div
                                    key={ip}
                                    className="flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: item.color }}
                                      />
                                      <span className="truncate max-w-[110px] text-foreground font-medium">
                                        {dev?.name || ip}
                                      </span>
                                    </div>
                                    <span className="font-mono font-semibold text-foreground shrink-0">
                                      {formatRate(val)}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        }}
                      />
                      {timeseriesDevices.map((d, index) => {
                        const color = DEVICE_PALETTE[index % DEVICE_PALETTE.length]
                        const gradId = `devGrad-${d.ip.replace(/[^a-zA-Z0-9]/g, '_')}`
                        const isSelected = selectedDeviceIp === d.ip
                        const isDimmed = selectedDeviceIp && !isSelected

                        return (
                          <Area
                            key={d.ip}
                            type="monotone"
                            dataKey={d.ip}
                            stroke={color}
                            strokeWidth={isSelected ? 2.5 : 1.75}
                            strokeOpacity={isDimmed ? 0.3 : 1}
                            fillOpacity={isDimmed ? 0.05 : 1}
                            fill={`url(#${gradId})`}
                            isAnimationActive={false}
                          />
                        )
                      })}
                    </AreaChart>
                  </ChartContainer>
                )}
              </div>

              {/* Devices mini indicator row */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t text-[11px]">
                {timeseriesDevices.map((d, idx) => {
                  const color = DEVICE_PALETTE[idx % DEVICE_PALETTE.length]
                  const isSelected = selectedDeviceIp === d.ip

                  return (
                    <button
                      key={d.ip}
                      type="button"
                      onClick={() => onSelectDevice?.(isSelected ? null : d.ip)}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all text-[10px] font-medium',
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary font-semibold shadow-2xs'
                          : 'border-border/60 hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="truncate max-w-[100px]">{d.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
      </CardContent>
    </Card>
  )
})
