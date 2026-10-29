// ─── PayTogether – Deadline picker (presets + custom date and time) ─────────
import { useState } from 'react';
import {
  DEADLINE_PRESETS, describeDeadline, joinIso, presetDeadlineIso, splitIso, type DeadlinePreset,
} from '../pt-ui';
import { isoToUnixSeconds } from '../pt-utils';
import { cn } from '../cn';
import { FieldError, TextInput } from './fields';

type Mode = DeadlinePreset | 'custom';
const clockNow = () => Date.now();

const PILL =
  'inline-flex h-9 items-center rounded-full border px-4 text-[13px] font-medium whitespace-nowrap transition-colors duration-150';

export function DeadlinePicker({
  value, onChange, onBlur, error, nowMs,
}: { value: string; onChange: (iso: string) => void; onBlur?: () => void; error?: string; nowMs: number }) {
  const [mode, setMode] = useState<Mode | null>(() => (value ? 'custom' : null));
  const [parts, setParts] = useState(() => splitIso(value));

  function pick(preset: DeadlinePreset) {
    const iso = presetDeadlineIso(preset, clockNow());
    setMode(preset);
    setParts(splitIso(iso));
    onChange(iso);
    onBlur?.();
  }

  function setPart(next: Partial<{ date: string; time: string }>) {
    const merged = { ...parts, ...next };
    setParts(merged);
    onChange(joinIso(merged.date, merged.time));
  }

  const ts = value ? isoToUnixSeconds(value) : 0;
  const d = ts ? describeDeadline(ts, Math.floor(nowMs / 1000)) : null;
  const errId = 'deadline-err';

  return (
    <div className="space-y-2" role="group" aria-labelledby="deadline-label">
      <p id="deadline-label" className="text-[13px] font-medium text-ink-2">Deadline</p>

      <div role="radiogroup" aria-label="Deadline presets" className="flex flex-wrap gap-2">
        {DEADLINE_PRESETS.map(p => {
          const active = mode === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(p.id)}
              className={cn(PILL, active
                ? 'border-line-strong bg-s3 text-ink'
                : 'border-line bg-s2 text-ink-2 hover:border-line-strong hover:text-ink')}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'custom'}
          onClick={() => setMode('custom')}
          className={cn(PILL, mode === 'custom'
            ? 'border-line-strong bg-s3 text-ink'
            : 'border-line bg-s2 text-ink-2 hover:border-line-strong hover:text-ink')}
        >
          Custom
        </button>
      </div>

      {mode === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            type="date"
            aria-label="Deadline date"
            aria-describedby={error ? errId : undefined}
            invalid={!!error}
            value={parts.date}
            onChange={e => setPart({ date: e.target.value })}
            onBlur={onBlur}
            className="tnum"
          />
          <TextInput
            type="time"
            aria-label="Deadline time"
            aria-describedby={error ? errId : undefined}
            invalid={!!error}
            value={parts.time}
            onChange={e => setPart({ time: e.target.value })}
            onBlur={onBlur}
            className="tnum"
          />
        </div>
      )}

      {d ? (
        <p className="text-sm text-ink">
          Closes <span className="font-medium">{d.when}</span>{' '}
          <span className="text-ink-2">({d.rel})</span>
        </p>
      ) : (
        !error && <p className="text-xs leading-relaxed text-ink-3">Pick when funding closes. After that, an unfunded order refunds everyone.</p>
      )}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}
