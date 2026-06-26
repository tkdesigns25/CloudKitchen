import React, { useState } from 'react';
import type { KDSOrder, KDSRider, KDSItem } from './types';
import { CFG, fmtMSS, ordNum, getPlacedTime } from './config';
import { ChannelBadge } from './KDSApp';

interface CanceledStockEntry {
  id: string; name: string; qty: number; createdAtSimSecs: number;
}

interface Props {
  order: KDSOrder;
  riders: KDSRider[];
  canceledStock: CanceledStockEntry[];
  currentSimSecs: number;
  stationLoads: Record<string, number>;
  orders: Record<string, KDSOrder>;
  onToggleItem: (orderId: string, itemId: string) => void;
  onStartItem: (orderId: string, itemId: string) => void;
  onHoldItem: (orderId: string, itemId: string) => void;
  onPackOrder: () => void;
  onHandover: () => void;
  onCallRider: () => void;
  onCancel: () => void;
  onConsumeCanceled: (matchId: string, orderId: string, itemName: string) => void;
}

export function ActiveOrderCard(props: Props) {
  const { order, riders, canceledStock, currentSimSecs, stationLoads } = props;
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const rider     = riders.find(r => r.orderId === order.id);
  const doneCount = order.items.filter(i => i.state === 'Ready').length;
  const total     = order.items.length;
  const allReady  = doneCount === total;

  const slaLabel = fmtMSS(Math.floor(order.slaSecsRemaining));
  const elapsed  = fmtMSS(order.elapsedPrepSimSecs || 0);

  const isBreach = order.slaSecsRemaining < 0;
  const isWarn   = order.slaSecsRemaining <= CFG.SLA_WARN_SECS;

  // Urgency class (animation only — no style conflict)
  const urgencyClass = isBreach ? 'kds-sla-breach' : isWarn ? 'kds-sla-urgent' : '';

  const isPacked   = order.status === 'packed';
  const readyToPack = !isPacked && allReady;

  // All border/background values computed as longhands — never mix with shorthands
  const cardBgColor        = readyToPack ? 'var(--kds-buttered-gold)' : 'var(--kds-vellum)';
  const cardBorderColor    = readyToPack ? 'var(--kds-gold)' : 'var(--kds-border)';
  const cardBorderLWidth   = (isBreach || isWarn) ? '4px' : '1px';
  const cardBorderLColor   = isBreach ? 'var(--kds-red)' : isWarn ? 'var(--kds-gold)' : cardBorderColor;

  // Timer display on dark oxblood background — must always be high-contrast
  let slaTimerBg = 'transparent';
  let slaTimerColor = 'var(--kds-vellum)'; // default: cream on dark red = readable
  let slaTimerBorder = '1px solid transparent';
  if (isBreach) { slaTimerBg = 'var(--kds-red)'; slaTimerColor = '#fff'; slaTimerBorder = 'none'; }
  else if (isWarn) { slaTimerBg = 'var(--kds-gold)'; slaTimerColor = '#000'; slaTimerBorder = 'none'; }

  // Canceled stock matches for active items
  const canceledMatches = order.status === 'active'
    ? order.items.flatMap(item => {
        if (item.state === 'Ready') return [];
        const match = canceledStock.find(c => c.name === item.name && c.qty >= item.qty);
        if (!match) return [];
        const ageMins = Math.floor((currentSimSecs - match.createdAtSimSecs) / 60);
        return [{ name: item.name, ageMins, matchId: match.id, itemId: item.id }];
      })
    : [];

  // Group items by station
  const itemsByStation: Record<string, KDSItem[]> = {};
  order.items.forEach(item => {
    if (!itemsByStation[item.station]) itemsByStation[item.station] = [];
    itemsByStation[item.station].push(item);
  });

  function handleCancelClick() {
    if (confirmingCancel) {
      props.onCancel();
      setConfirmingCancel(false);
    } else {
      setConfirmingCancel(true);
      setTimeout(() => setConfirmingCancel(false), 3000);
    }
  }

  return (
    <article
      className={`kds-interactive kds-glide-in ${urgencyClass}`}
      style={{
        width: '100%', maxWidth: 420,
        // Background — longhand only, no 'background' shorthand
        backgroundColor: cardBgColor,
        // Border — all four sides as longhands to avoid shorthand/longhand conflict
        borderTopWidth: '1px',    borderTopStyle: 'solid',    borderTopColor: cardBorderColor,
        borderRightWidth: '1px',  borderRightStyle: 'solid',  borderRightColor: cardBorderColor,
        borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: cardBorderColor,
        borderLeftWidth: cardBorderLWidth, borderLeftStyle: 'solid', borderLeftColor: cardBorderLColor,
        borderRadius: 'var(--kds-r)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
      }}
    >
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'stretch', borderBottom: 'var(--kds-b)', flexShrink: 0 }}>
        {/* Left: order num + platform + elapsed */}
        <div style={{ padding: 12, borderRight: 'var(--kds-b)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 110 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.6, marginBottom: 2 }}>Order</div>
            <div className="kds-ordnum" style={{ fontSize: 36, color: 'var(--kds-oxblood)' }}>{ordNum(order.id)}</div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 3 }}><ChannelBadge source={order.source} /></div>
            <div style={{ fontSize: 9, opacity: 0.7 }}>🕐 {elapsed}</div>
          </div>
        </div>

        {/* Right: Time Left timer + cancel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: 'var(--kds-oxblood)', color: 'var(--kds-vellum)', padding: 12, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,249,235,0.7)', marginBottom: 3 }}>Time Left</span>
            <span
              className="kds-countdown"
              style={{ fontSize: 28, padding: '2px 6px', borderRadius: 3, background: slaTimerBg, color: slaTimerColor, border: slaTimerBorder }}
            >
              {slaLabel}
            </span>
          </div>
          {/* Cancel button — moved to header bottom, requires 2-tap to confirm */}
          <div style={{ padding: '4px 8px', background: 'rgba(240,231,215,0.5)', borderTop: 'var(--kds-b)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="kds-interactive"
              onClick={handleCancelClick}
              style={{
                padding: '3px 8px', border: `1px solid ${confirmingCancel ? 'var(--kds-red)' : 'var(--kds-oxblood)'}`,
                borderRadius: 'var(--kds-r)', background: confirmingCancel ? 'var(--kds-red)' : 'transparent',
                color: confirmingCancel ? '#fff' : 'var(--kds-oxblood)',
                fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 9,
                letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              {confirmingCancel ? '⚠ Tap again to cancel' : 'Cancel order'}
            </button>
          </div>
        </div>
      </header>

      {/* Fulfilled from canceled stock prompts */}
      {canceledMatches.map(m => (
        <div
          key={m.matchId}
          className="kds-interactive"
          onClick={() => props.onConsumeCanceled(m.matchId, order.id, m.name)}
          style={{ padding: '6px 12px', background: 'rgba(248,228,125,0.35)', borderBottom: 'var(--kds-b)', fontSize: 10, fontWeight: 700, color: 'var(--kds-oxblood)', cursor: 'pointer' }}
        >
          ↺ Fulfill {m.name} from Canceled Stock? (Made {m.ageMins}m ago)
        </div>
      ))}

      {/* Customer + notes */}
      <div style={{ padding: '6px 12px', borderBottom: 'var(--kds-b)', background: 'rgba(240,231,215,0.3)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{order.customer}</span>
        {order.notes && <span style={{ fontSize: 10, fontStyle: 'italic', opacity: 0.8 }}>"{order.notes}"</span>}
      </div>

      {/* Items — hidden when packed */}
      {!isPacked && (
        <main>
          {Object.entries(itemsByStation).map(([station, items]) => (
            <section key={station} style={{ borderBottom: 'var(--kds-b)' }}>
              <div style={{ background: 'var(--kds-linen)', padding: '3px 12px', borderBottom: '1px solid rgba(55,8,8,0.1)' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--kds-oxblood)' }}>{station} Station</span>
              </div>
              {items.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  orderId={order.id}
                  stationLoad={stationLoads[station] || 0}
                  onToggle={() => props.onToggleItem(order.id, item.id)}
                  onStart={() => props.onStartItem(order.id, item.id)}
                  onHold={() => props.onHoldItem(order.id, item.id)}
                />
              ))}
            </section>
          ))}
        </main>
      )}

      {/* CTA footer */}
      {isPacked ? <PackedFooter order={order} rider={rider} onHandover={props.onHandover} onCallRider={props.onCallRider} />
        : allReady ? (
          <footer style={{ flexShrink: 0, borderTop: 'var(--kds-b)', height: 48 }}>
            <button
              className="kds-interactive"
              onClick={props.onPackOrder}
              style={{ width: '100%', height: '100%', background: 'var(--kds-oxblood)', color: 'var(--kds-vellum)', border: 'none', fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              📦 Confirm Packed
            </button>
          </footer>
        ) : (
          <footer style={{ flexShrink: 0, borderTop: 'var(--kds-b)', height: 48, display: 'flex' }}>
            <div style={{ flex: 3, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
              <div style={{ width: '100%', background: 'var(--kds-vellum)', height: 8, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(55,8,8,0.15)' }}>
                <div style={{ background: 'var(--kds-oxblood)', height: '100%', width: `${(doneCount / total) * 100}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
            <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--kds-oxblood)' }}>{doneCount} / {total} READY</span>
            </div>
          </footer>
        )
      }
    </article>
  );
}

function ItemRow({ item, orderId, stationLoad, onToggle, onStart, onHold }: {
  item: KDSItem; orderId: string; stationLoad: number;
  onToggle: () => void; onStart: () => void; onHold: () => void;
}) {
  const isOver = stationLoad >= 90;

  let rowBg = 'transparent';
  let rowBorder = '1px solid transparent';
  if (item.state === 'Queued') { rowBg = 'rgba(248,228,125,0.38)'; rowBorder = `1px solid var(--kds-gold)`; }
  if (item.state === 'Hold')   { rowBorder = '1px dashed rgba(55,8,8,0.3)'; }

  const isDone = item.state === 'Ready';
  const cbBg   = isDone ? 'var(--kds-oxblood)' : 'var(--kds-vellum)';

  return (
    <div
      className="kds-interactive"
      onClick={onToggle}
      style={{
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', borderBottom: '1px solid rgba(55,8,8,0.06)',
        opacity: item.state === 'Hold' ? 0.7 : 1,
        background: rowBg, border: rowBorder, borderRadius: 0,
      }}
    >
      {/* Checkbox */}
      <div style={{ flexShrink: 0, width: 16, height: 16, border: 'var(--kds-b)', borderRadius: 3, background: cbBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isDone && <span style={{ color: 'var(--kds-vellum)', fontSize: 10, lineHeight: 1, marginTop: -1 }}>✓</span>}
      </div>

      {/* Item text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--kds-oxblood)' }}>{item.qty}×</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--kds-ink)', wordBreak: 'break-word', textDecoration: isDone ? 'line-through' : 'none', opacity: isDone ? 0.5 : 1 }}>
          {item.name}
        </div>
        {item.modifier && (
          <div style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--kds-graphite)', paddingLeft: 8, marginTop: 1 }}>
            <span style={{ color: 'var(--kds-oxblood)' }}>♦ </span>{item.modifier}
          </div>
        )}
      </div>

      {/* State controls */}
      {item.state === 'Queued' && (
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <SmBtn onClick={onStart}>Prep</SmBtn>
          <SmBtn onClick={onHold} highlight={isOver}>Hold</SmBtn>
        </div>
      )}
      {item.state === 'Hold' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
          <span style={{ fontSize: 8, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase' }}>[On Hold]</span>
          <SmBtn onClick={onStart}>Prep</SmBtn>
        </div>
      )}
      {item.state === 'Cooking' && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 8, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Cooking</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--kds-ink)' }}>{fmtMSS(item.cookingElapsedSimSecs || 0)}</div>
        </div>
      )}
      {item.state === 'Ready' && (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--kds-green)', flexShrink: 0 }}>✓ Done</span>
      )}
    </div>
  );
}

function SmBtn({ children, onClick, highlight }: { children: React.ReactNode; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      className={`kds-interactive ${highlight ? 'kds-suggest-hold' : ''}`}
      onClick={onClick}
      style={{
        padding: '3px 7px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)',
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
        cursor: 'pointer', background: 'transparent', color: 'var(--kds-oxblood)',
        fontFamily: 'var(--kds-font-ui)',
      }}
    >
      {children}
    </button>
  );
}

function PackedFooter({ order, rider, onHandover, onCallRider }: {
  order: KDSOrder; rider: KDSRider | undefined; onHandover: () => void; onCallRider: () => void;
}) {
  const canGive  = rider?.status === 'arrived';
  const riderMsg = rider
    ? rider.status === 'arrived' ? `${rider.name} is HERE` : `${rider.name} on the way — ${fmtMSS(rider.eta)} left`
    : 'Waiting for rider';

  const showCallRider = rider && rider.status !== 'arrived';

  return (
    <footer style={{ flexShrink: 0, borderTop: 'var(--kds-b)', background: 'var(--kds-linen)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', color: 'var(--kds-oxblood)' }}>
        [Waiting for Handover]
      </div>
      <div style={{ fontSize: 11, textAlign: 'center', color: 'var(--kds-graphite)' }}>{riderMsg}</div>
      {showCallRider && (
        <button
          className="kds-interactive"
          onClick={onCallRider}
          style={{ width: '100%', padding: '6px', background: 'var(--kds-gold)', border: '1px solid var(--kds-ink)', borderRadius: 'var(--kds-r)', fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          Call Rider
        </button>
      )}
      <button
        className="kds-interactive"
        onClick={onHandover}
        disabled={!canGive}
        style={{ width: '100%', padding: '8px', background: canGive ? 'var(--kds-oxblood)' : 'var(--kds-linen)', color: canGive ? 'var(--kds-vellum)' : 'var(--kds-graphite)', border: 'none', borderRadius: 'var(--kds-r)', fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: canGive ? 'pointer' : 'not-allowed', opacity: canGive ? 1 : 0.5 }}
      >
        {canGive ? '🤝 Give to Rider' : '⏳ Waiting for rider…'}
      </button>
    </footer>
  );
}
