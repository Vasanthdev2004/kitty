// ─── Studio Floor – Illustrated SVG workspace ───────────────────────────────
// Animations indicate active computation only.
// Waiting stages (approved, qa, preview, accepted) and idle stages are still.
import type { WorkflowStage } from '../types';

type RoomId = 'desk' | 'build' | 'qa';

interface Props {
  stage: WorkflowStage;
  isComputing?: boolean; // true only when a production step is actively running
  onRoomClick?: (room: RoomId) => void; // navigate to that room's panel (no workflow change)
}

// Which room is active (lit, interactive focus indicator)
function roomActive(stage: WorkflowStage): 'desk' | 'build' | 'qa' | null {
  if (stage === 'brief' || stage === 'quote') return 'desk';
  if (stage === 'production') return 'build';
  if (stage === 'qa') return 'qa';
  return null; // approved, preview, accepted — no room animating
}

export function StudioFloor({ stage, isComputing = false, onRoomClick }: Props) {
  const activeRoom = roomActive(stage);

  // Only animate the desk when at brief/quote (editing = active local work)
  // Only animate build room when production is actually running (isComputing)
  // Only animate QA room when QA stage and checks are running (isComputing)
  const deskAnimates = activeRoom === 'desk';
  const buildAnimates = activeRoom === 'build' && isComputing;
  const qaAnimates = activeRoom === 'qa' && isComputing;

  // Path segments light up when production has progressed
  const pathBuildLit = stage === 'production' || stage === 'qa' || stage === 'preview' || stage === 'accepted';
  const pathQALit = stage === 'qa' || stage === 'preview' || stage === 'accepted';

  const PRIMARY = '#0f2e58';
  const ACCENT = '#b8e04a';

  return (
    <div className="relative w-full select-none" style={{ maxWidth: 640, margin: '0 auto' }}>
      <svg
        viewBox="0 0 640 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={`Studio floor — current stage: ${stage}`}
        role="img"
        style={{ width: '100%', height: 'auto' }}
      >
        {/* ── Floor ─────────────────────────────────────────────────────── */}
        <rect x="0" y="160" width="640" height="60" fill="#ede9df" />
        <rect x="0" y="155" width="640" height="8" rx="4" fill="#ddd8cc" />

        {/* ── Connecting path ────────────────────────────────────────────── */}
        <path d="M 150 150 Q 200 100 220 150 Q 320 200 320 150 Q 380 100 420 150 Q 480 200 490 150"
          stroke="#c8c2b8" strokeWidth="2" strokeDasharray="8 6" fill="none" />

        {/* Active segments — static color change, no animation on inactive stages */}
        {pathBuildLit && (
          <path d="M 150 150 Q 200 100 220 150 Q 320 200 320 150"
            stroke="#e8512a" strokeWidth="2.5" strokeDasharray="8 6" fill="none"
            className={buildAnimates ? 'anim-path' : ''} />
        )}
        {pathQALit && (
          <path d="M 320 150 Q 380 100 420 150 Q 480 200 490 150"
            stroke="#2ec4a0" strokeWidth="2.5" strokeDasharray="8 6" fill="none"
            className={qaAnimates ? 'anim-path' : ''} />
        )}

        {/* ── Art Desk ──────────────────────────────────────────────────── */}
        <g className={deskAnimates ? 'anim-desk' : ''} style={{ transformOrigin: '140px 140px' }}>
          <rect x="40" y="60" width="200" height="100" rx="12"
            fill={activeRoom === 'desk' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.52)'}
            stroke={activeRoom === 'desk' ? '#e8512a' : '#ddd8cc'}
            strokeWidth={activeRoom === 'desk' ? '2' : '1'} />
          {/* Desk surface */}
          <rect x="65" y="110" width="150" height="40" rx="6" fill="#f5f0e5" stroke="#ddd8cc" strokeWidth="1" />
          {/* Lamp */}
          <line x1="180" y1="80" x2="180" y2="112" stroke="#9a96a6" strokeWidth="2" />
          <ellipse cx="180" cy="78" rx="18" ry="10" fill={deskAnimates ? '#ffd700' : '#e8e4dc'} opacity={deskAnimates ? '0.9' : '0.4'} />
          {/* Color swatches */}
          <rect x="75" y="118" width="14" height="14" rx="3" fill={PRIMARY} />
          <rect x="95" y="118" width="14" height="14" rx="3" fill={ACCENT} />
          <rect x="115" y="118" width="14" height="14" rx="3" fill="#e8512a" />
          {/* Pencil */}
          <rect x="145" y="115" width="4" height="28" rx="2" fill="#e8512a" transform="rotate(-15 147 129)" />
          {/* Brand mark preview */}
          <circle cx="185" cy="126" r="10" fill={PRIMARY} opacity="0.85" />
          <text x="185" y="130" textAnchor="middle" fill={ACCENT} fontSize="10" fontFamily="Space Grotesk" fontWeight="700">O</text>
          <text x="140" y="92" textAnchor="middle" fill={activeRoom === 'desk' ? '#122d45' : '#9a96a6'} fontSize="11" fontFamily="DM Sans" fontWeight={activeRoom === 'desk' ? '600' : '400'}>Art Desk</text>
          {/* Active indicator — only when at desk */}
          {activeRoom === 'desk' && <circle cx="218" cy="74" r="5" fill="#e8512a" className="anim-glow" />}
        </g>

        {/* ── Build Room ────────────────────────────────────────────────── */}
        <g className={buildAnimates ? 'anim-build' : ''} style={{ transformOrigin: '320px 140px' }}>
          <rect x="220" y="60" width="200" height="100" rx="12"
            fill={activeRoom === 'build' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.52)'}
            stroke={activeRoom === 'build' ? '#e8512a' : '#ddd8cc'}
            strokeWidth={activeRoom === 'build' ? '2' : '1'} />
          {/* Monitor */}
          <rect x="270" y="75" width="100" height="62" rx="6" fill="#122d45" />
          <rect x="274" y="79" width="92" height="50" rx="4" fill="#1a3a5c" />
          {/* Screen — animated content only when computing */}
          {buildAnimates ? (
            <>
              <rect x="280" y="85" width="40" height="5" rx="2" fill={ACCENT} className="anim-glow" />
              <rect x="280" y="95" width="60" height="3" rx="1.5" fill="#2ec4a0" opacity="0.7" />
              <rect x="280" y="103" width="50" height="3" rx="1.5" fill="#2ec4a0" opacity="0.5" />
              <g className="anim-spin" style={{ transformOrigin: '345px 105px' }}>
                <circle cx="345" cy="105" r="10" stroke="#e8512a" strokeWidth="2" fill="none" />
                <circle cx="345" cy="105" r="4" fill="#e8512a" />
              </g>
            </>
          ) : activeRoom === 'build' ? (
            // Active but not running — show static code lines
            <>
              <rect x="280" y="90" width="40" height="4" rx="2" fill={ACCENT} opacity="0.7" />
              <rect x="280" y="100" width="60" height="3" rx="1.5" fill="#2ec4a0" opacity="0.5" />
              <rect x="280" y="108" width="50" height="3" rx="1.5" fill="#6b6580" opacity="0.3" />
            </>
          ) : (
            // Inactive
            <>
              <rect x="280" y="95" width="45" height="4" rx="2" fill="#6b6580" opacity="0.25" />
              <rect x="280" y="104" width="38" height="3" rx="1.5" fill="#6b6580" opacity="0.15" />
            </>
          )}
          {/* Monitor stand */}
          <rect x="312" y="137" width="16" height="8" rx="2" fill="#9a96a6" />
          <rect x="302" y="144" width="36" height="4" rx="2" fill="#9a96a6" />
          <text x="320" y="56" textAnchor="middle" fill={activeRoom === 'build' ? '#122d45' : '#9a96a6'} fontSize="11" fontFamily="DM Sans" fontWeight={activeRoom === 'build' ? '600' : '400'}>Build Room</text>
          {activeRoom === 'build' && buildAnimates && <circle cx="415" cy="74" r="5" fill="#e8512a" className="anim-glow" />}
        </g>

        {/* ── Testing Room ──────────────────────────────────────────────── */}
        <g className={qaAnimates ? 'anim-qa' : ''} style={{ transformOrigin: '490px 140px' }}>
          <rect x="400" y="60" width="200" height="100" rx="12"
            fill={activeRoom === 'qa' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.52)'}
            stroke={activeRoom === 'qa' ? '#2ec4a0' : '#ddd8cc'}
            strokeWidth={activeRoom === 'qa' ? '2' : '1'} />
          {/* Phone mockup */}
          <rect x="450" y="72" width="50" height="84" rx="8" fill="#1a3a5c" />
          <rect x="454" y="78" width="42" height="70" rx="4" fill={PRIMARY} />
          {qaAnimates ? (
            <>
              <text x="465" y="105" fontSize="12" fill={ACCENT} className="anim-star">★</text>
              <text x="482" y="95" fontSize="10" fill={ACCENT} opacity="0.7">★</text>
              <text x="475" y="88" textAnchor="middle" fill={ACCENT} fontSize="8" fontFamily="JetBrains Mono">12</text>
            </>
          ) : activeRoom === 'qa' ? (
            <text x="475" y="115" textAnchor="middle" fill={ACCENT} fontSize="18" opacity="0.7">★</text>
          ) : (
            <text x="475" y="115" textAnchor="middle" fill={ACCENT} fontSize="18" opacity="0.2">★</text>
          )}
          {/* Checklist — visible in QA stage */}
          {(activeRoom === 'qa' || pathQALit) && (
            <>
              <rect x="510" y="80" width="70" height="68" rx="6" fill="#f5f0e5" stroke="#ddd8cc" strokeWidth="1" />
              <text x="545" y="92" textAnchor="middle" fill="#122d45" fontSize="9" fontFamily="DM Sans" fontWeight="600">QA</text>
              <circle cx="520" cy="104" r="4" fill={stage === 'preview' || stage === 'accepted' ? '#1a8047' : '#ddd8cc'} />
              <rect x="527" y="101" width="32" height="3" rx="1.5" fill="#9a96a6" />
              <circle cx="520" cy="116" r="4" fill={stage === 'preview' || stage === 'accepted' ? '#1a8047' : '#ddd8cc'} />
              <rect x="527" y="113" width="28" height="3" rx="1.5" fill="#9a96a6" />
              <circle cx="520" cy="128" r="4" fill="#ddd8cc" />
              <rect x="527" y="125" width="35" height="3" rx="1.5" fill="#9a96a6" />
            </>
          )}
          <text x="490" y="56" textAnchor="middle" fill={activeRoom === 'qa' ? '#122d45' : '#9a96a6'} fontSize="11" fontFamily="DM Sans" fontWeight={activeRoom === 'qa' ? '600' : '400'}>Testing Room</text>
          {activeRoom === 'qa' && qaAnimates && <circle cx="595" cy="74" r="5" fill="#2ec4a0" className="anim-glow" />}
        </g>

        {/* ── Room click overlays (navigate without advancing) ──────────── */}
        {onRoomClick && (
          <>
            <rect x="40" y="60" width="200" height="100" rx="12" fill="transparent"
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-label="Go to Art Desk — Brief & Quote"
              onClick={() => onRoomClick('desk')}
              onKeyDown={e => e.key === 'Enter' && onRoomClick('desk')}
            />
            <rect x="220" y="60" width="200" height="100" rx="12" fill="transparent"
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-label="Go to Build Room — Production"
              onClick={() => onRoomClick('build')}
              onKeyDown={e => e.key === 'Enter' && onRoomClick('build')}
            />
            <rect x="400" y="60" width="200" height="100" rx="12" fill="transparent"
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-label="Go to Testing Room — QA"
              onClick={() => onRoomClick('qa')}
              onKeyDown={e => e.key === 'Enter' && onRoomClick('qa')}
            />
          </>
        )}

        {/* ── Stage indicator dots ───────────────────────────────────────── */}
        {[
          { x: 140, label: '1', fill: activeRoom === 'desk' ? '#e8512a' : pathBuildLit ? '#1a8047' : '#ddd8cc', textFill: activeRoom === 'desk' || pathBuildLit ? '#fff' : '#9a96a6' },
          { x: 320, label: '2', fill: activeRoom === 'build' ? '#e8512a' : pathQALit ? '#1a8047' : '#ddd8cc', textFill: activeRoom === 'build' || pathQALit ? '#fff' : '#9a96a6' },
          { x: 490, label: '3', fill: stage === 'accepted' ? '#1a8047' : activeRoom === 'qa' ? '#2ec4a0' : '#ddd8cc', textFill: activeRoom === 'qa' || stage === 'accepted' ? '#fff' : '#9a96a6' },
        ].map(({ x, label, fill, textFill }) => (
          <g key={label}>
            <circle cx={x} cy={182} r="10" fill={fill} />
            <text x={x} y={186} textAnchor="middle" fill={textFill} fontSize="10" fontFamily="DM Sans" fontWeight="600">{label}</text>
          </g>
        ))}
      </svg>

      <div className="text-center mt-1">
        <span className="text-xs font-medium" style={{ color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {activeRoom === 'desk' ? 'Art Desk — Brief & Quote'
            : activeRoom === 'build' ? (isComputing ? 'Build Room — Computing' : 'Build Room — Production')
              : activeRoom === 'qa' ? (isComputing ? 'Testing Room — Running checks' : 'Testing Room — QA Review')
                : stage === 'approved' ? 'Ready to begin production'
                  : stage === 'preview' ? 'Customer preview ready'
                    : stage === 'accepted' ? 'Deliverable accepted'
                      : ''}
        </span>
      </div>
    </div>
  );
}
