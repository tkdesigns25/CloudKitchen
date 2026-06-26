import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { KDSState, KDSOrder, KDSItem } from './types';
import {
  CFG, BRANDS, ITEM_BRAND,
  makeId, makeItem, makeOrder, createInitialState, deepClone,
  fmtMSS, ordNum,
  pickCustomer, pickNote, pickRiderName, randomColor,
  safeStorageSet,
} from './config';
import { playSound } from './audio';
import { KDSHeader } from './Header';
import { NewOrderCard } from './NewOrderCard';
import { ActiveOrderCard } from './ActiveOrderCard';
import { Column3 } from './Column3';
import { KDSModals } from './Modals';
import { UndoToast } from './UndoToast';

// ── Helpers ────────────────────────────────────────────────────
function getBulkCandidates(station: string, orders: Record<string, KDSOrder>) {
  const map: Record<string, Array<{orderId: string; item: KDSItem; sla: number}>> = {};
  Object.values(orders).forEach(o => {
    if (o.status !== 'active') return;
    o.items.forEach(item => {
      if ((item.state === 'Queued' || item.state === 'Hold') && item.station === station) {
        if (!map[item.name]) map[item.name] = [];
        map[item.name].push({ orderId: o.id, item, sla: o.slaSecsRemaining });
      }
    });
  });
  return Object.entries(map)
    .filter(([, list]) => {
      if (list.length < 2) return false;
      const slas = list.map(x => x.sla);
      return Math.max(...slas) - Math.min(...slas) <= 300;
    })
    .map(([name, list]) => ({ name, totalQty: list.reduce((s, x) => s + x.item.qty, 0), items: list }));
}

function updateCapacity(state: KDSState) {
  const counts: Record<string, number> = { 'Hot': 0, 'Grill': 0, 'Healthy Bowls': 0 };
  Object.values(state.orders).forEach(o => {
    if (o.status === 'active') {
      o.items.forEach(item => {
        if (item.state === 'Cooking') counts[item.station] = (counts[item.station] || 0) + 1;
      });
    }
  });
  const MAX = CFG.MAX_STATION_ITEMS;
  state.stationLoads = {
    'Hot':           Math.min(100, (counts['Hot']           / MAX) * 100),
    'Grill':         Math.min(100, (counts['Grill']         / MAX) * 100),
    'Healthy Bowls': Math.min(100, (counts['Healthy Bowls'] / MAX) * 100),
  };
  Object.keys(state.stationLoads).forEach(stn => {
    if (state.stationLoads[stn] > (state.shiftStats.peakLoad[stn] || 0)) {
      state.shiftStats.peakLoad[stn] = state.stationLoads[stn];
    }
  });
  const anyOver = Object.values(state.stationLoads).some(l => l >= 90);
  if (anyOver) {
    if (!state.throttleStart) state.throttleStart = Date.now();
    else if (Date.now() - state.throttleStart >= CFG.THROTTLE_TRIGGER_SECS * 1000) {
      state.throttleActive = true;
    }
  } else if (Object.values(state.stationLoads).every(l => l < 70)) {
    state.throttleActive = false;
    state.throttleStart  = null;
  }
}

// ── Main KDS Component ─────────────────────────────────────────
export function KDSApp() {
  const stateRef = useRef<KDSState>(createInitialState());
  const [, setVersion] = useState(0);
  const update = useCallback(() => setVersion(v => v + 1), []);

  // Modal visibility via clean useState (not mixed into the mutable ref)
  const [showNewOrder,  setShowNewOrder]  = useState(false);
  const [showPause,     setShowPause]     = useState(false);
  const [showMenu,      setShowMenu]      = useState(false);
  const [undoLabel,     setUndoLabel]     = useState('');

  const s = stateRef.current; // convenient alias for reading state in render

  // ── Action Functions ──────────────────────────────────────────

  function nextOrderId(): string {
    stateRef.current.orderCounter++;
    return `ORD-${String(stateRef.current.orderCounter).padStart(4, '0')}`;
  }

  function pushUndo(label: string, restore: () => void) {
    const state = stateRef.current;
    if (state.undoTimer) clearTimeout(state.undoTimer);
    state.undoEntry = restore;
    state.undoTimer = setTimeout(() => {
      stateRef.current.undoEntry = null;
      setUndoLabel('');
      update();
    }, CFG.UNDO_WINDOW_MS);
    setUndoLabel(label);
    update();
  }

  function executeUndo() {
    const state = stateRef.current;
    if (!state.undoEntry) return;
    if (state.undoTimer) clearTimeout(state.undoTimer);
    state.undoEntry();
    state.undoEntry = null;
    setUndoLabel('');
    update();
  }

  function assignRider(orderId: string) {
    const state = stateRef.current;
    const order = state.orders[orderId];
    if (!order || order.riderId) return;

    let rider = state.riders.find(r => !r.orderId && r.platform === order.source);
    if (!rider) rider = state.riders.find(r => !r.orderId);
    if (!rider) {
      const platforms: Record<string, string> = { Swiggy: 'Swiggy', Zomato: 'Zomato' };
      rider = {
        id: `RD-${String(state.riders.length + 1).padStart(3, '0')}`,
        name: pickRiderName(),
        platform: platforms[order.source] || order.source,
        orderId: null,
        tag: `Tag: ${randomColor()}-${Math.floor(Math.random() * 9) + 1}`,
        eta: Math.floor(Math.random() * 180) + 60,
        status: 'transit',
        waitSecs: 0,
      };
      state.riders.push(rider);
    }
    rider.orderId  = orderId;
    rider.status   = 'transit';
    rider.eta      = Math.floor(Math.random() * 180) + 60;
    rider.waitSecs = 0;
    order.riderId  = rider.id;
    order.riderStatus = 'transit';
    order.riderEta = rider.eta;
  }

  function acceptOrderCore(orderId: string, state: KDSState) {
    const order = state.orders[orderId];
    if (!order) return;
    order.status             = 'active';
    order.acceptedAt         = Date.now();
    order.elapsedPrepSimSecs = 0;
    order.items.forEach(item => {
      const match = state.canceledStock.find(c => c.name === item.name && c.qty >= item.qty);
      if (match) {
        const idx = state.canceledStock.indexOf(match);
        if (match.qty > item.qty) match.qty -= item.qty;
        else state.canceledStock.splice(idx, 1);
        item.state = 'Ready';
      } else {
        item.state = 'Queued';
      }
      item.cookingElapsedSimSecs = 0;
      item.queuePriority = Date.now() + Math.random();
    });
    assignRider(orderId);
  }

  function acceptOrder(orderId: string) {
    const state = stateRef.current;
    const order = state.orders[orderId];
    if (!order || order.status !== 'new') return;
    acceptOrderCore(orderId, state);
    update();
  }

  function openRejectOverlay(orderId: string) {
    stateRef.current.rejectingOrderId = orderId;
    stateRef.current.rejectReason     = null;
    update();
  }

  function closeRejectOverlay() {
    stateRef.current.rejectingOrderId = null;
    stateRef.current.rejectReason     = null;
    update();
  }

  function selectRejectReason(reason: string) {
    stateRef.current.rejectReason = reason;
    update();
  }

  function finalizeReject() {
    const state = stateRef.current;
    if (!state.rejectReason || !state.rejectingOrderId) return;
    const orderId  = state.rejectingOrderId;
    const order    = state.orders[orderId];
    if (!order) { closeRejectOverlay(); return; }

    const snapshot = deepClone(order);
    order.status   = 'rejected';

    closeRejectOverlay();
    pushUndo(`Order ${ordNum(orderId)} declined`, () => {
      stateRef.current.orders[orderId] = snapshot;
      stateRef.current.rejected = stateRef.current.rejected.filter(o => o.id !== orderId);
      stateRef.current.shiftStats.rejectedCount = Math.max(0, stateRef.current.shiftStats.rejectedCount - 1);
    });

    state.rejected.push(deepClone(order));
    delete state.orders[orderId];
    state.shiftStats.rejectedCount++;
    update();
  }

  function startItem(orderId: string, itemId: string) {
    const order = stateRef.current.orders[orderId];
    if (!order) return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    item.state = 'Cooking';
    item.cookingElapsedSimSecs = 0;
    update();
  }

  function holdItem(orderId: string, itemId: string) {
    const order = stateRef.current.orders[orderId];
    if (!order) return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    item.state = 'Hold';
    update();
  }

  function markItemReady(orderId: string, itemId: string) {
    const order = stateRef.current.orders[orderId];
    if (!order) return;
    const item = order.items.find(i => i.id === itemId);
    if (!item || item.state === 'Hold') return;
    item.state = item.state === 'Ready' ? 'Cooking' : 'Ready';
    update();
  }

  function toggleItemState(orderId: string, itemId: string) {
    const order = stateRef.current.orders[orderId];
    if (!order) return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    if (item.state === 'Queued' || item.state === 'Hold') {
      startItem(orderId, itemId);
    } else if (item.state === 'Cooking' || item.state === 'Ready') {
      markItemReady(orderId, itemId);
    }
  }

  function packOrder(orderId: string) {
    const state = stateRef.current;
    const order = state.orders[orderId];
    if (!order) return;
    order.status   = 'packed';
    order.packedAt = Date.now();
    order.sittingSecs = 0;
    update();
  }

  function confirmHandover(orderId: string) {
    const state = stateRef.current;
    const order = state.orders[orderId];
    if (!order || order.status !== 'packed') return;

    const rider  = state.riders.find(r => r.orderId === orderId);
    if (rider && rider.status !== 'arrived') return;

    const snapshot = deepClone(order);
    const onTime   = order.slaSecsRemaining >= 0;

    pushUndo(`Order ${ordNum(orderId)} handed over`, () => {
      stateRef.current.orders[orderId] = snapshot;
      stateRef.current.completed = stateRef.current.completed.filter(o => o.id !== orderId);
      if (rider) rider.orderId = orderId;
      stateRef.current.shiftStats.velocities.pop();
      if (onTime) stateRef.current.shiftStats.onTimeCount = Math.max(0, stateRef.current.shiftStats.onTimeCount - 1);
      stateRef.current.shiftStats.totalCompleted = Math.max(0, stateRef.current.shiftStats.totalCompleted - 1);
      stateRef.current.completedRush = Math.max(0, stateRef.current.completedRush - 1);
    });

    order.completedAt = Date.now();
    const velocity = (order.completedAt - (order.acceptedAt ?? order.completedAt)) / 60000;
    state.shiftStats.velocities.push(velocity);
    if (onTime) state.shiftStats.onTimeCount++;
    state.shiftStats.totalCompleted++;
    state.completedRush++;

    if (rider) { rider.orderId = null; rider.status = 'transit'; rider.eta = 0; }
    state.slaAlerted.delete(orderId);
    state.completed.push(deepClone(order));
    delete state.orders[orderId];

    checkAndShowAnalytics();
    update();
  }

  function cancelOrder(orderId: string) {
    const state = stateRef.current;
    const order = state.orders[orderId];
    if (!order) return;
    const snapshot = deepClone(order);

    order.items.forEach(item => {
      if (item.state !== 'Ready') {
        state.canceledStock.push({ id: makeId(), name: item.name, qty: item.qty, createdAtSimSecs: state.currentSimSecs || 0 });
      }
    });

    pushUndo(`Order ${ordNum(orderId)} cancelled`, () => {
      stateRef.current.orders[orderId] = snapshot;
      order.items.forEach(item => {
        if (item.state !== 'Ready') {
          const idx = stateRef.current.canceledStock.findIndex(c => c.name === item.name);
          if (idx !== -1) stateRef.current.canceledStock.splice(idx, 1);
        }
      });
      stateRef.current.shiftStats.rejectedCount = Math.max(0, stateRef.current.shiftStats.rejectedCount - 1);
    });

    const rider = state.riders.find(r => r.orderId === orderId);
    if (rider) rider.orderId = null;
    state.shiftStats.rejectedCount++;
    delete state.orders[orderId];
    update();
  }

  function consumeCanceledStock(matchId: string, orderId: string, itemName: string) {
    const state = stateRef.current;
    const order = state.orders[orderId];
    if (!order) return;
    const item = order.items.find(i => i.name === itemName);
    if (!item) return;
    const idx = state.canceledStock.findIndex(c => c.id === matchId);
    if (idx !== -1) {
      const m = state.canceledStock[idx];
      if (m.qty > item.qty) m.qty -= item.qty;
      else state.canceledStock.splice(idx, 1);
    }
    item.state = 'Ready';
    update();
  }

  function prepareInBulk(name: string, station: string) {
    let changed = false;
    Object.values(stateRef.current.orders).forEach(order => {
      if (order.status === 'active') {
        order.items.forEach(item => {
          if ((item.state === 'Queued' || item.state === 'Hold') && item.name === name && item.station === station) {
            item.state = 'Cooking';
            item.cookingElapsedSimSecs = 0;
            changed = true;
          }
        });
      }
    });
    if (changed) update();
  }

  function moveQueueItem(orderId: string, itemId: string, direction: 'up' | 'down') {
    const state = stateRef.current;
    const item  = Object.values(state.orders).flatMap(o => o.items).find(i => i.id === itemId);
    if (!item) return;
    const station = item.station;
    const all: Array<{orderId: string; item: KDSItem}> = [];
    Object.values(state.orders).forEach(o => {
      if (o.status === 'active') {
        o.items.forEach(it => {
          if (it.state === 'Queued' && it.station === station) all.push({ orderId: o.id, item: it });
        });
      }
    });
    all.sort((a, b) => a.item.queuePriority - b.item.queuePriority);
    const idx = all.findIndex(x => x.item.id === itemId);
    if (idx === -1) return;
    if (direction === 'up' && idx > 0) {
      const t = all[idx].item.queuePriority;
      all[idx].item.queuePriority     = all[idx - 1].item.queuePriority;
      all[idx - 1].item.queuePriority = t;
    } else if (direction === 'down' && idx < all.length - 1) {
      const t = all[idx].item.queuePriority;
      all[idx].item.queuePriority     = all[idx + 1].item.queuePriority;
      all[idx + 1].item.queuePriority = t;
    }
    update();
  }

  function reorderQueue(draggedItemId: string, targetItemId: string, station: string) {
    const state = stateRef.current;
    const all: Array<{orderId: string; item: KDSItem}> = [];
    Object.values(state.orders).forEach(o => {
      if (o.status === 'active') {
        o.items.forEach(item => {
          if (item.state === 'Queued' && item.station === station) all.push({ orderId: o.id, item });
        });
      }
    });
    all.sort((a, b) => a.item.queuePriority - b.item.queuePriority);
    const dIdx = all.findIndex(x => x.item.id === draggedItemId);
    const tIdx = all.findIndex(x => x.item.id === targetItemId);
    if (dIdx === -1 || tIdx === -1 || dIdx === tIdx) return;
    const [dragged] = all.splice(dIdx, 1);
    all.splice(tIdx, 0, dragged);
    const base = Date.now();
    all.forEach((x, i) => { x.item.queuePriority = base + i; });
    update();
  }

  function callRider(orderId: string) {
    const state = stateRef.current;
    const rider = state.riders.find(r => r.orderId === orderId);
    if (rider) {
      rider.status   = 'arrived';
      rider.eta      = 0;
      rider.waitSecs = 0;
      const order = state.orders[orderId];
      if (order) order.riderStatus = 'arrived';
      playSound('riderHere', state.soundEnabled);
      update();
    }
  }

  // BUG FIX #1: Resume Apps correctly clears pause state
  function resumeApps() {
    const state = stateRef.current;
    state.pausedChannels = { Swiggy: false, Zomato: false, DirectApp: false };
    state.pausedBrand    = 'All Brands';
    state.pausedUntil    = null;
    update();
  }

  function applyPause(channels: {Swiggy: boolean; Zomato: boolean; DirectApp: boolean}, brand: string, mins: number) {
    const state = stateRef.current;
    if (mins === 0) {
      resumeApps();
      return;
    }
    state.pausedChannels = channels;
    state.pausedBrand    = brand;
    const anyPaused = Object.values(channels).some(v => v);
    state.pausedUntil = anyPaused ? (state.currentSimSecs || 0) + (mins * 60) : null;
    if (!anyPaused) state.pausedBrand = 'All Brands';
    update();
  }

  function setOpen(open: boolean) {
    stateRef.current.isOpen = open;
    if (open) {
      // Queue the first order to arrive after ~3 real seconds
      stateRef.current.firstOrderCountdown = 3;
      stateRef.current.firstOrderSent      = false;
    }
    update();
  }

  function setAutoAccept(on: boolean) {
    stateRef.current.autoAccept = on;
    if (on) {
      Object.keys(stateRef.current.orders).forEach(id => {
        if (stateRef.current.orders[id].status === 'new') {
          acceptOrderCore(id, stateRef.current);
        }
      });
    }
    update();
  }

  function toggleSound() {
    const state = stateRef.current;
    state.soundEnabled = !state.soundEnabled;
    safeStorageSet('kds-sound', String(state.soundEnabled));
    if (state.soundEnabled) playSound('newOrder', true);
    update();
  }

  function saveOosItems(items: Record<string, boolean>) {
    stateRef.current.oosItems = items;
    update();
  }

  // BUG FIX #2: Manual order submission auto-accepts when autoAccept is ON
  function submitManualOrder(params: {
    customer: string; platform: string; brand: string;
    items: KDSItem[]; notes: string;
  }) {
    if (params.items.length === 0) return false;
    const state = stateRef.current;
    const id    = nextOrderId();
    const order = makeOrder({
      id,
      brand:    params.brand,
      source:   params.platform,
      customer: params.customer,
      items:    params.items,
      notes:    params.notes,
    });
    state.orders[id] = order;

    if (state.autoAccept) {
      acceptOrderCore(id, state);
    } else {
      playSound('newOrder', state.soundEnabled);
    }
    update();
    return true;
  }

  function checkAndShowAnalytics() {
    const state = stateRef.current;
    const active = Object.values(state.orders).filter(o =>
      ['new', 'active', 'packed'].includes(o.status)
    ).length;
    if (active === 0 && state.completedRush >= CFG.ANALYTICS_MIN_ORDERS) {
      const s = state.shiftStats;
      const onTimeRate = s.totalCompleted > 0
        ? Math.round((s.onTimeCount / s.totalCompleted) * 100) : 0;
      const avgVel = s.velocities.length > 0
        ? (s.velocities.reduce((a, b) => a + b, 0) / s.velocities.length).toFixed(1) : '—';
      const sortedStations = Object.entries(s.peakLoad).sort((a, b) => b[1] - a[1]);
      const peakStation = sortedStations[0] as [string, number] | undefined;

      state.analyticsSnapshot = {
        onTimeRate,
        avgVel,
        peakStation: peakStation ?? null,
        coldLog: s.coldLog,
        rejectedCount: s.rejectedCount,
        totalCompleted: s.totalCompleted,
        onTimeCount: s.onTimeCount,
      };
      state.showAnalyticsModal = true;
      state.completedRush = 0;
      state.shiftStats = {
        onTimeCount: 0, totalCompleted: 0, velocities: [],
        peakLoad: { 'Hot': 0, 'Grill': 0, 'Healthy Bowls': 0 },
        coldLog: 0, rejectedCount: 0,
      };
      update();
    }
  }

  function closeAnalytics() {
    stateRef.current.showAnalyticsModal = false;
    update();
  }

  // ── Tick Loop ─────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const state = stateRef.current;

      // First order: guaranteed within ~3 seconds of opening
      if (state.isOpen && !state.firstOrderSent) {
        if (state.firstOrderCountdown > 0) {
          state.firstOrderCountdown--;
        } else {
          state.firstOrderSent = true;
          generateSimulatedOrder();
        }
      }

      // Subsequent orders: ~5% chance per second (~1 every 20 s on average)
      if (state.isOpen && state.firstOrderSent && Math.random() < 0.05) {
        generateSimulatedOrder();
      }

      // Simulated time advances 5s per real second
      if (state.isOpen) {
        state.currentSimSecs = (state.currentSimSecs || 0) + 5;

        // Decay canceled stock after 30 sim minutes
        state.canceledStock = state.canceledStock.filter(
          item => (state.currentSimSecs - item.createdAtSimSecs) < 1800
        );

        // Auto-clear pauses
        if (state.pausedUntil && state.currentSimSecs >= state.pausedUntil) {
          state.pausedChannels = { Swiggy: false, Zomato: false, DirectApp: false };
          state.pausedBrand    = 'All Brands';
          state.pausedUntil    = null;
        }
      }

      // Process each order
      Object.values(state.orders).forEach(order => {
        if (order.status === 'new') {
          order.autoCancelSecs = Math.max(0, order.autoCancelSecs - 5);
          if (order.autoCancelSecs === 0) {
            order.status = 'rejected';
            state.rejected.push(deepClone(order));
            delete state.orders[order.id];
            state.shiftStats.rejectedCount++;
          }
        }

        if ((order.status === 'active' || order.status === 'packed') && order.acceptedAt) {
          order.slaSecsRemaining   = Math.max(-999, order.slaSecsRemaining - 5);
          order.elapsedPrepSimSecs = (order.elapsedPrepSimSecs || 0) + 5;

          if (order.slaSecsRemaining <= CFG.SLA_WARN_SECS && !state.slaAlerted.has(order.id)) {
            state.slaAlerted.add(order.id);
            playSound('slaWarn', state.soundEnabled);
          }
        }

        if (order.status === 'active') {
          order.items.forEach(item => {
            if (item.state === 'Cooking') {
              item.cookingElapsedSimSecs = (item.cookingElapsedSimSecs || 0) + 5;
            }
          });
        }

        if (order.status === 'packed') {
          order.sittingSecs = (order.sittingSecs || 0) + 5;
          if (order.sittingSecs! >= CFG.COLD_ORDER_SECS && !order._coldLogged) {
            order._coldLogged = true;
            state.shiftStats.coldLog++;
          }
          if (order.riderStatus === 'arrived') {
            order.riderCoWaitSecs = (order.riderCoWaitSecs || 0) + 5;
            if (order.riderCoWaitSecs! >= 10) {
              // Auto-handover when rider has waited 10+ sim seconds
              const rider = state.riders.find(r => r.orderId === order.id);
              if (rider && rider.status === 'arrived') {
                const onTime = order.slaSecsRemaining >= 0;
                order.completedAt = Date.now();
                const vel = (order.completedAt - (order.acceptedAt ?? order.completedAt)) / 60000;
                state.shiftStats.velocities.push(vel);
                if (onTime) state.shiftStats.onTimeCount++;
                state.shiftStats.totalCompleted++;
                state.completedRush++;
                rider.orderId = null; rider.status = 'transit'; rider.eta = 0;
                state.slaAlerted.delete(order.id);
                state.completed.push(deepClone(order));
                delete state.orders[order.id];
              }
            }
          }
        }
      });

      // Rider ETAs
      state.riders.forEach(rider => {
        if (rider.status === 'transit' && rider.eta > 0) {
          rider.eta = Math.max(0, rider.eta - 5);
          if (rider.eta === 0) {
            rider.status   = 'arrived';
            rider.waitSecs = 0;
            playSound('riderHere', state.soundEnabled);
            const order = Object.values(state.orders).find(o => o.id === rider.orderId);
            if (order) order.riderStatus = 'arrived';
          }
        }
        if (rider.status === 'arrived') rider.waitSecs = (rider.waitSecs || 0) + 5;
      });

      updateCapacity(state);
      setVersion(v => v + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []); // stable — tick reads from ref

  // ── Simulated Order Generator ─────────────────────────────────
  function generateSimulatedOrder() {
    const state = stateRef.current;
    const allItems = Object.values(BRANDS).flatMap(d => d.items.map(i => ({ name: i.name })));
    const n = Math.floor(Math.random() * 3) + 1;
    const items: KDSItem[] = [];
    for (let i = 0; i < n; i++) {
      const sel = allItems[Math.floor(Math.random() * allItems.length)];
      const modifier = Math.random() < 0.30 ? pickNote() : '';
      const existing = items.find(x => x.name === sel.name);
      if (existing) { existing.qty++; if (!existing.modifier && modifier) existing.modifier = modifier; }
      else items.push(makeItem(sel.name, 1, modifier));
    }
    const brandsSet = [...new Set(items.map(i => ITEM_BRAND[i.name]))];
    const brand     = brandsSet.join(' + ');
    const sources: Array<'Swiggy' | 'Zomato'> = ['Swiggy', 'Zomato'];
    const source    = sources[Math.floor(Math.random() * 3)];

    // Check if channel is paused
    if (state.pausedChannels[source]) {
      if (state.pausedBrand === 'All Brands' || brandsSet.includes(state.pausedBrand)) return;
    }

    const id    = nextOrderId();
    const order = makeOrder({
      id, brand, source, customer: pickCustomer(), items,
      notes: Math.random() < 0.25 ? pickNote() : '',
    });
    state.orders[id] = order;

    if (state.autoAccept) {
      acceptOrderCore(id, state);
    } else {
      playSound('newOrder', state.soundEnabled);
    }
  }

  // ── Clock ─────────────────────────────────────────────────────
  const formatClock = () => {
    try {
      return new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      });
    } catch {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
  };

  const [clock, setClock] = useState(formatClock);
  useEffect(() => {
    const t = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Computed Values ───────────────────────────────────────────
  const orders       = Object.values(s.orders);
  const newOrders    = orders.filter(o => o.status === 'new').sort((a, b) => a.autoCancelSecs - b.autoCancelSecs);
  const activeOrders = orders.filter(o => ['active', 'packed'].includes(o.status)).sort((a, b) => a.slaSecsRemaining - b.slaSecsRemaining);

  const showPauseBanner   = !!(s.pausedUntil && s.currentSimSecs < s.pausedUntil);
  const pausedRemaining   = Math.max(0, (s.pausedUntil ?? 0) - s.currentSimSecs);
  const pausedList        = Object.entries(s.pausedChannels).filter(([, p]) => p).map(([c]) => c === 'DirectApp' ? 'Own App' : c);


  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      className="kds-root"
      style={{ background: 'var(--kds-vellum)', color: 'var(--kds-ink)', height: '100dvh', overflow: 'hidden', fontFamily: 'var(--kds-font-ui)' }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <KDSHeader
        isOpen={s.isOpen}
        autoAccept={s.autoAccept}
        soundEnabled={s.soundEnabled}
        cookingCount={activeOrders.length}
        waitingCount={newOrders.length}
        doneCount={s.completed.length}
        stationLoads={s.stationLoads}
        clock={clock}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        onAutoAcceptOn={() => setAutoAccept(true)}
        onAutoAcceptOff={() => setAutoAccept(false)}
        onToggleSound={toggleSound}
        onOpenNewOrder={() => setShowNewOrder(true)}
        onOpenPause={() => setShowPause(true)}
        onOpenMenu={() => setShowMenu(true)}
      />

      {/* ── System Banners ──────────────────────────────────── */}
      <SystemBanners
        isOpen={s.isOpen}
        throttleActive={s.throttleActive}
        showPause={showPauseBanner}
        pausedList={pausedList}
        pausedBrand={s.pausedBrand}
        pausedRemaining={pausedRemaining}
        onReopen={() => setOpen(true)}
        onResumeApps={resumeApps}
      />

      {/* ── Main 3-Column Grid ──────────────────────────────── */}
      <MainGrid
        isOpen={s.isOpen}
        throttleActive={s.throttleActive}
        showPause={showPauseBanner}
      >
        {/* Col 1: New Orders */}
        <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: 'var(--kds-b)', background: 'var(--kds-vellum)' }}>
          <div style={{ flexShrink: 0, height: 'var(--kds-ch)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', background: 'var(--kds-vellum)', borderBottom: 'var(--kds-b)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>Just Came In</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 18, padding: '0 4px', background: 'var(--kds-oxblood)', color: 'var(--kds-vellum)', borderRadius: 'var(--kds-r)', fontSize: 10, fontWeight: 700 }}>{newOrders.length}</span>
          </div>
          <div className="kds-scroll" style={{ flex: 1, padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ flexShrink: 0, height: 12 }} aria-hidden />
            {newOrders.length === 0 ? (
              <EmptyState icon="◎" text="No new orders" />
            ) : newOrders.map(order => (
              <NewOrderCard
                key={order.id}
                order={order}
                oosItems={s.oosItems}
                stationLoads={s.stationLoads}
                orders={s.orders}
                canceledStock={s.canceledStock}
                currentSimSecs={s.currentSimSecs}
                onAccept={() => acceptOrder(order.id)}
                onReject={() => openRejectOverlay(order.id)}
              />
            ))}
          </div>
        </section>

        {/* Col 2: Cooking Now */}
        <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: 'var(--kds-b)', background: 'var(--kds-vellum)' }}>
          <div style={{ flexShrink: 0, height: 'var(--kds-ch)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', background: 'var(--kds-vellum)', borderBottom: 'var(--kds-b)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>Cooking Now</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 18, padding: '0 4px', background: 'var(--kds-oxblood)', color: 'var(--kds-vellum)', borderRadius: 'var(--kds-r)', fontSize: 10, fontWeight: 700 }}>{activeOrders.length}</span>
          </div>
          <div
            className="kds-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 10px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gridAutoRows: 'min-content', alignContent: 'start', alignItems: 'start', gap: 10 }}
          >
            {activeOrders.length === 0 && <EmptyState icon="◎" text="Kitchen is clear" />}
            {activeOrders.map(order => (
              <ActiveOrderCard
                key={order.id}
                order={order}
                riders={s.riders}
                canceledStock={s.canceledStock}
                currentSimSecs={s.currentSimSecs}
                stationLoads={s.stationLoads}
                orders={s.orders}
                onToggleItem={toggleItemState}
                onStartItem={startItem}
                onHoldItem={holdItem}
                onPackOrder={() => packOrder(order.id)}
                onHandover={() => confirmHandover(order.id)}
                onCallRider={() => callRider(order.id)}
                onCancel={() => cancelOrder(order.id)}
                onConsumeCanceled={consumeCanceledStock}
              />
            ))}
          </div>
        </section>

        {/* Col 3: Helpers */}
        <Column3
          orders={s.orders}
          riders={s.riders}
          stationLoads={s.stationLoads}
          onStartItem={startItem}
          onHoldItem={holdItem}
          onPrepBulk={prepareInBulk}
          onMoveUp={(oId, iId) => moveQueueItem(oId, iId, 'up')}
          onMoveDown={(oId, iId) => moveQueueItem(oId, iId, 'down')}
          onReorder={reorderQueue}
          onRiderHandover={(riderId) => {
            const rider = s.riders.find(r => r.id === riderId);
            if (rider?.orderId) confirmHandover(rider.orderId);
          }}
          getBulkCandidates={(stn) => getBulkCandidates(stn, s.orders)}
        />
      </MainGrid>

      {/* ── Modals ──────────────────────────────────────────── */}
      <KDSModals
        showNewOrder={showNewOrder}
        showPause={showPause}
        showMenu={showMenu}
        showReject={!!s.rejectingOrderId}
        showAnalytics={s.showAnalyticsModal}
        rejectReason={s.rejectReason}
        analyticsSnapshot={s.analyticsSnapshot}
        oosItems={s.oosItems}
        rejectingOrderId={s.rejectingOrderId}
        orders={s.orders}
        onCloseNewOrder={() => setShowNewOrder(false)}
        onClosePause={() => setShowPause(false)}
        onCloseMenu={() => setShowMenu(false)}
        onCloseReject={closeRejectOverlay}
        onCloseAnalytics={closeAnalytics}
        onSelectRejectReason={selectRejectReason}
        onFinalizeReject={finalizeReject}
        onApplyPause={applyPause}
        onSaveOos={saveOosItems}
        onSubmitManualOrder={submitManualOrder}
      />

      {/* ── Undo Toast ──────────────────────────────────────── */}
      <UndoToast
        visible={!!s.undoEntry}
        label={undoLabel}
        windowMs={CFG.UNDO_WINDOW_MS}
        onUndo={executeUndo}
      />
    </div>
  );
}

// ── System Banners ─────────────────────────────────────────────
function SystemBanners({ isOpen, throttleActive, showPause, pausedList, pausedBrand, pausedRemaining, onReopen, onResumeApps }: {
  isOpen: boolean; throttleActive: boolean; showPause: boolean;
  pausedList: string[]; pausedBrand: string; pausedRemaining: number;
  onReopen: () => void; onResumeApps: () => void;
}) {
  const banners: React.ReactNode[] = [];
  let top = 56; // --kds-hh

  if (!isOpen) {
    banners.push(
      <div key="closed" role="alert" style={{ position: 'fixed', left: 0, right: 0, zIndex: 190, top, padding: '8px 16px', background: 'var(--kds-gold)', color: 'var(--kds-ink)', borderBottom: 'var(--kds-b)', display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 13 }}>
        <span style={{ fontSize: 18 }}>⛔</span>
        <span style={{ flex: 1 }}>Kitchen is CLOSED — not taking new orders right now</span>
        <GhostBtn onClick={onReopen} style={{ fontSize: 11 }}>Re-open Kitchen</GhostBtn>
      </div>
    );
    top += 38;
  }

  if (throttleActive) {
    banners.push(
      <div key="throttle" role="alert" style={{ position: 'fixed', left: 0, right: 0, zIndex: 190, top, padding: '8px 16px', background: 'var(--kds-oxblood)', color: 'var(--kds-vellum)', borderBottom: 'var(--kds-b)', display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 13 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <span>Kitchen is very busy — delivery apps slowed down by 5 min</span>
      </div>
    );
    top += 38;
  }

  if (showPause) {
    const brandTxt = pausedBrand !== 'All Brands' ? ` [${pausedBrand}]` : '';
    banners.push(
      <div key="pause" role="alert" style={{ position: 'fixed', left: 0, right: 0, zIndex: 190, top, padding: '8px 16px', background: 'var(--kds-gold)', color: 'var(--kds-ink)', borderBottom: 'var(--kds-b)', display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 13 }}>
        <span style={{ fontSize: 18 }}>⏸</span>
        <span>Apps paused: {pausedList.join(', ')}{brandTxt} ({fmtMSS(pausedRemaining)} remaining)</span>
        {/* BUG FIX #1: Resume Apps button is now properly wired */}
        <GhostBtn onClick={onResumeApps} style={{ marginLeft: 'auto', fontSize: 11 }}>Resume Apps</GhostBtn>
      </div>
    );
  }

  return <>{banners}</>;
}

// ── Main Grid ──────────────────────────────────────────────────
function MainGrid({ children, isOpen, throttleActive, showPause }: {
  children: React.ReactNode; isOpen: boolean; throttleActive: boolean; showPause: boolean;
}) {
  const bannerCount = (!isOpen ? 1 : 0) + (throttleActive ? 1 : 0) + (showPause ? 1 : 0);
  return (
    <main style={{
      position: 'fixed',
      top: `calc(var(--kds-hh) + ${bannerCount * 38}px)`,
      left: 0, right: 0, bottom: 0,
      display: 'grid',
      gridTemplateColumns: '25% 50% 25%',
      transition: 'top 0.2s',
    }}>
      {children}
    </main>
  );
}

// ── Shared Primitives ──────────────────────────────────────────
export function GhostBtn({ children, onClick, style, disabled, className }: {
  children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties;
  disabled?: boolean; className?: string;
}) {
  return (
    <button
      className={`kds-interactive ${className ?? ''}`}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: '7px 13px',
        background: 'var(--kds-vellum)', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)',
        color: 'var(--kds-oxblood)',
        fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.07em', textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function OxBtn({ children, onClick, style, disabled }: {
  children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties; disabled?: boolean;
}) {
  return (
    <button
      className="kds-interactive"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 16px',
        background: 'var(--kds-oxblood)', border: '1px solid var(--kds-oxblood)', borderRadius: 'var(--kds-r)',
        color: 'var(--kds-vellum)',
        fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 11,
        letterSpacing: '0.07em', textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function ChannelBadge({ source }: { source: string }) {
  const map: Record<string, {bg: string; label: string}> = {
    Swiggy:    { bg: '#FC8019', label: 'Swiggy' },
    Zomato:    { bg: '#CB202D', label: 'Zomato' },
    Phone:     { bg: '#2c5282', label: 'Phone' },
  };
  const cfg = map[source] ?? { bg: '#0052CC', label: source };
  return (
    <span style={{ padding: '2px 6px', fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 3, color: '#fff', background: cfg.bg }}>
      {cfg.label}
    </span>
  );
}

export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', gap: 8, color: 'var(--kds-graphite)', opacity: 0.45 }}>
      <div style={{ fontSize: 34, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{text}</div>
    </div>
  );
}

