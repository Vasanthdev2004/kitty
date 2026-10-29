// ─── Providers Panel – Honest local vs. optional services ─────────────────
import { motion } from 'framer-motion';
import { Cpu, Link2Off, Info } from 'lucide-react';
import { fadeUp } from '../motion';

export function ProvidersPanel() {
  const providers = [
    {
      name: 'Local Template Engine',
      role: 'Art compilation, game build, QA checks, packaging',
      status: 'active',
      note: 'Runs entirely in-browser. No external call.',
      type: 'local',
    },
    {
      name: 'AI Creative Service',
      role: 'Optional: generative art, copy suggestions, dynamic branding',
      status: 'disconnected',
      note: 'Not connected. Would require an API key and billing. Not used in any current job.',
      type: 'optional',
    },
    {
      name: 'Payment Gateway',
      role: 'Optional: invoice generation, payment collection',
      status: 'disconnected',
      note: 'Not connected. No payment has been processed. Quote amounts are illustrative.',
      type: 'optional',
    },
    {
      name: 'Asset CDN / Hosting',
      role: 'Optional: hosted preview URLs, embed delivery',
      status: 'disconnected',
      note: 'Not connected. Preview runs locally in this session only.',
      type: 'optional',
    },
  ];

  return (
    <motion.div {...fadeUp} className="space-y-5">
      <div>
        <span className="text-xs font-700 uppercase tracking-widest" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>Providers</span>
        <h2 className="display text-xl font-700 mt-1" style={{ color: 'var(--ink)' }}>Service connections</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          What powers each stage. Optional services are listed but not connected.
        </p>
      </div>

      <div className="space-y-3">
        {providers.map(p => (
          <div key={p.name} className="rounded-2xl p-4" style={{
            background: 'var(--surface)',
            border: `1px solid ${p.status === 'active' ? 'rgba(46,196,160,0.3)' : 'var(--border)'}`,
          }}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5" style={{ flexShrink: 0 }}>
                {p.type === 'local'
                  ? <Cpu size={16} style={{ color: 'var(--mint)' }} />
                  : <Link2Off size={16} style={{ color: 'var(--subtle)' }} />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-600" style={{ color: 'var(--ink)' }}>{p.name}</p>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-500"
                    style={{
                      background: p.status === 'active' ? 'rgba(46,196,160,0.15)' : 'var(--surface-muted)',
                      color: p.status === 'active' ? 'var(--mint)' : 'var(--subtle)',
                    }}
                  >
                    {p.status === 'active' ? 'Active' : 'Disconnected'}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{p.role}</p>
                <div className="flex items-start gap-1.5 mt-2">
                  <Info size={11} style={{ color: 'var(--subtle)', marginTop: 1, flexShrink: 0 }} />
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>{p.note}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl px-4 py-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Specialized studios and marketplace providers are future scope — not pretend-active functionality. This panel lists what is actually running.
        </p>
      </div>
    </motion.div>
  );
}
