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

function WillowLogo({ size = 26, color = 'var(--kds-oxblood)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M 12 86 C 38 74 62 74 88 86 C 62 80 38 80 12 86 Z" fill={color} stroke="none" />
      <path d="M 50 82 L 50 42" strokeWidth="7" />
      {/* Left drooping arches */}
      <path d="M 50 46 C 30 40 10 22 10 44 L 10 70 M 17 44 L 17 70 M 24 40 L 24 70 M 31 36 L 31 70" />
      <path d="M 50 42 C 36 24 22 12 22 32 L 22 46 M 29 32 L 29 46 M 36 28 L 36 46" />
      {/* Center top crown */}
      <path d="M 50 44 C 40 28 40 8 50 8 C 60 8 60 28 50 44 Z" fill={color} stroke="none" />
      {/* Right drooping arches */}
      <path d="M 50 42 C 64 24 78 12 78 32 L 78 46 M 71 32 L 71 46 M 64 28 L 64 46" />
      <path d="M 50 46 C 70 40 90 22 90 44 L 90 70 M 83 44 L 83 70 M 76 40 L 76 70 M 69 36 L 69 70" />
    </svg>
  );
}

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: 'var(--kds-b)', flexShrink: 0 }}>
        <WillowLogo size={24} color="var(--kds-oxblood)" />
        <span style={{ fontFamily: 'var(--kds-font-ui)', fontWeight: 900, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--kds-oxblood)', whiteSpace: 'nowrap' }}>
          Willow Kitchen
        </span>
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
