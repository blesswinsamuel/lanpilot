import { useEffect, useState, useCallback, useMemo } from 'react'
import { Outlet, NavLink, useOutletContext, useSearchParams } from 'react-router-dom'
import { Header } from './Header'
import { rpcClient } from '@/lib/client'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Laptop, Activity, Globe, Server } from 'lucide-react'
import { type Period, isPeriod, getPeriodRange } from '@/lib/period'

export interface RootOutletContext {
  overview: any
  devices: any[]
  health: any
  ddns: any
  isLive: boolean
  isRefreshing: boolean
  error: string | null
  fetchAllData: () => Promise<void>
  period: Period
  setPeriod: (period: Period) => void
  fromUnix: number
  toUnix: number
}

export function useRootOutletContext() {
  return useOutletContext<RootOutletContext>()
}

export function RootLayout() {
  const [searchParams, setSearchParams] = useSearchParams()
  const periodParam = searchParams.get('period')
  const period: Period = periodParam === '24h' ? '1d' : isPeriod(periodParam) ? periodParam : '1d'

  const handlePeriodChange = useCallback((newPeriod: Period) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('period', newPeriod)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [overview, setOverview] = useState<any>(null)
  const [devices, setDevices] = useState<any[]>([])
  const [health, setHealth] = useState<any>(null)
  const [ddns, setDdns] = useState<any>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch all snapshot data (devices, flows, health, overview, ddns) for the current period
  const fetchAllData = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true)
    try {
      const { fromUnix: from, toUnix: to } = getPeriodRange(period)
      const [ov, dev, hl, ddnsRes] = await Promise.all([
        rpcClient.getOverview({
          fromUnix: BigInt(from),
          toUnix: BigInt(to),
        }),
        rpcClient.listDevices({
          fromUnix: BigInt(from),
          toUnix: BigInt(to),
        }),
        rpcClient.getInternetHealth({}),
        rpcClient.getDDNSStatus({}).catch(() => null),
      ])
      setOverview(ov)
      setDevices(dev.devices || [])
      setHealth(hl)
      if (ddnsRes) setDdns(ddnsRes)
      setError(null)
    } catch (err: any) {
      console.error('Failed to fetch lanpilot data:', err)
      setError(err?.message || 'Failed to connect to lanpilot service')
    } finally {
      if (isManual) setIsRefreshing(false)
    }
  }, [period])

  // Initial load and periodic snapshot refresh every 15s (matching TSDB sample interval)
  useEffect(() => {
    fetchAllData(false)
    const interval = setInterval(() => fetchAllData(false), 15000)
    return () => clearInterval(interval)
  }, [fetchAllData])

  const handleManualRefresh = useCallback(() => {
    return fetchAllData(true)
  }, [fetchAllData])

  const isConnected = !error && !!overview
  const { fromUnix, toUnix } = useMemo(() => getPeriodRange(period), [period])

  const outletContext: RootOutletContext = useMemo(() => ({
    overview,
    devices,
    health,
    ddns,
    isLive: isConnected,
    isRefreshing,
    error,
    fetchAllData: handleManualRefresh,
    period,
    setPeriod: handlePeriodChange,
    fromUnix,
    toUnix,
  }), [
    overview,
    devices,
    health,
    ddns,
    isConnected,
    isRefreshing,
    error,
    handleManualRefresh,
    period,
    handlePeriodChange,
    fromUnix,
    toUnix,
  ])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        interfaceName={overview?.interfaceName || 'lan'}
        lanSubnet={overview?.lanSubnetCidr || '10.100.0.0/16'}
        isLive={isConnected}
        internetIsUp={overview ? overview.internetIsUp : true}
        internetStatus={overview?.internetStatus}
        onRefresh={handleManualRefresh}
        isRefreshing={isRefreshing}
        period={period}
        onPeriodChange={handlePeriodChange}
      />

      <main className="container mx-auto px-4 py-6 flex-1 flex flex-col">
        {/* Navigation Bar */}
        <nav className="flex items-center gap-1 p-1 bg-muted/80 rounded-lg w-fit mb-6 overflow-x-auto">
          <NavLink
            to="/overview"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )
            }
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Overview</span>
          </NavLink>
          <NavLink
            to="/devices"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )
            }
          >
            <Laptop className="w-4 h-4" />
            <span>Devices</span>
            {devices.length > 0 && (
              <span className="font-mono text-xs px-1.5 py-0.2 rounded-full bg-muted-foreground/15">
                {devices.length}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/health"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )
            }
          >
            <Activity className="w-4 h-4" />
            <span>Health</span>
          </NavLink>
          <NavLink
            to="/ddns"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )
            }
          >
            <Globe className="w-4 h-4" />
            <span>DDNS</span>
            {ddns?.enabled && (
              <span className={cn(
                "w-1.5 h-1.5 rounded-full inline-block",
                ddns.lastSyncStatus === 'success' ? "bg-emerald-500" :
                ddns.lastSyncStatus === 'failure' ? "bg-destructive" : "bg-amber-500"
              )} />
            )}
          </NavLink>
          <NavLink
            to="/dns"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )
            }
          >
            <Server className="w-4 h-4" />
            <span>DNS Records</span>
          </NavLink>
        </nav>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-between">
            <span>Connection error: {error}. Check if lanpilot is running on the router.</span>
            <button
              onClick={handleManualRefresh}
              className="underline font-semibold hover:opacity-80 ml-4 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex-1 flex flex-col">
          <Outlet context={outletContext} />
        </div>
      </main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Lanpilot &copy; <span className="font-mono">{new Date().getFullYear()}</span> • Connect-RPC over gRPC-Web • Pure-Go SQLite TSDB
      </footer>
    </div>
  )
}
