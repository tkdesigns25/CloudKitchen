import React from 'react';
import { GhostBtn } from './KDSApp';

interface HeaderProps {
  isOpen: boolean; autoAccept: boolean; soundEnabled: boolean;
  cookingCount: number; waitingCount: number; doneCount: number;
  stationLoads: Record<string, number>; clock: string;
  onOpen: () => void; onClose: () => void;
  onAutoAcceptOn: () => void; onAutoAcceptOff: () => void;
  onToggleSound: () => void;
  onOpenNewOrder: () => void; onOpenPause: () => void; onOpenMenu: () => void;
}

const STATIONS = ['Hot', 'Grill', 'Healthy Bowls'] as const;

export function KDSHeader(props: HeaderProps) {
  const { isOpen, autoAccept, soundEnabled, cookingCount, waitingCount, doneCount, stationLoads, clock } = props;

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
      height: 'var(--kds-hh)',
      background: 'var(--kds-vellum)', borderBottom: 'var(--kds-b)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px', gap: 10,
    }}>
      {/* Brand */}
      <div style={{ fontFamily: 'var(--kds-font-ui)', fontWeight: 900, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--kds-oxblood)', paddingRight: 12, borderRight: 'var(--kds-b)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        KDS
      </div>

      {/* Open / Close */}
      <div style={{ display: 'flex', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', overflow: 'hidden', flexShrink: 0 }}>
        <OcBtn active={isOpen ? 'open' : null} onClick={props.onOpen}>✓ Open</OcBtn>
        <OcBtn active={!isOpen ? 'close' : null} onClick={props.onClose}>⛔ Close</OcBtn>
      </div>

      {/* Auto-Accept */}
      <div style={{ display: 'flex', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', overflow: 'hidden', flexShrink: 0, marginLeft: 4 }}>
        <OcBtn active={autoAccept ? 'open' : null} onClick={props.onAutoAcceptOn}>Auto-Accept: ON</OcBtn>
        <OcBtn active={!autoAccept ? 'close' : null} onClick={props.onAutoAcceptOff}>Auto-Accept: OFF</OcBtn>
      </div>

      {/* Live stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
        <StatPill label="Cooking" value={cookingCount} />
        <StatPill label="Waiting" value={waitingCount} />
        <StatPill label="Done Today" value={doneCount} />
      </div>

      {/* Station load — segments bar + count number below */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px', borderLeft: 'var(--kds-b)', borderRight: 'var(--kds-b)', flexShrink: 0 }}>
        {STATIONS.map(stn => {
          const load  = stationLoads[stn] || 0;
          const count = Math.round(load / 10); // 0–10 items
          const isFull = count >= 10;
          const isWarn = count >= 7;
          const numColor = isFull ? 'var(--kds-red)' : isWarn ? '#b07800' : 'var(--kds-oxblood)';
          return (
            <div key={stn} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>
                {stn === 'Healthy Bowls' ? 'Bowls' : stn}
              </span>
              {/* Segment bar */}
              <div className={isFull ? 'kds-sl-track overloaded' : 'kds-sl-track'} style={{ display: 'flex', gap: 2, width: 68, height: 8 }}>
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className={`kds-sl-segment ${i < count ? 'filled' : ''}`} />
                ))}
              </div>
              {/* Count below bar */}
              <span style={{ fontSize: 9, fontWeight: 900, lineHeight: 1, color: numColor, fontVariantNumeric: 'tabular-nums' }}>
                {count}/10
              </span>
            </div>
          );
        })}
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--kds-graphite)', letterSpacing: '0.04em' }}>{clock}</span>
        <IconBtn title={soundEnabled ? 'Turn sounds off' : 'Turn sounds on'} active={soundEnabled} onClick={props.onToggleSound}>
          {soundEnabled ? '🔔' : '🔕'}
        </IconBtn>
        <GhostBtn onClick={props.onOpenNewOrder}>+ New Order</GhostBtn>
        <GhostBtn onClick={props.onOpenPause}>⏸ Stop Apps</GhostBtn>
        <GhostBtn onClick={props.onOpenMenu}>Out of Stock</GhostBtn>
      </div>
    </header>
  );
}

function OcBtn({ children, active, onClick }: { children: React.ReactNode; active: 'open' | 'close' | null; onClick: () => void }) {
  const bg = active === 'open' ? 'var(--kds-oxblood)' : active === 'close' ? 'var(--kds-gold)' : 'var(--kds-vellum)';
  const color = active === 'open' ? 'var(--kds-vellum)' : active === 'close' ? 'var(--kds-ink)' : 'var(--kds-graphite)';
  return (
    <button
      className="kds-interactive"
      onClick={onClick}
      style={{ padding: '6px 12px', border: 'none', background: bg, color, fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, padding: '3px 8px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-linen)', whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--kds-ink)', lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function IconBtn({ children, title, active, onClick }: { children: React.ReactNode; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className="kds-interactive"
      title={title}
      onClick={onClick}
      style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--kds-linen)' : 'var(--kds-vellum)', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', cursor: 'pointer', fontSize: 15, flexShrink: 0 }}
    >
      {children}
    </button>
  );
}
