// ─── New Brief Form – Validated + draft-preserving ─────────────────────────
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Brief } from '../types';

interface Props {
  draft: Partial<Brief>;
  onUpdate: (patch: Partial<Brief>) => void;
  onSubmit: (brief: Brief) => void;
  onCancel: () => void;
}

export function NewBriefForm({ draft, onUpdate, onSubmit, onCancel }: Props) {
  const [errors, setErrors] = useState<Partial<Record<keyof Brief, string>>>({});

  function validate(): Brief | null {
    const e: typeof errors = {};
    if (!draft.clientName?.trim()) e.clientName = 'Client name is required';
    if (!draft.audience?.trim()) e.audience = 'Audience description is required';
    if (!draft.goal?.trim()) e.goal = 'Campaign goal is required';
    if (!draft.gameTitle?.trim()) e.gameTitle = 'Game title is required';
    if (!draft.colors?.primary) e.colors = 'Primary color is required';
    if (!draft.colors?.accent) e.colors = 'Accent color is required';
    setErrors(e);
    if (Object.keys(e).length > 0) return null;
    return {
      id: `brief-${Date.now()}`,
      clientName: draft.clientName!.trim(),
      audience: draft.audience!.trim(),
      goal: draft.goal!.trim(),
      gameTitle: draft.gameTitle!.trim(),
      colors: { primary: draft.colors!.primary, accent: draft.colors!.accent },
      localImageDataUrl: draft.localImageDataUrl,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const brief = validate();
    if (brief) onSubmit(brief);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setErrors(prev => ({ ...prev, localImageDataUrl: 'Image must be under 512 KB' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      onUpdate({ localImageDataUrl: ev.target?.result as string });
      setErrors(prev => { const { localImageDataUrl: _, ...rest } = prev; return rest; });
    };
    reader.readAsDataURL(file);
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(18,45,69,0.55)', backdropFilter: 'blur(4px)' }}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 36 }}
          className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden"
          style={{ background: 'var(--bg)', maxHeight: '92dvh', overflowY: 'auto' }}
        >
          {/* Header */}
          <div className="sticky top-0 flex items-center justify-between px-5 py-4 z-10" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 className="display text-lg font-700" style={{ color: 'var(--ink)' }}>New client brief</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Draft auto-saved — cancel to return without submitting</p>
            </div>
            <button
              onClick={onCancel}
              className="p-2 rounded-xl"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
              aria-label="Cancel"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">
            <FormField label="Client / Brand Name" error={errors.clientName} required>
              <input
                value={draft.clientName ?? ''}
                onChange={e => { onUpdate({ clientName: e.target.value }); setErrors(prev => ({ ...prev, clientName: undefined })); }}
                placeholder="e.g. Nova Coffee Co."
                className="w-full rounded-xl px-3.5 py-2.5 text-sm"
                style={fieldStyle(!!errors.clientName)}
                aria-required="true"
              />
            </FormField>

            <FormField label="Target Audience" error={errors.audience} required>
              <input
                value={draft.audience ?? ''}
                onChange={e => { onUpdate({ audience: e.target.value }); setErrors(prev => ({ ...prev, audience: undefined })); }}
                placeholder="e.g. Young adults 18-30 interested in specialty coffee"
                className="w-full rounded-xl px-3.5 py-2.5 text-sm"
                style={fieldStyle(!!errors.audience)}
              />
            </FormField>

            <FormField label="Campaign Goal" error={errors.goal} required>
              <input
                value={draft.goal ?? ''}
                onChange={e => { onUpdate({ goal: e.target.value }); setErrors(prev => ({ ...prev, goal: undefined })); }}
                placeholder="e.g. Drive app downloads for loyalty program"
                className="w-full rounded-xl px-3.5 py-2.5 text-sm"
                style={fieldStyle(!!errors.goal)}
              />
            </FormField>

            <FormField label="Game Title" error={errors.gameTitle} required>
              <input
                value={draft.gameTitle ?? ''}
                onChange={e => { onUpdate({ gameTitle: e.target.value }); setErrors(prev => ({ ...prev, gameTitle: undefined })); }}
                placeholder="e.g. Bean Rush"
                className="w-full rounded-xl px-3.5 py-2.5 text-sm"
                style={fieldStyle(!!errors.gameTitle)}
              />
            </FormField>

            <FormField label="Brand Colors" error={errors.colors}>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Primary</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={draft.colors?.primary ?? '#1a1a2e'}
                      onChange={e => { onUpdate({ colors: { ...(draft.colors ?? { primary: '#1a1a2e', accent: '#e8512a' }), primary: e.target.value } }); }}
                      className="w-10 h-9 rounded-lg cursor-pointer"
                      style={{ border: '1px solid var(--border)' }}
                    />
                    <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{draft.colors?.primary ?? '—'}</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Accent</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={draft.colors?.accent ?? '#e8512a'}
                      onChange={e => { onUpdate({ colors: { ...(draft.colors ?? { primary: '#1a1a2e', accent: '#e8512a' }), accent: e.target.value } }); }}
                      className="w-10 h-9 rounded-lg cursor-pointer"
                      style={{ border: '1px solid var(--border)' }}
                    />
                    <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{draft.colors?.accent ?? '—'}</span>
                  </div>
                </label>
              </div>
            </FormField>

            <FormField label="Brand Asset (optional)" error={errors.localImageDataUrl}>
              <div className="flex items-center gap-3">
                <label
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm cursor-pointer"
                  style={{ background: 'var(--surface-muted)', border: '1px dashed var(--border-strong)', color: 'var(--ink-2)' }}
                >
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="sr-only" />
                  Upload image (max 512 KB)
                </label>
                {draft.localImageDataUrl && (
                  <img src={draft.localImageDataUrl} alt="Brand asset" className="w-10 h-10 rounded-lg object-cover" style={{ border: '1px solid var(--border)' }} />
                )}
              </div>
            </FormField>

            {/* Brand preview */}
            {draft.colors && (
              <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: draft.colors.primary || 'var(--ink)', border: '1px solid var(--border)' }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center font-700 text-xl display" style={{ background: draft.colors.accent || '#e8512a', color: draft.colors.primary || '#fff' }}>
                  {draft.clientName?.charAt(0)?.toUpperCase() ?? 'B'}
                </div>
                <div>
                  <p className="font-700 text-sm display" style={{ color: draft.colors.accent || '#fff' }}>{draft.clientName || 'Brand Name'}</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{draft.gameTitle || 'Game Title'}</p>
                </div>
              </div>
            )}

            {Object.keys(errors).length > 0 && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)' }}>
                <AlertTriangle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <p className="text-xs" style={{ color: 'var(--danger)' }}>Please fix the errors above before submitting.</p>
              </div>
            )}

            <div className="flex gap-2 pb-2">
              <button
                type="submit"
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-600 text-sm"
                style={{ background: 'var(--ink)', color: '#fff' }}
              >
                Create brief and see quote
                <ChevronRight size={15} />
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-3 rounded-2xl text-sm font-500"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function fieldStyle(hasError: boolean): React.CSSProperties {
  return {
    background: 'var(--surface-muted)',
    border: `1px solid ${hasError ? 'var(--danger)' : 'var(--border)'}`,
    color: 'var(--ink)',
    outline: 'none',
  };
}

function FormField({ label, error, required, children }: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-600 uppercase tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
        {label}{required && <span style={{ color: 'var(--coral)' }}> *</span>}
      </span>
      {children}
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </label>
  );
}
