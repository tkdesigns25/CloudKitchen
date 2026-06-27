import React, { useRef } from 'react';
import type { KDSOrder, KDSItem } from './types';
import { STATIONS, fmtMSS, ordNum } from './config';

interface Props {
  orders: Record<string, KDSOrder>;
  stationLoads: Record<string, number>;
  onStartItem: (orderId: string, itemId: string) => void;
  onHoldItem: (orderId: string, itemId: string) => void;
  onGroupPrep: (name: string, station: string) => void;
  onMoveUp: (orderId: string, itemId: string) => void;
  onMoveDown: (orderId: string, itemId: string) => void;
  onReorder: (draggedItemId: string, targetItemId: string, station: string) => void;
  getGroupPrepCandidates: (station: string) => Array<{name: string; totalQty: number; items: any[]}>;
}

type QueueEntry = 
  | { type: 'single'; order: KDSOrder; item: KDSItem }
  | { type: 'group-prep'; name: string; totalQty: number; station: string; items: Array<{order: KDSOrder; item: KDSItem}>; primaryItem: KDSItem }
  | { type: 'group-cooking'; name: string; totalQty: number; station: string; items: Array<{order: KDSOrder; item: KDSItem}>; primaryItem: KDSItem };

export function Column3(props: Props) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--kds-vellum)', borderRight: 'var(--kds-b)' }}>
      {/* Station Queues — full height */}
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
              onStartItem={props.onStartItem}
              onHoldItem={props.onHoldItem}
              onGroupPrep={props.onGroupPrep}
              onMoveUp={props.onMoveUp}
              onMoveDown={props.onMoveDown}
              onReorder={props.onReorder}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Station Queue ──────────────────────────────────────────────
function StationQueue({ station, orders, stationLoad, onStartItem, onHoldItem, onGroupPrep, onMoveUp, onMoveDown, onReorder }: {
  station: string;
  orders: Record<string, KDSOrder>;
  stationLoad: number;
  onStartItem: (orderId: string, itemId: string) => void;
  onHoldItem: (orderId: string, itemId: string) => void;
  onGroupPrep: (name: string, station: string) => void;
  onMoveUp: (orderId: string, itemId: string) => void;
  onMoveDown: (orderId: string, itemId: string) => void;
  onReorder: (draggedItemId: string, targetItemId: string, station: string) => void;
}) {
  const isOver = stationLoad >= 90;
  const dragRef = useRef<{itemId: string; station: string} | null>(null);

  // Collect raw non-ready items
  const rawItems: Array<{order: KDSOrder; item: KDSItem}> = [];
  Object.values(orders).forEach(o => {
    if (o.status !== 'active') return;
    o.items.forEach(item => {
      if ((item.state === 'Queued' || item.state === 'Cooking' || item.state === 'Hold') && item.station === station) {
        rawItems.push({ order: o, item });
      }
    });
  });

  // Sort raw items: Cooking ALWAYS on top (0), then Queued (1), then Hold (2)
  const stateOrder: Record<string, number> = { Cooking: 0, Queued: 1, Hold: 2 };
  rawItems.sort((a, b) => {
    const sA = stateOrder[a.item.state] ?? 99;
    const sB = stateOrder[b.item.state] ?? 99;
    if (sA !== sB) return sA - sB;
    return a.item.queuePriority - b.item.queuePriority;
  });

  // Separate cooking items and non-cooking items
  const rawCooking = rawItems.filter(x => x.item.state === 'Cooking');
  const rawNonCooking = rawItems.filter(x => x.item.state !== 'Cooking');

  // Build queue entries
  const queueEntries: QueueEntry[] = [];
  const processedItemIds = new Set<string>();

  // 1. Process Cooking items: group items of same name cooking together into group-cooking
  rawCooking.forEach(entry => {
    if (processedItemIds.has(entry.item.id)) return;
    const matches = rawCooking.filter(x => !processedItemIds.has(x.item.id) && x.item.name === entry.item.name);
    if (matches.length >= 2) {
      const totalQty = matches.reduce((sum, x) => sum + x.item.qty, 0);
      matches.forEach(x => processedItemIds.add(x.item.id));
      queueEntries.push({
        type: 'group-cooking',
        name: entry.item.name,
        totalQty,
        station,
        items: matches,
        primaryItem: entry.item,
      });
    } else {
      queueEntries.push({ type: 'single', order: entry.order, item: entry.item });
      processedItemIds.add(entry.item.id);
    }
  });

  // 2. Process Non-Cooking items: group items of same name into group-prep
  rawNonCooking.forEach(entry => {
    if (processedItemIds.has(entry.item.id)) return;
    const matches = rawNonCooking.filter(x => !processedItemIds.has(x.item.id) && x.item.name === entry.item.name);
    if (matches.length >= 2) {
      const totalQty = matches.reduce((sum, x) => sum + x.item.qty, 0);
      matches.forEach(x => processedItemIds.add(x.item.id));
      queueEntries.push({
        type: 'group-prep',
        name: entry.item.name,
        totalQty,
        station,
        items: matches,
        primaryItem: entry.item,
      });
    } else {
      queueEntries.push({ type: 'single', order: entry.order, item: entry.item });
      processedItemIds.add(entry.item.id);
    }
  });

  const isEmpty = queueEntries.length === 0;

  return (
    <div style={{ background: 'var(--kds-linen)', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--kds-graphite)', borderBottom: 'var(--kds-b)', paddingBottom: 4, marginBottom: 2 }}>
        {station} Station
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40, maxHeight: 340, overflowY: 'auto' }}>
        {isEmpty ? (
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--kds-graphite)', textAlign: 'center', padding: '12px 0', opacity: 0.5 }}>Queue is empty</div>
        ) : queueEntries.map((entry, idx) => {

          // ── GROUP COOKING BOX (Items Cooking Together) ────────
          if (entry.type === 'group-cooking') {
            const { name, totalQty, items } = entry;
            const orderTags = items.map(x => ordNum(x.order.id)).join(', ');
            const avgElapsed = Math.floor(items.reduce((s, x) => s + (x.item.cookingElapsedSimSecs || 0), 0) / items.length);

            return (
              <div
                key={`group-cooking-${name}`}
                style={{
                  padding: '8px 10px',
                  border: '2px solid #d97706',
                  borderRadius: 'var(--kds-r)',
                  background: 'rgba(217,119,6,0.08)',
                  display: 'flex', flexDirection: 'column', gap: 6,
                  boxShadow: '0 2px 6px rgba(217,119,6,0.12)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(217,119,6,0.3)', paddingBottom: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                    🔥 COOKING TOGETHER BOX ({totalQty}×)
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 800, color: '#b45309' }}>
                    {fmtMSS(avgElapsed)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--kds-ink)' }}>
                      {totalQty}× {name}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--kds-graphite)', marginTop: 2, fontWeight: 600 }}>
                      Orders: <span style={{ color: 'var(--kds-oxblood)' }}>{orderTags}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {items.map(x => (
                      <button
                        key={x.item.id}
                        className="kds-interactive"
                        onClick={e => { e.stopPropagation(); onHoldItem(x.order.id, x.item.id); }}
                        style={{ padding: '3px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', fontSize: 8, fontWeight: 700, cursor: 'pointer', background: '#fff', color: 'var(--kds-oxblood)', fontFamily: 'var(--kds-font-ui)', textTransform: 'uppercase' }}
                        title={`Hold #${ordNum(x.order.id)}`}
                      >Hold #{ordNum(x.order.id)}</button>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          // ── GROUP PREP UNIT (Candidates for Prep Together) ─────
          if (entry.type === 'group-prep') {
            const { name, totalQty, items, primaryItem } = entry;
            const orderTags = items.map(x => ordNum(x.order.id)).join(', ');
            return (
              <div
                key={`group-prep-${name}`}
                className="kds-queue-card kds-interactive"
                draggable={true}
                data-item-id={primaryItem.id}
                data-station={station}
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: primaryItem.id, station }));
                  dragRef.current = { itemId: primaryItem.id, station };
                  (e.currentTarget as HTMLElement).classList.add('dragging');
                }}
                onDragEnd={e => {
                  (e.currentTarget as HTMLElement).classList.remove('dragging');
                  document.querySelectorAll('.kds-queue-card').forEach(el => el.classList.remove('drag-over'));
                }}
                onDragOver={e => {
                  e.preventDefault();
                  if (dragRef.current?.station === station) (e.currentTarget as HTMLElement).classList.add('drag-over');
                }}
                onDragLeave={e => { (e.currentTarget as HTMLElement).classList.remove('drag-over'); }}
                onDrop={e => {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).classList.remove('drag-over');
                  try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.station === station) onReorder(data.itemId, primaryItem.id, station);
                  } catch (_) {}
                }}
                style={{
                  padding: '8px 10px',
                  border: '2px dashed #6d28d9',
                  borderLeft: '4px solid #6d28d9',
                  borderRadius: 'var(--kds-r)',
                  background: 'linear-gradient(135deg, rgba(109,40,217,0.08) 0%, rgba(248,228,125,0.2) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  cursor: 'grab',
                  userSelect: 'none',
                  boxShadow: '0 1px 4px rgba(109,40,217,0.15)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 3, background: '#6d28d9', color: '#fff' }}>
                      ⚡ GROUP PREP UNIT
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--kds-ink)' }}>
                      {totalQty}× {name}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--kds-graphite)', marginTop: 3, fontWeight: 600 }}>
                    Orders: <span style={{ color: 'var(--kds-oxblood)' }}>{orderTags}</span>
                  </div>
                </div>
                {/* Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {idx > 0 && (
                    <button
                      className="kds-interactive"
                      onClick={e => { e.stopPropagation(); onMoveUp(items[0].order.id, primaryItem.id); }}
                      title="Move Up Unit"
                      style={{ padding: '3px 5px', border: 'var(--kds-b)', borderRadius: 3, background: 'var(--kds-vellum)', fontSize: 9, fontWeight: 700, cursor: 'pointer', color: 'var(--kds-ink)' }}
                    >▲</button>
                  )}
                  {idx < queueEntries.length - 1 && (
                    <button
                      className="kds-interactive"
                      onClick={e => { e.stopPropagation(); onMoveDown(items[0].order.id, primaryItem.id); }}
                      title="Move Down Unit"
                      style={{ padding: '3px 5px', border: 'var(--kds-b)', borderRadius: 3, background: 'var(--kds-vellum)', fontSize: 9, fontWeight: 700, cursor: 'pointer', color: 'var(--kds-ink)' }}
                    >▼</button>
                  )}
                  <button
                    className="kds-interactive"
                    onClick={e => { e.stopPropagation(); onGroupPrep(name, station); }}
                    style={{ padding: '4px 8px', border: 'none', borderRadius: 'var(--kds-r)', fontSize: 9, fontWeight: 800, cursor: 'pointer', background: '#6d28d9', color: '#fff', fontFamily: 'var(--kds-font-ui)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                  >
                    Prep Together
                  </button>
                </div>
              </div>
            );
          }

          // ── SINGLE ITEM CARD (Cooking / Queued / Hold) ────────
          const { order, item } = entry;
          const isCooking = item.state === 'Cooking';
          const isHold    = item.state === 'Hold';

          const accentBorderLeft: string | undefined = isCooking
            ? '4px solid #d97706'
            : isHold
            ? '3px solid #3b82f6'
            : undefined;

          const bgTint = isCooking
            ? 'rgba(217,119,6,0.1)'
            : isHold
            ? 'rgba(59,130,246,0.07)'
            : 'var(--kds-vellum)';

          return (
            <div
              key={item.id}
              className="kds-queue-card kds-interactive"
              draggable={true}
              data-item-id={item.id}
              data-station={station}
              onDragStart={e => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, station }));
                dragRef.current = { itemId: item.id, station };
                (e.currentTarget as HTMLElement).classList.add('dragging');
              }}
              onDragEnd={e => {
                (e.currentTarget as HTMLElement).classList.remove('dragging');
                document.querySelectorAll('.kds-queue-card').forEach(el => el.classList.remove('drag-over'));
              }}
              onDragOver={e => {
                e.preventDefault();
                if (dragRef.current?.station === station) (e.currentTarget as HTMLElement).classList.add('drag-over');
              }}
              onDragLeave={e => { (e.currentTarget as HTMLElement).classList.remove('drag-over'); }}
              onDrop={e => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.remove('drag-over');
                try {
                  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                  if (data.station === station) onReorder(data.itemId, item.id, station);
                } catch (_) {}
              }}
              style={{
                padding: '6px 8px',
                border: 'var(--kds-b)',
                ...(accentBorderLeft ? { borderLeft: accentBorderLeft } : {}),
                borderRadius: 'var(--kds-r)',
                background: bgTint,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5,
                cursor: 'grab',
                userSelect: 'none',
                opacity: isHold ? 0.85 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--kds-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.qty}× {item.name}
                  </span>
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                    padding: '2px 5px', borderRadius: 3,
                    background: isCooking ? '#d97706' : isHold ? '#3b82f6' : 'var(--kds-linen)',
                    color: (isCooking || isHold) ? '#fff' : 'var(--kds-graphite)',
                    border: (isCooking || isHold) ? 'none' : 'var(--kds-b)'
                  }}>
                    {isCooking ? '🔥 Cooking' : isHold ? '⏸ Hold' : '⏳ Queued'}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--kds-graphite)', marginTop: 1 }}>
                  [{ordNum(order.id)}] {isCooking ? `Timer: ${fmtMSS(item.cookingElapsedSimSecs || 0)}` : `Due in: ${fmtMSS(order.slaSecsRemaining)}`}
                </div>
              </div>
              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {idx > 0 && (
                  <button
                    className="kds-interactive"
                    onClick={e => { e.stopPropagation(); onMoveUp(order.id, item.id); }}
                    title="Move Up"
                    style={{ padding: '2px 4px', border: 'var(--kds-b)', borderRadius: 3, background: 'var(--kds-linen)', fontSize: 9, fontWeight: 700, cursor: 'pointer', color: 'var(--kds-ink)' }}
                  >▲</button>
                )}
                {idx < queueEntries.length - 1 && (
                  <button
                    className="kds-interactive"
                    onClick={e => { e.stopPropagation(); onMoveDown(order.id, item.id); }}
                    title="Move Down"
                    style={{ padding: '2px 4px', border: 'var(--kds-b)', borderRadius: 3, background: 'var(--kds-linen)', fontSize: 9, fontWeight: 700, cursor: 'pointer', color: 'var(--kds-ink)' }}
                  >▼</button>
                )}
                {!isCooking && (
                  <button
                    className="kds-interactive"
                    onClick={e => { e.stopPropagation(); onStartItem(order.id, item.id); }}
                    style={{ padding: '3px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', fontSize: 9, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--kds-oxblood)', fontFamily: 'var(--kds-font-ui)', textTransform: 'uppercase' }}
                  >Prep</button>
                )}
                {!isHold && (
                  <button
                    className={`kds-interactive ${isOver ? 'kds-suggest-hold' : ''}`}
                    onClick={e => { e.stopPropagation(); onHoldItem(order.id, item.id); }}
                    style={{ padding: '3px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', fontSize: 9, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: 'var(--kds-oxblood)', fontFamily: 'var(--kds-font-ui)', textTransform: 'uppercase' }}
                  >Hold</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
