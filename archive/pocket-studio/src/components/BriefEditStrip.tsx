// ─── Brief Edit Strip ─────────────────────────────────────────────────────────
// Shown at the top of every panel after 'brief' stage. Lets the operator
// open an inline editor. Saving invalidates approval/artifacts/QA/acceptance.
import { useState } from 'react';
import { Edit3, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { Job } from '../types';

interface Props {
  job: Job;
  onEditBrief: (patch: Partial<Job['brief']>) => void;
}

const REQUIRED = ['clientName', 'audience', 'goal', 'gameTitle'] as const;

function validate(d: Job['brief']): Partial<Record<keyof Job['brief'], string>> {
  const e: Partial<Record<keyof Job['brief'], string>> = {};
  if (!d.clientName?.trim()) e.clientName = 'Required';
  if (!d.audience?.trim()) e.audience = 'Required';
  if (!d.goal?.trim()) e.goal = 'Required';
  if (!d.gameTitle?.trim()) e.gameTitle = 'Required';
  if (!d.colors?.primary) e.colors = 'Primary color required';
  if (!d.colors?.accent) e.colors = 'Accent color required';
  return e;
}

export function BriefEditStrip({ job, onEditBrief }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(job.brief);
  const [errors, setErrors] = useState<Partial<Record<keyof Job['brief'], string>>>({});

  const isLocked = job.stage !== 'brief' && job.stage !== 'quote';

  function handleOpen() {
    setDraft(job.brief);
    setErrors({});
    setOpen(true);
  }

  function handleSave() {
    const e = validate(draft);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    onEditBrief(draft);
    setOpen(false);
  }

  function handleCancel() {
    setDraft(job.brief);
    setErrors({});
    setOpen(false);
  }

  return (
    <div className="mb-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* Collapsed header */}
      <button
        onClick={open ? handleCancel : handleOpen}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left"
        style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
      >
        <Edit3 size={13} />
        <span className="text-xs font-600 flex-1">
          Brief — {job.brief.clientName} / {job.brief.gameTitle}
        </span>
        {isLocked && !open && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)', fontSize: 10 }}>
            Edit will reset approval
          </span>
        )}
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {/* Expanded editor */}
      {open && (
        <div className="px-4 py-4 space-y-3" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          {isLocked && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(232,138,42,0.08)', border: '1px solid rgba(232,138,42,0.25)' }}>
              <AlertTriangle size={13} style={{ color: '#e88a2a', flexShrink: 0, marginTop: 1 }} />
              <p className="text-xs" style={{ color: '#8a4800' }}>
                Saving will invalidate the current approval, artifacts, and QA results. A new plan approval will be required before production can resume.
              </p>
            </div>
          )}

          {(['clientName', 'audience', 'goal', 'gameTitle'] as typeof REQUIRED[number][]).map(field => (
            <label key={field} className="block space-y-1">
              <span className="text-xs font-600 uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
                {field === 'clientName' ? 'Client Name' : field === 'gameTitle' ? 'Game Title' : field === 'audience' ? 'Audience' : 'Campaign Goal'}
              </span>
              <input
                value={draft[field]}
                onChange={e => { setDraft(d => ({ ...d, [field]: e.target.value })); setErrors(prev => ({ ...prev, [field]: undefined })); }}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{
                  background: 'var(--surface-muted)',
                  border: `1px solid ${errors[field] ? 'var(--danger)' : 'var(--border)'}`,
                  color: 'var(--ink)',
                  outline: 'none',
                }}
              />
              {errors[field] && <p className="text-xs" style={{ color: 'var(--danger)' }}>{errors[field]}</p>}
            </label>
          ))}

          <div className="grid grid-cols-2 gap-3">
            {(['primary', 'accent'] as const).map(key => (
              <label key={key} className="block space-y-1">
                <span className="text-xs font-600 uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
                  {key === 'primary' ? 'Primary color' : 'Accent color'}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.colors[key]}
                    onChange={e => setDraft(d => ({ ...d, colors: { ...d.colors, [key]: e.target.value } }))}
                    className="w-10 h-8 rounded cursor-pointer border-0 p-0"
                  />
                  <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{draft.colors[key]}</span>
                </div>
              </label>
            ))}
          </div>
          {errors.colors && <p className="text-xs" style={{ color: 'var(--danger)' }}>{errors.colors}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 py-2 rounded-xl text-sm font-600"
              style={{ background: 'var(--ink)', color: '#fff' }}
            >
              Save brief
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-sm font-500"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
