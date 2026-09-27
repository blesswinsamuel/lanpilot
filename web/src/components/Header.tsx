import React from 'react'
import { Activity, Moon, Sun, RefreshCw, Radio, Server } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { cn } from '@/lib/utils'

import type { Period } from '@/lib/period'
import { PERIODS } from '@/lib/period'

interface HeaderProps {
  interfaceName: string
  lanSubnet: string
  isLive: boolean
  internetIsUp: boolean
  internetStatus?: string
  onRefresh: () => void
  isRefreshing: boolean
  period: Period
  onPeriodChange: (period: Period) => void
}

export function Header({
  interfaceName,
  lanSubnet,
  isLive,
  internetIsUp,
  internetStatus,
  onRefresh,
  isRefreshing,
  period,
  onPeriodChange,
}: HeaderProps) {
  const [isDark, setIsDark] = React.useState(true)

  const toggleTheme = () => {
    const root = document.documentElement
    if (isDark) {
      root.classList.remove('dark')
      setIsDark(false)
    } else {
      root.classList.add('dark')
      setIsDark(true)
    }
  }

  const isDegraded = internetStatus === 'degraded'
  const isDown = !internetIsUp || internetStatus === 'down'

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-semibold text-sm leading-none tracking-tight">LAN Pilot</h1>
              {isLive ? (
                <Badge variant="outline" className="flex items-center gap-1.5 text-[11px] py-0 px-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-normal">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  Live
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[11px] py-0 px-2 font-normal">Polling</Badge>
              )}
            </div>
            <div className="flex items-center space-x-2 mt-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 font-mono">
                <Server className="w-3 h-3" /> {interfaceName || 'lan'}
              </span>
              <span>•</span>
              <span className="font-mono">{lanSubnet || '10.100.0.0/16'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Global Period Selector */}
          <div className="flex items-center bg-muted/80 p-0.5 rounded-lg border border-border/50 shrink-0">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPeriodChange(p)}
                className={cn(
                  "px-2 py-0.5 text-xs font-mono font-medium rounded-md transition-all cursor-pointer",
                  period === p
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                {p}
              </button>
            ))}
          </div>

          <Badge
            variant={isDown ? "destructive" : "outline"}
            className={cn(
              "gap-1.5 hidden sm:flex text-xs font-normal",
              isDegraded && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              !isDown && !isDegraded && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}
          >
            <Radio className="w-3 h-3" />
            {isDegraded ? "Internet Degraded" : isDown ? "Internet Offline" : "Internet Online"}
          </Badge>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh metrics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </header>
  )
}
