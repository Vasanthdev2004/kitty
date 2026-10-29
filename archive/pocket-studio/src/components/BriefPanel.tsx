// ─── Brief Panel – View and edit job brief (with required-field validation) ──
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Edit3, CheckCircle, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Job } from '../types';
import { fadeUp } from '../motion';

interface Props {
  job: Job;
  onAdvanceToQuote: () => void;
  onEditBrief: (patch: Partial<Job['brief']>) => void;
  canAdvance: boolean;
}

interface FieldErrors {
  clientName?: string;
  audience?: string;
  goal?: string;
  gameTitle?: string;
}

function validateBriefDraft(d: Job['brief']): FieldErrors {
  const e: FieldErrors = {};
  if (!d.clientName?.trim()) e.clientName = 'Required';
  if (!d.audience?.trim()) e.audience = 'Required';
  if (!d.goal?.trim()) e.goal = 'Required';
  if (!d.gameTitle?.trim()) e.gameTitle = 'Required';
  return e;
}

export function BriefPanel({ job, onAdvanceToQuote, onEditBrief, canAdvance }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(job.brief);
  const [errors, setErrors] = useState<FieldErrors>({});

  function handleSave() {
    const errs = validateBriefDraft(draft);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    onEditBrief(draft);
    setEditing(false);
  }

  function handleCancel() {
    setDraft(job.brief);
    setErrors({});
    setEditing(false);
  }

  const isSample = job.id === 'job-orbit-001';

  return (
    <motion.div {...fadeUp} className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--coral)' }}>Client Brief</span>
            {isSample && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--mint-light)', color: 'var(--mint)' }}>
                Sample — Orbit Soda
              </span>
            )}
          </div>
          <h2 className="display text-2xl font-700" style={{ color: 'var(--ink)' }}>{job.brief.gameTitle}</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>for {job.brief.clientName}</p>
        </div>
        {!editing && (
          <button
            onClick={() => { setDraft(job.brief); setErrors({}); setEditing(true); }}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            <Edit3 size={14} />Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} style={{ color: 'var(--coral)', flexShrink: 0 }} />
            <p className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>
              Editing brief — if plan is already approved, approval will be invalidated
            </p>
          </div>
          <EditField label="Client Name" error={errors.clientName} required>
            <input
              value={draft.clientName}
              onChange={e => { setDraft(d => ({ ...d, clientName: e.target.value })); setErrors(prev => ({ ...prev, clientName: undefined })); }}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle(!!errors.clientName)}
              aria-required="true"
            />
          </EditField>
          <EditField label="Audience" error={errors.audience} required>
            <input
              value={draft.audience}
              onChange={e => { setDraft(d => ({ ...d, audience: e.target.value })); setErrors(prev => ({ ...prev, audience: undefined })); }}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle(!!errors.audience)}
            />
          </EditField>
          <EditField label="Campaign Goal" error={errors.goal} required>
            <input
              value={draft.goal}
              onChange={e => { setDraft(d => ({ ...d, goal: e.target.value })); setErrors(prev => ({ ...prev, goal: undefined })); }}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle(!!errors.goal)}
            />
          </EditField>
          <EditField label="Game Title" error={errors.gameTitle} required>
            <input
              value={draft.gameTitle}
              onChange={e => { setDraft(d => ({ ...d, gameTitle: e.target.value })); setErrors(prev => ({ ...prev, gameTitle: undefined })); }}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle(!!errors.gameTitle)}
            />
          </EditField>
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Primary Color">
              <div className="flex items-center gap-2">
                <input type="color" value={draft.colors.primary} onChange={e => setDraft(d => ({ ...d, colors: { ...d.colors, primary: e.target.value } }))} className="w-10 h-8 rounded cursor-pointer" />
                <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{draft.colors.primary}</span>
              </div>
            </EditField>
            <EditField label="Accent Color">
              <div className="flex items-center gap-2">
                <input type="color" value={draft.colors.accent} onChange={e => setDraft(d => ({ ...d, colors: { ...d.colors, accent: e.target.value } }))} className="w-10 h-8 rounded cursor-pointer" />
                <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{draft.colors.accent}</span>
              </div>
            </EditField>
          </div>
          {Object.keys(errors).length > 0 && (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>Fix required fields before saving.</p>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm font-600" style={{ background: 'var(--ink)', color: '#fff' }}>
              Save changes
            </button>
            <button onClick={handleCancel} className="px-4 py-2.5 rounded-xl text-sm font-500" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Row label="Audience" value={job.brief.audience} />
          <Row label="Goal" value={job.brief.goal} />
          <Row label="Game format" value="30-second arcade collector" />
          <div className="flex items-center gap-3 pt-1">
            <span className="text-xs font-500" style={{ color: 'var(--muted)' }}>Brand palette</span>
            <Swatch color={job.brief.colors.primary} />
            <Swatch color={job.brief.colors.accent} />
          </div>
        </div>
      )}

      {canAdvance && !editing && (
        <button
          onClick={onAdvanceToQuote}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-600 text-sm"
          style={{ background: 'var(--ink)', color: '#fff' }}
        >
          <CheckCircle size={16} />
          Review brief and see quote
          <ChevronRight size={16} />
        </button>
      )}
    </motion.div>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return { background: 'var(--surface-muted)', border: `1px solid ${hasError ? 'var(--danger)' : 'var(--border)'}`, color: 'var(--ink)' };
}

function EditField({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-600 uppercase tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
        {label}{required && <span style={{ color: 'var(--coral)' }}> *</span>}
      </span>
      {children}
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs font-500 min-w-24 pt-0.5" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-sm flex-1" style={{ color: 'var(--ink-2)' }}>{value}</span>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-5 h-5 rounded" style={{ background: color, border: '1px solid var(--border-strong)' }} />
      <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{color}</span>
    </div>
  );
}
