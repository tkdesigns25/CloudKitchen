import React, { useRef } from 'react';
import type { KDSOrder, KDSRider, KDSItem } from './types';
import { STATIONS, fmtMSS, ordNum } from './config';
import { EmptyState } from './KDSApp';

interface Props {
  orders: Record<string, KDSOrder>;
  riders: KDSRider[];
  stationLoads: Record<string, number>;
  onStartItem: (orderId: string, itemId: string) => void;
  onHoldItem: (orderId: string, itemId: string) => void;
  onPrepBulk: (name: string, station: string) => void;
  onMoveUp: (orderId: string, itemId: string) => void;
  onMoveDown: (orderId: string, itemId: string) => void;
  onReorder: (draggedItemId: string, targetItemId: string, station: string) => void;
  onRiderHandover: (riderId: string) => void;
  getBulkCandidates: (station: string) => Array<{name: string; totalQty: number; items: any[]}>;
}

export function Column3(props: Props) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--kds-vellum)' }}>
      {/* Station Queues */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, height: 'var(--kds-ch)', display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: 'var(--kds-b)', background: 'var(--kds-vellum)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>Station Queues</span>
        </div>
        <div className="kds-scroll" style={{ flex: 1, padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ flexShrink: 0, height: 12 }} aria-hidden />
          {STATIONS.map(stn => (
            <StationQueue
              key={stn}
              station={stn}
              orders={props.orders}
              stationLoad={props.stationLoads[stn] || 0}
              bulkCandidates={props.getBulkCandidates(stn)}
              onStartItem={props.onStartItem}
              onHoldItem={props.onHoldItem}
              onPrepBulk={props.onPrepBulk}
              onMoveUp={props.onMoveUp}
              onMoveDown={props.onMoveDown}
              onReorder={props.onReorder}
            />
          ))}
        </div>
      </div>

      {/* Riders */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', borderTop: 'var(--kds-b)' }}>
        <div style={{ flexShrink: 0, height: 'var(--kds-ch)', display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: 'var(--kds-b)', background: 'var(--kds-vellum)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>Riders Waiting</span>
        </div>
        <div className="kds-scroll" style={{ flex: 1, padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ flexShrink: 0, height: 12 }} aria-hidden />
          {props.riders.length === 0 ? (
            <EmptyState icon="🛵" text="No riders yet" />
          ) : props.riders.map(rider => (
            <RiderCard
              key={rider.id}
              rider={rider}
              order={rider.orderId ? props.orders[rider.orderId] : null}
              onHandover={() => props.onRiderHandover(rider.id)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Station Queue ──────────────────────────────────────────────
function StationQueue({ station, orders, stationLoad, bulkCandidates, onStartItem, onHoldItem, onPrepBulk, onMoveUp, onMoveDown, onReorder }: {
  station: string;
  orders: Record<string, KDSOrder>;
  stationLoad: number;
  bulkCandidates: Array<{name: string; totalQty: number}>;
  onStartItem: (orderId: string, itemId: string) => void;
  onHoldItem: (orderId: string, itemId: string) => void;
  onPrepBulk: (name: string, station: string) => void;
  onMoveUp: (orderId: string, itemId: string) => void;
  onMoveDown: (orderId: string, itemId: string) => void;
  onReorder: (draggedItemId: string, targetItemId: string, station: string) => void;
}) {
  const isOver = stationLoad >= 90;
  const dragRef = useRef<{itemId: string; station: string} | null>(null);

  // Show all non-ready items so the manager can track what's queued, cooking, and on hold
  const queuedItems: Array<{order: KDSOrder; item: KDSItem}> = [];
  Object.values(orders).forEach(o => {
    if (o.status !== 'active') return;
    o.items.forEach(item => {
      if ((item.state === 'Queued' || item.state === 'Cooking' || item.state === 'Hold') && item.station === station) {
        queuedItems.push({ order: o, item });
      }
    });
  });
  // Sort: Queued first (by priority), then Cooking, then Hold
  const stateOrder: Record<string, number> = { Queued: 0, Cooking: 1, Hold: 2 };
  queuedItems.sort((a, b) => {
    const sA = stateOrder[a.item.state] ?? 99;
    const sB = stateOrder[b.item.state] ?? 99;
    if (sA !== sB) return sA - sB;
    return a.item.queuePriority - b.item.queuePriority;
  });

  return (
    <div style={{ background: 'var(--kds-linen)', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--kds-graphite)', borderBottom: 'var(--kds-b)', paddingBottom: 4, marginBottom: 2 }}>
        {station} Station
      </div>

      {/* Bulk cook suggestions */}
      {bulkCandidates.map(bulk => (
        <div key={bulk.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(55,8,8,0.04)', padding: '4px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--kds-oxblood)' }}>⌿ Cook Together: {bulk.totalQty}× {bulk.name}</span>
          <button
            className="kds-interactive kds-suggest-hold"
            onClick={() => onPrepBulk(bulk.name, station)}
            style={{ padding: '3px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--kds-font-ui)', background: 'rgba(248,228,125,0.25)' }}
          >
            Cook Bulk
          </button>
        </div>
      ))}

      {/* Queue items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 40, maxHeight: 280, overflowY: 'auto' }}>
        {queuedItems.length === 0 ? (
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--kds-graphite)', textAlign: 'center', padding: '8px 0', opacity: 0.5 }}>Queue is empty</div>
        ) : queuedItems.map(({ order, item }, idx) => {
          const isCooking = item.state === 'Cooking';
          const isHold    = item.state === 'Hold';
          const isQueued  = item.state === 'Queued';

          // Left border accent colour — only for Cooking and Hold states
          // (Queued items use the plain uniform border on all four sides)
          const accentBorderLeft: string | undefined = isCooking
            ? '3px solid #d97706'   // amber for cooking
            : isHold
            ? '3px solid #3b82f6'   // blue for hold
            : undefined;

          // Background tint per state
          const bgTint = isCooking
            ? 'rgba(217,119,6,0.06)'
            : isHold
            ? 'rgba(59,130,246,0.07)'
            : 'var(--kds-vellum)';

          // Status pill styling
          const pillStyle: React.CSSProperties = isCooking
            ? { background: '#d97706', color: '#fff' }
            : isHold
            ? { background: '#3b82f6', color: '#fff' }
            : { background: 'var(--kds-linen)', color: 'var(--kds-graphite)', border: 'var(--kds-b)' };

          const pillLabel = isCooking ? '🔥 Cooking' : isHold ? '⏸ Hold' : '⏳ Queued';

          return (
            <div
              key={item.id}
              className={`kds-queue-card${isQueued ? ' kds-interactive' : ''}`}
              draggable={isQueued}
              data-item-id={item.id}
              data-station={station}
              onDragStart={isQueued ? e => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, station }));
                dragRef.current = { itemId: item.id, station };
                (e.currentTarget as HTMLElement).classList.add('dragging');
              } : undefined}
              onDragEnd={isQueued ? e => {
                (e.currentTarget as HTMLElement).classList.remove('dragging');
                document.querySelectorAll('.kds-queue-card').forEach(el => el.classList.remove('drag-over'));
              } : undefined}
              onDragOver={isQueued ? e => {
                e.preventDefault();
                const fromData = dragRef.current;
                if (fromData?.station === station) (e.currentTarget as HTMLElement).classList.add('drag-over');
              } : undefined}
              onDragLeave={isQueued ? e => { (e.currentTarget as HTMLElement).classList.remove('drag-over'); } : undefined}
              onDrop={isQueued ? e => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.remove('drag-over');
                try {
                  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                  if (data.station === station) onReorder(data.itemId, item.id, station);
                } catch (_) {}
              } : undefined}
              style={{
                padding: '6px 8px',
                border: 'var(--kds-b)',
                ...(accentBorderLeft ? { borderLeft: accentBorderLeft } : {}),
                borderRadius: 'var(--kds-r)',
                background: bgTint,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5,
                cursor: isQueued ? 'grab' : 'default',
                userSelect: 'none',
                opacity: isHold ? 0.85 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--kds-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.qty}× {item.name}
                  </span>
                  {/* Status pill — always visible */}
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                    padding: '2px 5px', borderRadius: 3,
                    ...pillStyle,
                  }}>
                    {pillLabel}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--kds-graphite)', marginTop: 1 }}>
                  [{ordNum(order.id)}] Due in: {fmtMSS(order.slaSecsRemaining)}
                </div>
              </div>
              {/* Action buttons — only for Queued items */}
              {isQueued && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {idx > 0 && (
                    <button
                      className="kds-interactive"
                      onClick={e => { e.stopPropagation(); onMoveUp(order.id, item.id); }}
                      title="Move Up"
                      style={{ padding: '2px 4px', border: 'var(--kds-b)', borderRadius: 3, background: 'var(--kds-linen)', fontSize: 9, fontWeight: 700, cursor: 'pointer', color: 'var(--kds-ink)' }}
                    >▲</button>
                  )}
                  {idx < queuedItems.length - 1 && (
                    <button
                      className="kds-interactive"
                      onClick={e => { e.stopPropagation(); onMoveDown(order.id, item.id); }}
                      title="Move Down"
                      style={{ padding: '2px 4px', border: 'var(--kds-b)', borderRadius: 3, background: 'var(--kds-linen)', fontSize: 9, fontWeight: 700, cursor: 'pointer', color: 'var(--kds-ink)' }}
                    >▼</button>
                  )}
                  <button
                    className="kds-interactive"
                    onClick={e => { e.stopPropagation(); onStartItem(order.id, item.id); }}
                    style={{ padding: '3px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', fontSize: 9, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--kds-oxblood)', fontFamily: 'var(--kds-font-ui)', textTransform: 'uppercase' }}
                  >Prep</button>
                  <button
                    className={`kds-interactive ${isOver ? 'kds-suggest-hold' : ''}`}
                    onClick={e => { e.stopPropagation(); onHoldItem(order.id, item.id); }}
                    style={{ padding: '3px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', fontSize: 9, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--kds-oxblood)', fontFamily: 'var(--kds-font-ui)', textTransform: 'uppercase' }}
                  >Hold</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Rider Card ─────────────────────────────────────────────────
function RiderCard({ rider, order, onHandover }: {
  rider: KDSRider; order: KDSOrder | null; onHandover: () => void;
}) {
  const matched    = order?.status === 'packed';
  const canHandover = matched && rider.status === 'arrived';

  const cardBorder = rider.status === 'arrived'
    ? '1px solid var(--kds-green)' : 'var(--kds-b)';
  const borderLeft = rider.status === 'arrived' ? '4px solid var(--kds-green)' : undefined;

  return (
    <div
      className="kds-interactive"
      style={{
        padding: '10px 11px', border: cardBorder, borderLeft, borderRadius: 'var(--kds-r)',
        background: matched ? 'rgba(248,228,125,0.18)' : 'var(--kds-linen)',
        display: 'flex', flexDirection: 'column', gap: 5,
        opacity: rider.status === 'transit' ? 0.85 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--kds-ink)' }}>{rider.name}</span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--kds-oxblood)' }}>{rider.platform}</span>
      </div>

      {rider.status === 'arrived' ? (
        <div style={{ background: 'var(--kds-green)', color: '#fff', padding: '4px 8px', borderRadius: 3, fontWeight: 700, fontSize: 11, display: 'inline-block' }}>
          🟢 HERE NOW — waiting {fmtMSS(rider.waitSecs)}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--kds-graphite)' }}>
          🚴 On the way — {fmtMSS(rider.eta)} away
        </div>
      )}

      {rider.orderId ? (
        <div>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-vellum)', fontSize: 10, fontWeight: 700, color: 'var(--kds-ink)' }}>
            Collecting {ordNum(rider.orderId)}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--kds-graphite)' }}>Waiting for order</div>
      )}

      {matched && (
        <button
          className="kds-interactive"
          onClick={onHandover}
          disabled={!canHandover}
          style={{
            width: '100%', marginTop: 2, padding: '8px',
            background: canHandover ? 'var(--kds-oxblood)' : 'transparent',
            border: canHandover ? 'none' : 'var(--kds-b)',
            borderRadius: 'var(--kds-r)',
            color: canHandover ? 'var(--kds-vellum)' : 'var(--kds-graphite)',
            fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 11,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: canHandover ? 'pointer' : 'not-allowed',
            opacity: canHandover ? 1 : 0.5,
          }}
        >
          {canHandover ? '✓ Confirm Handover' : '⏳ Rider not here yet'}
        </button>
      )}
    </div>
  );
}
