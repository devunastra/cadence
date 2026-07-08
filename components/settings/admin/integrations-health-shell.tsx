'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, X } from 'lucide-react'
import { fetchAllStudioHealth, fetchMyStudiosHealth, type StudioHealthEntry } from '@/app/actions'
import type { HealthStatus, HealthResult, IntegrationKind } from '@/lib/integration-health'

export type HealthScope = 'all' | 'own'

// Map HealthStatus onto the existing status-bg-* / status-text-* classes documented
// in rules/ui-styling.md, so the page inherits light/dark colours for free.
const STATUS_CLASSES: Record<HealthStatus, { bg: string; text: string; label: string; help: string }> = {
  ok:             { bg: 'status-bg-green',  text: 'status-text-green',  label: 'OK',       help: 'Probe succeeded' },
  warn:           { bg: 'status-bg-yellow', text: 'status-text-yellow', label: 'Warn',     help: 'Probe OK but activity is stale' },
  error:          { bg: 'status-bg-red',    text: 'status-text-red',    label: 'Error',    help: 'Probe failed — needs attention' },
  unknown:        { bg: 'status-bg-blue',   text: 'status-text-blue',   label: 'Unknown',  help: 'Timed out or rate-limited — retry' },
  not_configured: { bg: 'status-bg-gray',   text: 'status-text-gray',   label: 'Not set',  help: 'No credentials configured' },
}

const INTEGRATIONS: Array<{ key: IntegrationKind; label: string }> = [
  { key: 'ghl',           label: 'GHL' },
  { key: 'retell',        label: 'Retell' },
  { key: 'n8n_callbacks', label: 'n8n Callbacks' },
]

function StatusPill({ status }: { status: HealthStatus }) {
  const cls = STATUS_CLASSES[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${cls.bg} ${cls.text}`}>
      {cls.label}
    </span>
  )
}

function Legend() {
  return (
    <div
      className="flex items-center gap-2 flex-wrap text-xs rounded-lg px-3 py-2"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>Legend:</span>
      {(Object.keys(STATUS_CLASSES) as HealthStatus[]).map(s => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusPill status={s} />
          <span>{STATUS_CLASSES[s].help}</span>
        </span>
      ))}
    </div>
  )
}

interface DrawerData {
  studioName: string
  integration: string
  result: HealthResult
}

export function IntegrationsHealthShell({ scope = 'all' }: { scope?: HealthScope }) {
  const [entries, setEntries] = useState<StudioHealthEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerData | null>(null)
  const [lastProbedAt, setLastProbedAt] = useState<string | null>(null)

  const runProbes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = scope === 'own' ? await fetchMyStudiosHealth() : await fetchAllStudioHealth()
      setEntries(res.entries)
      setLastProbedAt(new Date().toISOString())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { void runProbes() }, [runProbes])

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Integration Health</h2>
          <p className="text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {scope === 'own'
              ? 'Live probe of GHL, Retell, and n8n callbacks for your studios. Read-only.'
              : 'Live probe of GHL, Retell, and n8n callbacks across every studio. Read-only.'}
          </p>
        </div>
        <button
          onClick={() => void runProbes()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            transition: 'var(--transition-fast)',
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Probing…' : 'Refresh'}
        </button>
      </header>

      {lastProbedAt && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Last probed {new Date(lastProbedAt).toLocaleString()}
        </p>
      )}

      <Legend />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg" style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
        }}>
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {/* Table (desktop) / cards (mobile) */}
      <div
        className="hidden md:block rounded-xl overflow-hidden shadow-sm"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
      >
        <table className="w-full text-sm border-collapse">
          <thead style={{ backgroundColor: 'var(--color-surface)' }}>
            <tr>
              <th className="pl-4 pr-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{
                color: 'var(--color-text-muted)',
                borderBottom: '1px solid var(--color-border)',
              }}>Studio</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{
                color: 'var(--color-text-muted)',
                borderBottom: '1px solid var(--color-border)',
              }}>Overall</th>
              {INTEGRATIONS.map(({ label }) => (
                <th key={label} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{
                  color: 'var(--color-text-muted)',
                  borderBottom: '1px solid var(--color-border)',
                }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries === null && !error && (
              <tr>
                <td colSpan={2 + INTEGRATIONS.length} className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  Loading…
                </td>
              </tr>
            )}
            {entries?.length === 0 && (
              <tr>
                <td colSpan={2 + INTEGRATIONS.length} className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  No studios to probe.
                </td>
              </tr>
            )}
            {entries?.map(entry => (
              <tr key={entry.studio_id} className="transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="pl-4 pr-4 py-3 align-middle font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {entry.studio_name}
                </td>
                <td className="px-4 py-3 align-middle">
                  <StatusPill status={entry.overall} />
                </td>
                {INTEGRATIONS.map(({ key, label }) => {
                  const result = entry.snapshot.results[key]
                  const isClickable = result.status !== 'ok' && result.status !== 'not_configured'
                  return (
                    <td key={key} className="px-4 py-3 align-middle">
                      <button
                        type="button"
                        onClick={() => isClickable && setDrawer({ studioName: entry.studio_name, integration: label, result })}
                        className={isClickable ? 'cursor-pointer' : 'cursor-default'}
                        aria-label={isClickable ? `View ${label} details for ${entry.studio_name}` : undefined}
                      >
                        <StatusPill status={result.status} />
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {entries?.map(entry => (
          <div key={entry.studio_id} className="rounded-xl p-4 space-y-3" style={{
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-bg)',
          }}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{entry.studio_name}</div>
              <StatusPill status={entry.overall} />
            </div>
            <div className="space-y-2">
              {INTEGRATIONS.map(({ key, label }) => {
                const result = entry.snapshot.results[key]
                const isClickable = result.status !== 'ok' && result.status !== 'not_configured'
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => isClickable && setDrawer({ studioName: entry.studio_name, integration: label, result })}
                    className="flex items-center justify-between w-full text-sm"
                  >
                    <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                    <StatusPill status={result.status} />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Detail drawer */}
      {drawer && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center md:justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setDrawer(null)}
        >
          <div
            className="w-full md:w-96 md:h-full p-5 space-y-4"
            style={{
              backgroundColor: 'var(--color-bg)',
              borderLeft: '1px solid var(--color-border)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{drawer.studioName}</div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>{drawer.integration}</h3>
              </div>
              <button onClick={() => setDrawer(null)} className="p-2.5 md:p-1 rounded-md" aria-label="Close">
                <X size={16} style={{ color: 'var(--color-text-secondary)' }} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Status</span>
                <StatusPill status={drawer.result.status} />
              </div>
              {drawer.result.message && (
                <div>
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>Message</div>
                  <div className="text-sm rounded-lg p-3 whitespace-pre-wrap break-words" style={{
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                  }}>{drawer.result.message}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div style={{ color: 'var(--color-text-muted)' }}>Checked</div>
                  <div style={{ color: 'var(--color-text-primary)' }}>
                    {new Date(drawer.result.checkedAt).toLocaleTimeString()}
                  </div>
                </div>
                {drawer.result.latencyMs !== undefined && (
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>Latency</div>
                    <div style={{ color: 'var(--color-text-primary)' }}>{drawer.result.latencyMs} ms</div>
                  </div>
                )}
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                To fix credentials, go to Settings → Business Profile for the affected studio.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
