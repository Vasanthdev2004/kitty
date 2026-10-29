// ─── Preview Panel – Playable preview + customer acceptance ───────────────
import { motion } from 'framer-motion';
import { CheckCircle, Eye, AlertTriangle } from 'lucide-react';
import { ArcadeGame } from './ArcadeGame';
import type { Job } from '../types';
import { fadeUp } from '../motion';

interface Props {
  job: Job;
  onAccept: () => void;
}

export function PreviewPanel({ job, onAccept }: Props) {
  const accepted = job.stage === 'accepted';

  return (
    <motion.div {...fadeUp} className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Eye size={15} style={{ color: 'var(--mint)' }} />
          <span className="text-xs font-700 uppercase tracking-widest" style={{ color: 'var(--mint)', letterSpacing: '0.08em' }}>Customer Preview</span>
        </div>
        <h2 className="display text-xl font-700" style={{ color: 'var(--ink)' }}>{job.brief.gameTitle}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>for {job.brief.clientName} — playable preview</p>
      </div>

      {/* Game */}
      <ArcadeGame
        gameTitle={job.brief.gameTitle}
        clientName={job.brief.clientName}
        colors={job.brief.colors}
        ctaText={`${job.brief.gameTitle} by ${job.brief.clientName}`}
      />

      {/* Acceptance */}
      {!accepted ? (
        <div className="space-y-3">
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(46,196,160,0.08)', border: '1px solid rgba(46,196,160,0.25)' }}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} style={{ color: 'var(--mint)', flexShrink: 0, marginTop: 1 }} />
              <p className="text-xs leading-relaxed" style={{ color: '#1a5a4a' }}>
                <strong>Local demo action only.</strong> Customer acceptance is recorded in this preview session. It does not submit anything externally, trigger payment, or confirm any real transaction.
              </p>
            </div>
          </div>
          <button
            onClick={onAccept}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-600 text-sm"
            style={{ background: 'var(--mint)', color: '#fff' }}
          >
            <CheckCircle size={16} />
            Accept deliverable (local demo)
          </button>
        </div>
      ) : (
        <div className="rounded-2xl px-5 py-4 space-y-2" style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.25)' }}>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} style={{ color: 'var(--success)' }} />
            <span className="font-700 text-sm" style={{ color: 'var(--success)' }}>Deliverable accepted</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--success)' }}>Accepted {new Date(job.acceptedAt ?? '').toLocaleString()}</p>
          <div className="rounded-lg px-3 py-2 mt-2" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)' }}>
            <p className="text-xs font-600" style={{ color: '#ba2b4c' }}>
              Payment ledger: Unpaid — no payment integration connected
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
