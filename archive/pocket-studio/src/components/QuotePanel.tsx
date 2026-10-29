// ─── Quote Panel – Fixed sample quote + plan approval ──────────────────────
import { motion } from 'framer-motion';
import { DollarSign, Clock, CheckCircle, Lock, AlertTriangle } from 'lucide-react';
import type { Job } from '../types';
import { fadeUp } from '../motion';

interface Props {
  job: Job;
  onApprovePlan: () => void;
  onStartProduction: () => void;
}

function cents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

export function QuotePanel({ job, onApprovePlan, onStartProduction }: Props) {
  const { quote, plan, stage } = job;
  const isApproved = !!plan;
  const canApprove = stage === 'quote';
  const canStart = stage === 'approved' && !!plan;

  return (
    <motion.div {...fadeUp} className="space-y-5">
      {/* Disclaimer banner */}
      <div className="flex items-start gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(232,81,42,0.08)', border: '1px solid rgba(232,81,42,0.2)' }}>
        <AlertTriangle size={15} style={{ color: 'var(--coral)', flexShrink: 0, marginTop: 1 }} />
        <p className="text-xs leading-relaxed" style={{ color: '#7a3520' }}>{quote.disclaimer}</p>
      </div>

      {/* Line items */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div className="px-4 py-3" style={{ background: 'var(--ink)' }}>
          <span className="text-xs font-600 uppercase tracking-widest text-white opacity-70">Quote Breakdown</span>
        </div>
        <div className="divide-y" style={{ background: 'var(--surface-strong)' }}>
          {quote.items.map((item, i) => (
            <div key={i} className="flex justify-between items-start px-4 py-3 gap-4">
              <div>
                <p className="text-sm font-600" style={{ color: 'var(--ink)' }}>{item.label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{item.description}</p>
              </div>
              <span className="mono text-sm font-500 tabular-nums shrink-0" style={{ color: 'var(--ink-2)' }}>{cents(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between items-center px-4 py-3.5" style={{ background: 'var(--surface-muted)' }}>
            <span className="font-700 text-sm" style={{ color: 'var(--ink)' }}>Total</span>
            <span className="display text-lg font-700 tabular-nums" style={{ color: 'var(--ink)' }}>{cents(quote.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* Deliverables */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <DollarSign size={14} style={{ color: 'var(--coral)' }} />
          <span className="text-xs font-700 uppercase tracking-wide" style={{ color: 'var(--ink)', letterSpacing: '0.06em' }}>Deliverables</span>
        </div>
        <ul className="space-y-1.5">
          {quote.deliverables.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              <CheckCircle size={13} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
              {d}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 pt-1">
          <Clock size={13} style={{ color: 'var(--muted)' }} />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{quote.timeline}</span>
        </div>
      </div>

      {/* Limitations */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span className="text-xs font-600 uppercase tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>Limitations of this tier</span>
        <ul className="space-y-1">
          {quote.limitations.map((l, i) => (
            <li key={i} className="text-xs" style={{ color: 'var(--muted)' }}>• {l}</li>
          ))}
        </ul>
      </div>

      {/* Plan status */}
      {isApproved && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'rgba(46,196,160,0.1)', border: '1px solid rgba(46,196,160,0.3)' }}>
          <Lock size={14} style={{ color: 'var(--mint)' }} />
          <div>
            <p className="text-xs font-600" style={{ color: '#1a5a4a' }}>Plan v{plan.version} locked</p>
            <p className="text-xs" style={{ color: '#2e7a68' }}>Approved {new Date(plan.lockedAt).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      {canApprove && (
        <button
          onClick={onApprovePlan}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-600 text-sm transition-colors"
          style={{ background: 'var(--ink)', color: '#fff' }}
        >
          <Lock size={16} />
          Approve plan and start production
        </button>
      )}
      {canStart && (
        <button
          onClick={onStartProduction}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-600 text-sm transition-colors"
          style={{ background: '#e8512a', color: '#fff' }}
        >
          <CheckCircle size={16} />
          Begin production
        </button>
      )}

      {/* Payment ledger */}
      <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span className="text-xs font-500" style={{ color: 'var(--muted)' }}>Payment status</span>
        <span className="text-xs font-600 px-2 py-0.5 rounded-full" style={{ background: 'rgba(186,43,76,0.1)', color: '#ba2b4c' }}>
          Unpaid — no payment integration connected
        </span>
      </div>
    </motion.div>
  );
}
