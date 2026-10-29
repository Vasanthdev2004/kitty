// ─── Activity Log – Real in-app event record ───────────────────────────────
import { CheckCircle, Info, AlertTriangle, XCircle } from 'lucide-react';
import type { ActivityEntry } from '../types';

interface Props {
  entries: ActivityEntry[];
}

export function ActivityLog({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: 'var(--subtle)' }}>
        <p className="text-sm">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map(entry => (
        <div key={entry.id} className="flex items-start gap-2.5 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
          <EntryIcon kind={entry.kind} />
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>{entry.message}</p>
            <p className="mono text-xs mt-0.5 opacity-50" style={{ color: 'var(--muted)' }}>
              {new Date(entry.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EntryIcon({ kind }: { kind: ActivityEntry['kind'] }) {
  const size = 13;
  if (kind === 'success') return <CheckCircle size={size} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />;
  if (kind === 'warning') return <AlertTriangle size={size} style={{ color: '#e88a2a', flexShrink: 0, marginTop: 1 }} />;
  if (kind === 'error') return <XCircle size={size} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />;
  return <Info size={size} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }} />;
}
