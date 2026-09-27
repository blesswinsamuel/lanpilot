import { useState, useEffect } from 'react'
import { X, Check, Trash2, AlertCircle } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { rpcClient } from '@/lib/client'
import type { ConfigDnsRecord } from '@/gen/lanpilot/v1/lanpilot_pb'

interface EditDnsRecordModalProps {
  isOpen: boolean
  onClose: () => void
  record?: ConfigDnsRecord | null
  onSaved: () => void
}

export function EditDnsRecordModal({ isOpen, onClose, record, onSaved }: EditDnsRecordModalProps) {
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [aliasesStr, setAliasesStr] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = Boolean(record?.name)

  useEffect(() => {
    if (!isOpen) return
    if (record) {
      setName(record.name || '')
      setIp(record.ip || '')
      setAliasesStr(record.aliases?.join(', ') || '')
    } else {
      setName('')
      setIp('')
      setAliasesStr('')
    }
    setError(null)
  }, [isOpen, record])

  if (!isOpen) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Record hostname/name is required.')
      return
    }
    if (!ip.trim()) {
      setError('IP address is required.')
      return
    }

    setIsSaving(true)
    try {
      const aliases = aliasesStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      await rpcClient.upsertConfigDnsRecord({
        record: {
          $typeName: 'lanpilot.v1.ConfigDnsRecord',
          name: name.trim().toLowerCase(),
          ip: ip.trim(),
          aliases,
        },
      })
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save DNS record')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!record?.name) return
    if (!window.confirm(`Are you sure you want to delete DNS record "${record.name}"?`)) {
      return
    }

    setIsDeleting(true)
    try {
      await rpcClient.deleteConfigDnsRecord({ name: record.name })
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete DNS record')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-md rounded-xl border bg-card p-6 shadow-xl text-card-foreground flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4">
          <h3 className="text-lg font-semibold tracking-tight">
            {isEditing ? 'Edit DNS Record' : 'Add Static DNS Record'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Static records are written to <code className="bg-muted px-1 rounded text-foreground font-mono">devices.yaml</code> and reloaded into dnsmasq hosts immediately.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Host Name</label>
            <Input
              placeholder="e.g. photos, vaultwarden, nas"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEditing}
              className="font-mono text-xs"
            />
            {isEditing && (
              <p className="text-[10px] text-muted-foreground mt-1">Host name is the unique key and cannot be renamed directly.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Target IP Address</label>
            <Input
              placeholder="e.g. 10.100.1.200"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Aliases / FQDNs</label>
            <p className="text-[10px] text-muted-foreground mb-1.5">
              Comma-separated alternative names for this IP. Names starting with <code className="font-mono">*.</code> are
              rendered as wildcard <code className="font-mono">address=</code> entries matching the domain and all subdomains.
            </p>
            <Input
              placeholder="photos.home.lan, *.home.bless.win"
              value={aliasesStr}
              onChange={(e) => setAliasesStr(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between pt-4 border-t mt-6">
            {isEditing ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting || isSaving}
                className="gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSaving || isDeleting} className="gap-1.5">
                <Check className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Record'}</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
