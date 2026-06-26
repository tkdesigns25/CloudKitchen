/* ============================================================
   KDS app.js — Full Optimization Build
   State machine · Predictive prep · SLA · Capacity engine
   Undo · Analytics · Sound · Dark mode · Manual orders
   ============================================================ */
'use strict';

// ══════════════════════════════════════════════════════════════
// 1. CONFIG
// ══════════════════════════════════════════════════════════════
const CFG = {
  AUTO_CANCEL_SECS:      150,   // 150 simulated seconds before new order auto-rejects
  SLA_MINUTES:           15,    // promised time from accept → handover (mins)
  MAX_STATION_ITEMS:     10,    // max capacity threshold is 10
  THROTTLE_TRIGGER_SECS: 15,    // seconds at ≥90% load before throttle fires
  THROTTLE_EXTRA_MINS:   5,     // extra prep buffer added when throttled
  UNDO_WINDOW_MS:        6000,  // 6-second undo window
  ANALYTICS_MIN_ORDERS:  3,     // min completions to show rush analytics
  SLA_WARN_SECS:         120,   // 2 minutes remaining → warning
  COLD_ORDER_SECS:       15,    // packed for this long = "food went cold"
};

// ══════════════════════════════════════════════════════════════
// 2. BRAND & ITEM DATA
// ══════════════════════════════════════════════════════════════
const BRANDS = {
  'Hot': {
    station: 'Hot',
    color: '#8b1a1a',
    items: [
      { name: 'Classic Cheese Burger',        prepSecs: 8*60 },
      { name: 'Chicken Double Patty Burger',  prepSecs: 9*60 },
      { name: 'Veg Patty Burger',             prepSecs: 7*60 },
      { name: 'Paneer Fresh Burger',          prepSecs: 8*60 },
    ]
  },
  'Grill': {
    station: 'Grill',
    color: '#2d5a2d',
    items: [
      { name: 'Classic French Fries',         prepSecs: 4*60 },
      { name: 'Peri Peri Crinkle Fries',      prepSecs: 5*60 },
      { name: 'Loaded Cheese Fries',          prepSecs: 6*60 },
    ]
  },
  'Healthy Bowls': {
    station: 'Healthy Bowls',
    color: '#1a4a6b',
    items: [
      { name: 'Brioche Burger Buns',          prepSecs: 2*60 },
      { name: 'Extra Spicy Mayo Modifier',    prepSecs: 1*60 },
      { name: 'Garlic Dip Portion',           prepSecs: 1*60 },
    ]
  }
};

// Quick lookup maps
const ITEM_STATION = {};
const ITEM_PREP    = {};
const ITEM_BRAND   = {};
Object.entries(BRANDS).forEach(([brand, data]) => {
  data.items.forEach(i => {
    ITEM_STATION[i.name] = data.station;
    ITEM_PREP[i.name]    = i.prepSecs;
    ITEM_BRAND[i.name]   = brand;
  });
});

// Standard rejection reasons (shown in the card-level overlay)
const REJECTION_REASONS = [
  'Item Out of Stock',
  'Station Overloaded',
  'Kitchen Closing',
  'Other / Operational Issue',
];

// ══════════════════════════════════════════════════════════════
// 3. SOUND ENGINE (Web Audio API — no external files)
// ══════════════════════════════════════════════════════════════
let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function _tone(freq, type, startOffset, duration, vol) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
    gain.gain.setValueAtTime(vol, ctx.currentTime + startOffset);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
    osc.start(ctx.currentTime + startOffset);
    osc.stop(ctx.currentTime + startOffset + duration);
  } catch(e) {}
}

function playSound(type) {
  if (!state.soundEnabled) return;
  if (type === 'newOrder') {
    _tone(880,  'sine', 0,    0.22, 0.35);
    _tone(1100, 'sine', 0.22, 0.28, 0.3);
  } else if (type === 'slaWarn') {
    _tone(440, 'square', 0,    0.14, 0.25);
    _tone(440, 'square', 0.22, 0.14, 0.25);
    _tone(520, 'square', 0.44, 0.18, 0.3);
  } else if (type === 'riderHere') {
    _tone(660, 'sine', 0, 0.35, 0.3);
    _tone(880, 'sine', 0.3, 0.3, 0.25);
  }
}

// ══════════════════════════════════════════════════════════════
// 4. STATE
// ══════════════════════════════════════════════════════════════
const state = {
  orders:           {},
  rejected:         [],
  completed:        [],
  riders:           [],
  orderCounter:     100,
  soundEnabled:     localStorage.getItem('kds-sound') !== 'false',
  darkMode:         localStorage.getItem('kds-dark')  === 'true',
  isOpen:           false,
  autoAccept:       true,
  canceledStock:    [],
  currentSimSecs:   0,
  oosItems:         {
    'Classic Cheese Burger': false,
    'Chicken Double Patty Burger': false,
    'Veg Patty Burger': false,
    'Paneer Fresh Burger': false,
    'Classic French Fries': false,
    'Peri Peri Crinkle Fries': false,
    'Loaded Cheese Fries': false,
    'Brioche Burger Buns': false,
    'Extra Spicy Mayo Modifier': false,
    'Garlic Dip Portion': false
  },
  pausedChannels: {
    Swiggy: false,
    Zomato: false,
    DirectApp: false
  },
  pausedBrand:      'All Brands',
  pausedUntil:      null,
  rejectingOrderId: null, // which ticket's rejection overlay is open
  rejectReason:     null, // currently selected rejection reason string
  undoEntry:        null,
  undoTimer:        null,
  undoProgress:     null,
  throttleActive:   false,
  throttleStart:    null,
  stationLoads:     { 'Hot': 0, 'Grill': 0, 'Healthy Bowls': 0 },
  slaAlerted:       new Set(),
  completedRush:    0,
  shiftStats: {
    onTimeCount:     0,
    totalCompleted:  0,
    velocities:      [],
    peakLoad:        { 'Hot': 0, 'Grill': 0, 'Healthy Bowls': 0 },
    coldLog:         0,
    rejectedCount:   0,
  },
};

// Apply dark mode on load
if (state.darkMode) document.documentElement.setAttribute('data-theme', 'dark');

// ══════════════════════════════════════════════════════════════
// 5. HELPERS
// ══════════════════════════════════════════════════════════════
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function fmtMSS(totalSecs) {
  const abs = Math.abs(totalSecs);
  const m   = Math.floor(abs / 60);
  const s   = Math.floor(abs % 60);
  const sign = totalSecs < 0 ? '-' : '';
  return `${sign}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtElapsed(ms) {
  return fmtMSS(Math.floor(ms / 1000));
}

function ordNum(id) {
  return '#' + String(id).replace(/\D/g,'').replace(/^0+/,'') || id;
}

function ageLabel(arrivedAt) {
  const s = Math.floor((Date.now() - arrivedAt) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s/60)}m ago`;
}

function getOrderStations(order) {
  const s = new Set(order.items.map(i => i.station));
  return [...s];
}

function hasOOS(order) {
  return order.items.some(i => !!state.oosItems[i.name]);
}

// Returns capacity warnings for any station this order needs that is ≥90% full.
// Low-emphasis strings only — informational, never alarming.
function getCapacityWarnings(order) {
  const stations = [...new Set(order.items.map(i => ITEM_STATION[i.name] || 'Hot'))];
  return stations
    .filter(stn => (state.stationLoads[stn] || 0) >= 90)
    .map(stn => `${stn} Station load is high`);
}

// Returns items in this new order that are currently Cooking in the active workspace.
// Batch match = incentive to accept quickly so same item cooks together.
function getBatchMatches(order) {
  const matches = {};
  const incomingNames = new Set(order.items.map(i => i.name));
  Object.values(state.orders).forEach(activeOrder => {
    if (activeOrder.status !== 'active') return;
    activeOrder.items.forEach(item => {
      if (item.state === 'Cooking' && incomingNames.has(item.name)) {
        matches[item.name] = (matches[item.name] || 0) + item.qty;
      }
    });
  });
  return Object.entries(matches).map(([name, qty]) => ({ name, qty }));
}

let _idCounter = 0;
function makeId() { return `item-${Date.now()}-${++_idCounter}`; }

// ══════════════════════════════════════════════════════════════
// 6. ORDER & ITEM FACTORIES
// ══════════════════════════════════════════════════════════════
function makeItem(name, qty, modifier = '') {
  return {
    id:                    makeId(),
    name,
    qty,
    station:               ITEM_STATION[name] || 'Hot',
    prepSecs:              ITEM_PREP[name]    || 10*60,
    state:                 'Queued', // default to Queued
    cookingElapsedSimSecs: 0,
    queuePriority:         Date.now() + Math.random(),
    modifier,
  };
}

function makeOrder({ id, brand, source, customer, items, notes = '' }) {
  return {
    id,
    brand,
    source,
    customer,
    items,
    notes,
    status:             'new',     // new | active | packing | packed | completed | rejected
    arrivedAt:          Date.now(),
    autoCancelSecs:     CFG.AUTO_CANCEL_SECS,
    acceptedAt:         null,
    packedAt:           null,
    completedAt:        null,
    slaMinutes:         CFG.SLA_MINUTES,
    slaSecsRemaining:   CFG.SLA_MINUTES * 60,
    elapsedPrepSimSecs: 0,
    riderStatus:        'none',    // none | transit | arrived
    riderEta:           null,
    riderId:            null,
    riderWaitSecs:      0,
    hasOOS:             false,
  };
}


function nextOrderId() {
  state.orderCounter++;
  return `ORD-${String(state.orderCounter).padStart(4,'0')}`;
}

// ══════════════════════════════════════════════════════════════
// 7. INITIAL DEMO DATA
// ══════════════════════════════════════════════════════════════
function loadDemoData() {
  // Started closed with zero orders.
}


// ══════════════════════════════════════════════════════════════
// 8. CAPACITY ENGINE
// ══════════════════════════════════════════════════════════════
function updateCapacityEngine() {
  const counts = { 'Hot': 0, 'Grill': 0, 'Healthy Bowls': 0 };

  Object.values(state.orders).forEach(order => {
    if (order.status === 'active') {
      order.items.forEach(item => {
        if (item.state === 'Cooking') {
          counts[item.station] = (counts[item.station] || 0) + 1;
        }
      });
    }
  });

  const MAX = CFG.MAX_STATION_ITEMS;
  state.stationLoads = {
    'Hot':           Math.min(100, (counts['Hot']           / MAX) * 100),
    'Grill':         Math.min(100, (counts['Grill']         / MAX) * 100),
    'Healthy Bowls': Math.min(100, (counts['Healthy Bowls'] / MAX) * 100),
  };

  // Track peak loads for analytics
  Object.keys(state.stationLoads).forEach(stn => {
    if (state.stationLoads[stn] > (state.shiftStats.peakLoad[stn] || 0)) {
      state.shiftStats.peakLoad[stn] = state.stationLoads[stn];
    }
  });

  // Throttle trigger: any station ≥90% for THROTTLE_TRIGGER_SECS
  const anyOverload = Object.values(state.stationLoads).some(l => l >= 90);
  if (anyOverload) {
    if (!state.throttleStart) state.throttleStart = Date.now();
    else if (Date.now() - state.throttleStart >= CFG.THROTTLE_TRIGGER_SECS * 1000) {
      state.throttleActive = true;
    }
  } else if (Object.values(state.stationLoads).every(l => l < 70)) {
    state.throttleActive = false;
    state.throttleStart  = null;
  }
}

// ══════════════════════════════════════════════════════════════
// 9. MASTER TICK (runs every second)
// ══════════════════════════════════════════════════════════════
function tick() {
  const now = Date.now();

  // Spawning check: average 3 orders per 30 seconds = 10% chance per wall-clock second
  if (state.isOpen && Math.random() < 0.10) {
    generateSimulatedOrder();
  }

  // Decay canceled stock (30 simulated minutes = 1800 simulated seconds)
  if (state.isOpen) {
    state.currentSimSecs = (state.currentSimSecs || 0) + 5;
    state.canceledStock = (state.canceledStock || []).filter(item => {
      return (state.currentSimSecs - item.createdAtSimSecs) < 1800;
    });

    // Auto-clear pauses when duration expires
    if (state.pausedUntil && state.currentSimSecs >= state.pausedUntil) {
      state.pausedChannels = { Swiggy: false, Zomato: false, DirectApp: false };
      state.pausedBrand = 'All Brands';
      state.pausedUntil = null;
      document.querySelectorAll('.plat-row').forEach(row => {
        row.classList.remove('checked');
        row.setAttribute('aria-checked', 'false');
        const infoEl = row.querySelector('.plat-sub');
        if (infoEl) infoEl.textContent = 'Currently taking orders';
      });
    }
  }

  Object.values(state.orders).forEach(order => {
    // ── New order auto-cancel countdown (decrement by 5 simulated seconds) ──
    if (order.status === 'new') {
      order.autoCancelSecs = Math.max(0, order.autoCancelSecs - 5);
      if (order.autoCancelSecs === 0) {
        _autoReject(order.id);
        return;
      }
    }

    // ── SLA countdown and prep elapsed check (simulated 5s per 1s tick) ──
    if ((order.status === 'active' || order.status === 'packed') && order.acceptedAt) {
      order.slaSecsRemaining = Math.max(-999, order.slaSecsRemaining - 5);
      order.elapsedPrepSimSecs = (order.elapsedPrepSimSecs || 0) + 5;

      // Sound alert exactly at SLA_WARN_SECS remaining (once per order)
      if (order.slaSecsRemaining <= CFG.SLA_WARN_SECS && !state.slaAlerted.has(order.id)) {
        state.slaAlerted.add(order.id);
        playSound('slaWarn');
      }
    }

    // ── Cooking elapsed check ──
    if (order.status === 'active') {
      order.items.forEach(item => {
        if (item.state === 'Cooking') {
          item.cookingElapsedSimSecs = (item.cookingElapsedSimSecs || 0) + 5;
        }
      });
    }

    // ── Packed → track sitting time ──
    if (order.status === 'packed') {
      order.sittingSecs = (order.sittingSecs || 0) + 5;
      if (order.sittingSecs >= CFG.COLD_ORDER_SECS && !order._coldLogged) {
        order._coldLogged = true;
        state.shiftStats.coldLog++;
      }

      // ── Simulated rider auto-handover check (10 simulated seconds after packing + rider arrived) ──
      if (order.riderStatus === 'arrived') {
        order.riderCoWaitSecs = (order.riderCoWaitSecs || 0) + 5;
        if (order.riderCoWaitSecs >= 10) {
          confirmHandover(order.id);
        }
      }
    }
  });

  // ── Rider ETAs (decrement by 5 simulated seconds) ──
  state.riders.forEach(rider => {
    if (rider.status === 'transit' && rider.eta > 0) {
      rider.eta = Math.max(0, rider.eta - 5);
      if (rider.eta === 0) {
        rider.status   = 'arrived';
        rider.waitSecs = 0;
        playSound('riderHere');
        // Update matching order
        const order = Object.values(state.orders).find(o => o.id === rider.orderId);
        if (order) order.riderStatus = 'arrived';
      }
    }
    if (rider.status === 'arrived') {
      rider.waitSecs = (rider.waitSecs || 0) + 5;
    }
  });

  updateCapacityEngine();
  render();
}


setInterval(tick, 1000);

const CUSTOMERS = ['Rahul S.', 'Ananya G.', 'Vikram K.', 'Neha M.', 'Rohan P.', 'Aditi V.', 'Kabir D.', 'Ishaan B.', 'Pooja R.', 'Siddharth M.'];
const NOTES = ['No onions', 'Extra spicy', 'Keep it hot', 'Add extra dip', 'Make it mild', 'No dressings'];

function pickCustomerName() {
  return CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
}

function pickRandomNote() {
  return NOTES[Math.floor(Math.random() * NOTES.length)];
}

function getCanceledMatchesForOrder(order) {
  const matches = [];
  order.items.forEach(item => {
    const match = state.canceledStock.find(c => c.name === item.name && c.qty >= item.qty);
    if (match) {
      const ageMins = Math.floor((state.currentSimSecs - match.createdAtSimSecs) / 60);
      matches.push({ name: item.name, ageMins, matchId: match.id, itemQty: item.qty });
    }
  });
  return matches;
}

function generateSimulatedOrder() {
  // Choose random items across all brands
  const allItems = [];
  Object.entries(BRANDS).forEach(([brand, data]) => {
    data.items.forEach(i => {
      allItems.push({ brand, name: i.name, prepSecs: i.prepSecs });
    });
  });

  const numItems = Math.floor(Math.random() * 3) + 1;
  const items = [];
  for (let i = 0; i < numItems; i++) {
    const selected = allItems[Math.floor(Math.random() * allItems.length)];
    const existing = items.find(x => x.name === selected.name);
    const modifier = Math.random() < 0.30 ? pickRandomNote() : '';
    if (existing) {
      existing.qty++;
      if (!existing.modifier && modifier) {
        existing.modifier = modifier;
      }
    } else {
      items.push(makeItem(selected.name, 1, modifier));
    }
  }

  const brandsSet = [...new Set(items.map(i => ITEM_BRAND[i.name]))];
  const brand = brandsSet.join(' + ');
  const source = ['Swiggy', 'Zomato', 'DirectApp'][Math.floor(Math.random() * 3)];

  if (state.pausedChannels && state.pausedChannels[source]) {
    if (state.pausedBrand === 'All Brands') {
      return; // Channel is paused for all brands
    }
    if (brandsSet.includes(state.pausedBrand)) {
      return; // Channel is paused for specific brand
    }
  }

  const id = nextOrderId();
  const customer = pickCustomerName();

  const order = makeOrder({
    id,
    brand,
    source,
    customer,
    items,
    notes: Math.random() < 0.25 ? pickRandomNote() : ''
  });

  state.orders[id] = order;

  if (state.autoAccept) {
    acceptOrderImmediately(id);
  } else {
    playSound('newOrder');
    render();
  }
}

function acceptOrderImmediately(orderId) {
  const order = state.orders[orderId];
  if (!order) return;
  order.status = 'active';
  order.acceptedAt = Date.now();
  order.elapsedPrepSimSecs = 0;
  
  order.items.forEach(item => {
    // Check if match in canceled stock
    const match = state.canceledStock.find(c => c.name === item.name && c.qty >= item.qty);
    if (match) {
      // Auto fulfill
      const idx = state.canceledStock.indexOf(match);
      if (idx !== -1) {
        if (match.qty > item.qty) {
          match.qty -= item.qty;
        } else {
          state.canceledStock.splice(idx, 1);
        }
      }
      item.state = 'Ready';
    } else {
      // All items start in Queued state.
      item.state = 'Queued';
    }
    item.cookingElapsedSimSecs = 0;
    item.queuePriority = Date.now() + Math.random();
  });
  
  assignRiderToOrder(orderId);
  render();
}

function startItemManual(orderId, itemId) {
  const order = state.orders[orderId];
  if (!order) return;
  const item = order.items.find(i => i.id === itemId);
  if (!item) return;
  item.state = 'Cooking';
  item.cookingElapsedSimSecs = 0;
  render();
}

function holdItemManual(orderId, itemId) {
  const order = state.orders[orderId];
  if (!order) return;
  const item = order.items.find(i => i.id === itemId);
  if (!item) return;
  item.state = 'Hold';
  render();
}

function packOrder(orderId) {
  const order = state.orders[orderId];
  if (!order) return;
  order.status = 'packed';
  order.packedAt = Date.now();
  order.sittingSecs = 0;
  render();
}

function consumeCanceledStock(matchId, orderId, itemName) {
  const order = state.orders[orderId];
  if (!order) return;
  const item = order.items.find(i => i.name === itemName);
  if (!item) return;

  const idx = state.canceledStock.findIndex(c => c.id === matchId);
  if (idx !== -1) {
    const match = state.canceledStock[idx];
    if (match.qty > item.qty) {
      match.qty -= item.qty;
    } else {
      state.canceledStock.splice(idx, 1);
    }
  } else {
    const nameIdx = state.canceledStock.findIndex(c => c.name === itemName);
    if (nameIdx !== -1) {
      const match = state.canceledStock[nameIdx];
      if (match.qty > item.qty) {
        match.qty -= item.qty;
      } else {
        state.canceledStock.splice(nameIdx, 1);
      }
    }
  }
  
  item.state = 'Ready';
  render();
}

function prepareInBulk(name, station) {
  let count = 0;
  Object.values(state.orders).forEach(order => {
    if (order.status === 'active') {
      order.items.forEach(item => {
        if ((item.state === 'Queued' || item.state === 'Hold') && item.name === name && item.station === station) {
          item.state = 'Cooking';
          item.cookingElapsedSimSecs = 0;
          count++;
        }
      });
    }
  });
  if (count > 0) render();
}

function getBulkCandidates(station) {
  const map = {};
  Object.values(state.orders).forEach(order => {
    if (order.status === 'active') {
      order.items.forEach(item => {
        if ((item.state === 'Queued' || item.state === 'Hold') && item.station === station) {
          if (!map[item.name]) map[item.name] = [];
          map[item.name].push({ orderId: order.id, item, sla: order.slaSecsRemaining });
        }
      });
    }
  });

  const candidates = [];
  Object.entries(map).forEach(([name, list]) => {
    if (list.length >= 2) {
      const SLAs = list.map(x => x.sla);
      const minSLA = Math.min(...SLAs);
      const maxSLA = Math.max(...SLAs);
      if (maxSLA - minSLA <= 300) {
        const totalQty = list.reduce((sum, x) => sum + x.item.qty, 0);
        candidates.push({ name, totalQty, items: list });
      }
    }
  });
  return candidates;
}

function reorderQueueItems(draggedOrderId, draggedItemId, targetOrderId, targetItemId, station) {
  const items = [];
  Object.values(state.orders).forEach(order => {
    if (order.status === 'active') {
      order.items.forEach(item => {
        if (item.state === 'Queued' && item.station === station) {
          items.push({ orderId: order.id, item });
        }
      });
    }
  });
  items.sort((a, b) => a.item.queuePriority - b.item.queuePriority);

  const draggedIndex = items.findIndex(x => x.orderId === draggedOrderId && x.item.id === draggedItemId);
  const targetIndex = items.findIndex(x => x.orderId === targetOrderId && x.item.id === targetItemId);

  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

  const [dragged] = items.splice(draggedIndex, 1);
  items.splice(targetIndex, 0, dragged);

  const basePriority = Date.now();
  items.forEach((x, idx) => {
    x.item.queuePriority = basePriority + idx;
  });

  render();
}

function moveQueueItem(orderId, itemId, direction) {
  const order = state.orders[orderId];
  if (!order) return;
  const item = order.items.find(i => i.id === itemId);
  if (!item) return;
  const station = item.station;

  const items = [];
  Object.values(state.orders).forEach(o => {
    if (o.status === 'active') {
      o.items.forEach(it => {
        if (it.state === 'Queued' && it.station === station) {
          items.push({ orderId: o.id, item: it });
        }
      });
    }
  });
  items.sort((a, b) => a.item.queuePriority - b.item.queuePriority);

  const idx = items.findIndex(x => x.orderId === orderId && x.item.id === itemId);
  if (idx === -1) return;

  if (direction === 'up' && idx > 0) {
    const temp = items[idx].item.queuePriority;
    items[idx].item.queuePriority = items[idx - 1].item.queuePriority;
    items[idx - 1].item.queuePriority = temp;
  } else if (direction === 'down' && idx < items.length - 1) {
    const temp = items[idx].item.queuePriority;
    items[idx].item.queuePriority = items[idx + 1].item.queuePriority;
    items[idx + 1].item.queuePriority = temp;
  }

  render();
}

function callRider(orderId) {
  const order = state.orders[orderId];
  if (!order) return;
  const rider = state.riders.find(r => r.orderId === orderId);
  if (rider) {
    rider.status = 'arrived';
    rider.eta = 0;
    rider.waitSecs = 0;
    order.riderStatus = 'arrived';
    playSound('riderHere');
    render();
  }
}


// ══════════════════════════════════════════════════════════════
// 11. RIDER ASSIGNMENT
// ══════════════════════════════════════════════════════════════
function assignRiderToOrder(orderId) {
  const order = state.orders[orderId];
  if (!order || order.riderId) return;

  // Find an unassigned rider matching the platform
  let rider = state.riders.find(r => !r.orderId && r.platform === order.source);
  if (!rider) rider = state.riders.find(r => !r.orderId); // any unassigned
  if (!rider) {
    // Create a new mock rider
    const platforms = { 'Swiggy': 'Swiggy', 'Zomato': 'Zomato' };
    const platform = platforms[order.source] || order.source;
    rider = {
      id:       `RD-${String(state.riders.length + 1).padStart(3,'0')}`,
      name:     pickRiderName(),
      platform,
      orderId:  null,
      tag:      `Tag: ${randomColor()}-${Math.floor(Math.random()*9)+1}`,
      eta:      Math.floor(Math.random() * 180) + 60,
      status:   'transit',
      waitSecs: 0,
    };
    state.riders.push(rider);
  }

  // Reset rider state for the new delivery assignment
  rider.orderId      = orderId;
  rider.status       = 'transit';
  rider.eta          = Math.floor(Math.random() * 180) + 60;
  rider.waitSecs     = 0;

  order.riderId      = rider.id;
  order.riderStatus  = rider.status;
  order.riderEta     = rider.eta;
}

const RIDER_NAMES = ['Rajan K.','Priya S.','Arjun M.','Sundar D.','Meena P.','Vikram J.','Anita R.','Deepak L.'];
let _nameIdx = 0;
function pickRiderName() { return RIDER_NAMES[_nameIdx++ % RIDER_NAMES.length]; }
function randomColor()   { return ['Blue','Red','Green','Yellow','Orange'][Math.floor(Math.random()*5)]; }

// ══════════════════════════════════════════════════════════════
// 12. ORDER ACTIONS
// ══════════════════════════════════════════════════════════════

// Accept a new order
function acceptOrder(orderId) {
  const order = state.orders[orderId];
  if (!order || order.status !== 'new') return;

  order.status     = 'active';
  order.acceptedAt = Date.now();
  order.elapsedPrepSimSecs = 0;

  // Process items
  order.items.forEach(item => {
    // Check if match was selected for fulfillment from canceled stock (scoped to this order card)
    const checkbox = document.querySelector(`.new-ticket[data-order-id="${orderId}"] input[data-fulfill-item-name="${item.name}"]`);
    if (checkbox && checkbox.checked) {
      const matchId = checkbox.dataset.fulfillMatchId;
      const idx = state.canceledStock.findIndex(c => c.id === matchId);
      if (idx !== -1) {
        const match = state.canceledStock[idx];
        if (match.qty > item.qty) {
          match.qty -= item.qty;
        } else {
          state.canceledStock.splice(idx, 1);
        }
      }
      item.state = 'Ready';
    } else {
      // All items start in Queued state.
      item.state = 'Queued';
    }
    item.cookingElapsedSimSecs = 0;
    item.queuePriority = Date.now() + Math.random();
  });

  assignRiderToOrder(orderId);

  animateCard(orderId, 'new', () => render());
}


// Reject a new order — called after reason is confirmed in the overlay
function rejectOrder(orderId) {
  const order = state.orders[orderId];
  if (!order) return;

  const snapshot = deepClone(order);
  order.status = 'rejected';

  pushUndo({
    label:   `Order ${ordNum(orderId)} turned away`,
    restore: () => {
      state.orders[orderId] = snapshot;
      state.rejected = state.rejected.filter(o => o.id !== orderId);
      state.shiftStats.rejectedCount = Math.max(0, state.shiftStats.rejectedCount - 1);
    }
  });

  animateCard(orderId, 'new', () => {
    state.rejected.push(deepClone(order));
    delete state.orders[orderId];
    state.shiftStats.rejectedCount++;
    render();
  });
}

// ── Rejection overlay controls ──────────────────────────────────

// Open the centered rejection reason modal for a specific order
function openRejectOverlay(orderId) {
  state.rejectingOrderId = orderId;
  state.rejectReason     = null;
  renderRejectReasons();
  
  const modal = document.getElementById('reject-modal');
  if (modal) {
    modal.classList.add('open');
  }
}

// Close the centered modal
function closeRejectOverlay() {
  state.rejectingOrderId = null;
  state.rejectReason     = null;
  
  const modal = document.getElementById('reject-modal');
  if (modal) {
    modal.classList.remove('open');
  }
}

// Record the selected reason
function selectRejectReason(reason) {
  state.rejectReason = reason;
  renderRejectReasons();
}

// Confirm rejection
function finalizeReject(orderId) {
  if (!state.rejectReason) return;
  const targetId = orderId || state.rejectingOrderId;
  closeRejectOverlay();
  rejectOrder(targetId);
}

// Render option rows in the centered rejection modal
function renderRejectReasons() {
  const listEl = document.getElementById('reject-reason-list');
  if (!listEl) return;

  const html = REJECTION_REASONS.map(reason => {
    const isSelected = state.rejectReason === reason;
    const selectedClass = isSelected ? ' selected' : '';
    return `
      <div class="reject-reason-row${selectedClass}" data-reason="${reason}" role="radio"
        aria-checked="${isSelected}" tabindex="0">
        <div class="reject-radio"></div>
        <span class="reject-reason-text">${reason}</span>
      </div>
    `;
  }).join('');
  
  listEl.innerHTML = html;

  const confirmBtn = document.getElementById('reject-confirm');
  if (confirmBtn) {
    confirmBtn.disabled = !state.rejectReason;
  }
}

// Auto-reject (timer expired)
function _autoReject(orderId) {
  const order = state.orders[orderId];
  if (!order) return;
  order.status = 'rejected';
  state.rejected.push(deepClone(order));
  delete state.orders[orderId];
  state.shiftStats.rejectedCount++;
}

// Start a held item (cook taps "Start Now")
function startItem(orderId, itemId) {
  const order = state.orders[orderId];
  if (!order) return;
  const item = order.items.find(i => i.id === itemId);
  if (!item || item.state !== 'Hold') return;

  item.state        = 'Cooking';
  item.cookingStart = Date.now();
  item.readyToStart = false;
  render();
}

// Mark an item done (cook taps checkbox)
function markItemReady(orderId, itemId) {
  const order = state.orders[orderId];
  if (!order) return;
  const item = order.items.find(i => i.id === itemId);
  if (!item || item.state === 'Hold') return;

  item.state = item.state === 'Ready' ? 'Cooking' : 'Ready';
  render();
}

// Confirm packing (all items done, manager confirms boxing)
function confirmPacking(orderId) {
  const order = state.orders[orderId];
  if (!order || order.status !== 'packing') return;

  order.status   = 'packed';
  order.packedAt = Date.now();
  render();
}

// Confirm handover to rider
function confirmHandover(orderId) {
  const order = state.orders[orderId];
  if (!order || order.status !== 'packed') return;

  const rider = state.riders.find(r => r.orderId === orderId);
  if (rider && rider.status !== 'arrived') return; // safety check

  const snapshot = deepClone(order);

  const onTime = order.slaSecsRemaining >= 0;
  pushUndo({
    label:   `Order ${ordNum(orderId)} handed over`,
    restore: () => {
      state.orders[orderId] = snapshot;
      state.completed = state.completed.filter(o => o.id !== orderId);
      if (rider) { rider.orderId = orderId; }

      // Rollback completed statistics
      state.shiftStats.velocities.pop();
      if (onTime) {
        state.shiftStats.onTimeCount = Math.max(0, state.shiftStats.onTimeCount - 1);
      }
      state.shiftStats.totalCompleted = Math.max(0, state.shiftStats.totalCompleted - 1);
      state.completedRush = Math.max(0, state.completedRush - 1);
    }
  });

  // Record stats
  order.completedAt = Date.now();
  const velocity    = (order.completedAt - order.acceptedAt) / 60000;
  state.shiftStats.velocities.push(velocity);
  if (onTime) state.shiftStats.onTimeCount++;
  state.shiftStats.totalCompleted++;
  state.completedRush++;

  if (rider) { rider.orderId = null; rider.status = 'transit'; rider.eta = 0; }
  state.slaAlerted.delete(orderId);

  animateCard(orderId, 'active', () => {
    state.completed.push(deepClone(order));
    delete state.orders[orderId];
    checkAnalytics();
    render();
  });
}

// Cancel an active order
function cancelOrder(orderId) {
  const order = state.orders[orderId];
  if (!order) return;

  const snapshot = deepClone(order);

  // Ingest items to canceled stock recovery database
  order.items.forEach(item => {
    if (item.state !== 'Ready') {
      state.canceledStock.push({
        id: makeId(),
        name: item.name,
        qty: item.qty,
        createdAtSimSecs: state.currentSimSecs || 0
      });
    }
  });

  pushUndo({
    label:   `Order ${ordNum(orderId)} cancelled`,
    restore: () => {
      // Restore order
      state.orders[orderId] = snapshot;
      // Remove matching items from canceled stock
      order.items.forEach(item => {
        if (item.state !== 'Ready') {
          const idx = state.canceledStock.findIndex(c => c.name === item.name);
          if (idx !== -1) state.canceledStock.splice(idx, 1);
        }
      });
      state.shiftStats.rejectedCount = Math.max(0, state.shiftStats.rejectedCount - 1);
    }
  });

  const rider = state.riders.find(r => r.orderId === orderId);
  if (rider) { rider.orderId = null; }

  animateCard(orderId, 'active', () => {
    state.shiftStats.rejectedCount++;
    delete state.orders[orderId];
    render();
  });
}

// ══════════════════════════════════════════════════════════════
// 13. UNDO SYSTEM
// ══════════════════════════════════════════════════════════════
function pushUndo({ label, restore }) {
  if (state.undoTimer) clearInterval(state.undoTimer);

  state.undoEntry = restore;
  document.getElementById('undo-msg').textContent = `${label}.`;

  const toast    = document.getElementById('undo-toast');
  const progress = document.getElementById('undo-progress');
  toast.classList.add('visible');
  progress.style.transition = 'none';
  progress.style.width = '100%';

  // Force reflow then animate
  setTimeout(() => {
    progress.style.transition = `width ${CFG.UNDO_WINDOW_MS}ms linear`;
    progress.style.width = '0%';
  }, 30);

  state.undoTimer = setTimeout(() => {
    commitUndo();
  }, CFG.UNDO_WINDOW_MS);
}

function executeUndo() {
  if (!state.undoEntry) return;
  clearTimeout(state.undoTimer);
  state.undoEntry();
  state.undoEntry = null;
  document.getElementById('undo-toast').classList.remove('visible');
  render();
}

function commitUndo() {
  state.undoEntry = null;
  document.getElementById('undo-toast').classList.remove('visible');
}

// ══════════════════════════════════════════════════════════════
// 14. ANALYTICS
// ══════════════════════════════════════════════════════════════
function checkAnalytics() {
  const active = Object.values(state.orders).filter(o =>
    o.status === 'new' || o.status === 'active' || o.status === 'packing' || o.status === 'packed'
  ).length;

  if (active === 0 && state.completedRush >= CFG.ANALYTICS_MIN_ORDERS) {
    setTimeout(showAnalytics, 600);
    state.completedRush = 0;
  }
}

function showAnalytics() {
  const s = state.shiftStats;
  const onTimeRate = s.totalCompleted > 0 ? Math.round((s.onTimeCount / s.totalCompleted) * 100) : 0;
  const avgVel     = s.velocities.length > 0
    ? (s.velocities.reduce((a,b) => a+b, 0) / s.velocities.length).toFixed(1)
    : '—';

  const peakStation = Object.entries(s.peakLoad).sort((a,b) => b[1]-a[1])[0];

  const grid = document.getElementById('analytics-grid');
  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-val">${onTimeRate}%</div>
      <div class="stat-card-lbl">Orders on time</div>
      <div class="stat-card-sub">${s.onTimeCount} of ${s.totalCompleted} packed within promised time</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-val">${avgVel}</div>
      <div class="stat-card-lbl">Avg. minutes per order</div>
      <div class="stat-card-sub">From starting to handing over</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-val">${peakStation ? peakStation[0] : '—'}</div>
      <div class="stat-card-lbl">Busiest station this rush</div>
      <div class="stat-card-sub">Hit ${Math.round(peakStation?.[1] ?? 0)}% max load</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-val">${s.coldLog}</div>
      <div class="stat-card-lbl">Orders that sat too long</div>
      <div class="stat-card-sub">Packed but waited ${CFG.COLD_ORDER_SECS}+ seconds for rider</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-val">${s.rejectedCount}</div>
      <div class="stat-card-lbl">Orders turned away</div>
      <div class="stat-card-sub">Rejected or cancelled this rush</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-val">${s.totalCompleted}</div>
      <div class="stat-card-lbl">Total orders finished</div>
      <div class="stat-card-sub">Successfully handed over this rush</div>
    </div>
  `;

  // Contextual tip
  const tip = document.getElementById('analytics-tip');
  let tipText = '👍 Solid rush! Everything ran smoothly.';
  if (s.coldLog > 0) {
    tipText = `💡 Tip: ${s.coldLog} order${s.coldLog>1?'s':''} sat packed too long. Next rush, hold the drinks and fast sides by a few extra minutes so everything is ready together.`;
  } else if (onTimeRate < 80) {
    tipText = `💡 Tip: Only ${onTimeRate}% of orders were on time. Check if the ${peakStation?.[0]} station needs more hands during peak.`;
  } else if (s.rejectedCount > 2) {
    tipText = `💡 Tip: ${s.rejectedCount} orders were turned away. Consider pausing Swiggy/Zomato earlier next time to avoid auto-cancellations.`;
  }
  tip.innerHTML = `<div class="analytics-tip-lbl">Tip for next rush</div>${tipText}`;

  document.getElementById('analytics-modal').classList.add('open');

  // Reset stats for next rush
  state.shiftStats = { onTimeCount:0, totalCompleted:0, velocities:[], peakLoad:{'Hot':0,'Grill':0,'Healthy Bowls':0}, coldLog:0, rejectedCount:0 };
}

// ══════════════════════════════════════════════════════════════
// 15. CARD EXIT ANIMATION
// ══════════════════════════════════════════════════════════════
function animateCard(orderId, col, callback) {
  const selector = col === 'new'
    ? `.new-ticket[data-order-id="${orderId}"]`
    : `.active-card[data-order-id="${orderId}"]`;
  const el = document.querySelector(selector);
  if (el) {
    el.classList.add('kds-ticket-exit');
    el.addEventListener('animationend', callback, { once: true });
  } else {
    callback();
  }
}

// ══════════════════════════════════════════════════════════════
// 16. BATCH GROUPS (Col 3 panel — shows items shared across multiple active orders)
// ══════════════════════════════════════════════════════════════
function getBatchGroups() {
  const map = {};
  Object.values(state.orders).forEach(order => {
    if (order.status !== 'active') return;
    order.items.forEach(item => {
      if (item.state === 'Ready') return;
      if (!map[item.name]) map[item.name] = { totalQty: 0, orderIds: [] };
      map[item.name].totalQty += item.qty;
      if (!map[item.name].orderIds.includes(order.id)) map[item.name].orderIds.push(order.id);
    });
  });
  return Object.entries(map)
    .filter(([, v]) => v.orderIds.length >= 2)
    .map(([name, v]) => ({ name, ...v }));
}

// ══════════════════════════════════════════════════════════════
// 17. RENDER ENGINE
// ══════════════════════════════════════════════════════════════
function captureLayout(container) {
  const rects = new Map();
  if (!container) return rects;
  Array.from(container.children).forEach(child => {
    const id = child.dataset.orderId || child.dataset.riderId || child.dataset.groupName || child.id;
    if (id) {
      rects.set(id, child.getBoundingClientRect());
    }
  });
  return rects;
}

function animateLayout(container, oldRects) {
  if (!container) return;
  Array.from(container.children).forEach(child => {
    const id = child.dataset.orderId || child.dataset.riderId || child.dataset.groupName || child.id;
    if (!id) return;
    const oldRect = oldRects.get(id);
    if (!oldRect) return;
    
    const newRect = child.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;
    
    if (deltaX !== 0 || deltaY !== 0) {
      child.style.transition = 'none';
      child.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      child.getBoundingClientRect(); // force reflow
      child.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
      child.style.transform = '';
      child.addEventListener('transitionend', () => {
        child.style.transition = '';
      }, { once: true });
    }
  });
}

function render() {
  const newList = document.getElementById('new-list');
  const activeGrid = document.getElementById('active-grid');
  const queueBody = document.getElementById('queue-body');
  const ridersBody = document.getElementById('riders-body');

  const newRects = captureLayout(newList);
  const activeRects = captureLayout(activeGrid);
  const queueRects = captureLayout(queueBody);
  const riderRects = captureLayout(ridersBody);

  renderHeader();
  renderBanners();
  renderNewOrders();
  renderActiveOrders();
  renderStationQueues();
  renderRiders();

  animateLayout(newList, newRects);
  animateLayout(activeGrid, activeRects);
  animateLayout(queueBody, queueRects);
  animateLayout(ridersBody, riderRects);
}


// ── Header stats & station loads ──
function renderHeader() {
  const orders = Object.values(state.orders);
  const cooking = orders.filter(o => o.status === 'active' || o.status === 'packed');
  const waiting = orders.filter(o => o.status === 'new');

  document.getElementById('stat-cooking').textContent = cooking.length;
  document.getElementById('stat-waiting').textContent = waiting.length;
  document.getElementById('stat-done').textContent    = state.completed.length;
  document.getElementById('badge-new').textContent    = waiting.length;
  document.getElementById('badge-active').textContent = cooking.length;

  const stations = ['Hot', 'Grill', 'Healthy Bowls'];
  stations.forEach(station => {
    const trackId = getStationTrackId(station);
    const trackEl = document.getElementById(trackId);
    if (!trackEl) return;

    let activeCount = 0;
    orders.forEach(order => {
      if (order.status === 'active') {
        order.items.forEach(item => {
          if ((item.state === 'Cooking' || item.state === 'Queued') && item.station === station) {
            activeCount++;
          }
        });
      }
    });

    const isOverloaded = activeCount >= 10;
    trackEl.classList.toggle('overloaded', isOverloaded);

    let html = '';
    for (let i = 0; i < 10; i++) {
      const filledClass = i < activeCount ? ' filled' : '';
      html += `<div class="sl-segment${filledClass}"></div>`;
    }
    trackEl.innerHTML = html;
  });
}

function getStationTrackId(station) {
  if (station === 'Grill') return 'sl-track-grill';
  if (station === 'Healthy Bowls') return 'sl-track-bowls';
  return 'sl-track-hot';
}



// ── System banners ──
function renderBanners() {
  const closedBanner   = document.getElementById('closed-banner');
  const throttleBanner = document.getElementById('throttle-banner');
  const pauseBanner    = document.getElementById('pause-banner');
  const mainGrid       = document.getElementById('main-grid');

  const showClosed = !state.isOpen;
  const showThrottle = state.throttleActive;
  const showPause = state.pausedUntil && state.currentSimSecs < state.pausedUntil;

  closedBanner.classList.toggle('visible', showClosed);
  throttleBanner.classList.toggle('visible', showThrottle);
  pauseBanner.classList.toggle('visible', showPause);

  let bannerCount = 0;
  if (showClosed) {
    closedBanner.style.top = `var(--hh)`;
    bannerCount++;
  }
  if (showThrottle) {
    throttleBanner.style.top = `calc(var(--hh) + ${bannerCount * 38}px)`;
    bannerCount++;
  }
  if (showPause) {
    pauseBanner.style.top = `calc(var(--hh) + ${bannerCount * 38}px)`;
    bannerCount++;

    // Update banner text
    const pausedList = Object.entries(state.pausedChannels)
      .filter(([_, paused]) => paused)
      .map(([channel, _]) => channel === 'DirectApp' ? 'Own App' : channel);
    
    const remainingSecs = Math.max(0, state.pausedUntil - state.currentSimSecs);
    const brandText = state.pausedBrand !== 'All Brands' ? ` [${state.pausedBrand}]` : '';
    const bannerTextEl = document.getElementById('pause-banner-text');
    if (bannerTextEl) {
      bannerTextEl.textContent = `Apps paused: ${pausedList.join(', ')}${brandText} (${fmtMSS(remainingSecs)} remaining)`;
    }
  }

  mainGrid.style.top = `calc(var(--hh) + ${bannerCount * 38}px)`;
}

function getItemModifierHTML(item) {
  if (item.modifier) {
    return `<div class="text-xs italic opacity-75 mt-0.5" style="padding-left: 14px;"><span class="text-[var(--c-oxblood)] mr-1">♦</span>${item.modifier}</div>`;
  }
  return '';
}

function getChannelBadge(source) {
  let bg = 'bg-blue-600';
  let name = source;
  if (source === 'Swiggy') {
    bg = 'bg-[#FC8019]';
  } else if (source === 'Zomato') {
    bg = 'bg-[#CB202D]';
  } else {
    bg = 'bg-[#0052CC]';
    name = 'Own App';
  }
  return `<span class="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider rounded text-white ${bg}">${name}</span>`;
}

function getPlacedTime(arrivedAt) {
  const date = new Date(arrivedAt);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ── Col 1: New orders ──
function renderNewOrders() {
  const newOrders = Object.values(state.orders)
    .filter(o => o.status === 'new')
    .sort((a, b) => a.autoCancelSecs - b.autoCancelSecs); // most urgent first

  const list  = document.getElementById('new-list');
  const empty = document.getElementById('new-empty');

  empty.style.display = newOrders.length === 0 ? 'flex' : 'none';

  // 1. Remove cards that are no longer in newOrders
  const existingCards = list.querySelectorAll('.new-ticket');
  existingCards.forEach(card => {
    const orderId = card.dataset.orderId;
    if (!newOrders.some(o => o.id === orderId)) {
      card.remove();
    }
  });

  // 2. Add or update cards
  newOrders.forEach(order => {
    const oos        = hasOOS(order);
    const secs       = order.autoCancelSecs;
    const cancelClass = secs <= 15 ? 'urgent' : secs <= 45 ? 'warn' : '';
    const capWarns   = getCapacityWarnings(order);
    const batchHits  = getBatchMatches(order);

    // Group items by station
    const itemsByStation = {};
    order.items.forEach(item => {
      const stn = item.station;
      if (!itemsByStation[stn]) {
        itemsByStation[stn] = [];
      }
      itemsByStation[stn].push(item);
    });

    let itemSectionsHTML = '';
    Object.entries(itemsByStation).forEach(([station, stationItems]) => {
      const stationItemsHTML = stationItems.map(item => {
        const modifierHTML = getItemModifierHTML(item);
        return `
          <article class="p-3 flex items-start justify-between border-b border-[var(--c-border)]/10 last:border-b-0" data-purpose="order-item">
            <div class="flex items-start gap-2.5 flex-grow">
              <div class="min-w-0">
                <p class="text-[10px] font-bold opacity-60">${item.qty}×</p>
                <h3 class="text-sm font-bold leading-tight item-name text-[var(--c-ink)]">${item.name}</h3>
                ${modifierHTML}
              </div>
            </div>
          </article>
        `;
      }).join('');

      itemSectionsHTML += `
        <section class="border-b border-[var(--c-border)] last:border-b-0">
          <div class="bg-linen px-4 py-1 border-b border-[var(--c-border)]/20">
            <span class="station-label font-bold uppercase text-oxblood">${station} Station</span>
          </div>
          ${stationItemsHTML}
        </section>
      `;
    });

    // ── Build capacity warning HTML ──
    const capWarnHTML = capWarns.map(w =>
      `<div class="px-4 py-1.5 bg-yellow-100/80 border-b border-[var(--c-border)] text-xs italic text-[var(--c-ink)]">${w}</div>`
    ).join('');

    // ── Build batch match HTML ──
    const batchHTML = batchHits.map(m =>
      `<div class="px-4 py-1.5 bg-green-100/80 border-b border-[var(--c-border)] text-xs font-bold text-green-900">
        ⚡ Batch chance: ${m.qty}× ${m.name} already cooking
       </div>`
    ).join('');

    // ── Build canceled stock matches HTML ──
    const canceledMatches = getCanceledMatchesForOrder(order);
    let canceledPromptHTML = '';
    canceledMatches.forEach(match => {
      canceledPromptHTML += `
        <div class="canceled-fulfill-prompt flex items-center gap-2 px-4 py-1.5 bg-yellow-50/70 border-b border-[var(--c-border)] text-xs text-[var(--c-ink)]">
          <input type="checkbox" id="fulfill-${order.id}-${match.matchId}" data-fulfill-match-id="${match.matchId}" data-fulfill-item-name="${match.name}" class="w-4 h-4 border-[var(--c-border)] rounded text-oxblood focus:ring-oxblood" style="margin:0;" />
          <label for="fulfill-${order.id}-${match.matchId}" class="cursor-pointer font-bold select-none">↺ Fulfill from Canceled: ${match.name} (Made ${match.ageMins}m ago)</label>
        </div>
      `;
    });

    const placedTime = getPlacedTime(order.arrivedAt);
    const platformBadge = getChannelBadge(order.source);

    let card = list.querySelector(`.new-ticket[data-order-id="${order.id}"]`);

    if (card && card.classList.contains('kds-ticket-exit')) return;

    const wrapperClassBase = `new-ticket kds-interactive${oos ? ' has-oos' : ''} w-full max-w-[420px] bg-vellum border border-[var(--c-border)] rounded-custom overflow-hidden flex flex-col text-[var(--c-ink)] shadow-lg`;

    if (!card) {
      card = document.createElement('article');
      card.className = `${wrapperClassBase} kds-ticket-entry`;
      card.dataset.orderId = order.id;
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `New order ${order.id} from ${order.source}`);
      list.appendChild(card);
    } else {
      card.className = wrapperClassBase;
    }

    const structuralHtml = `
      <!-- TOP SECTION -->
      <header class="flex justify-between items-stretch border-b border-[var(--c-border)] flex-shrink-0">
        <!-- Top Left -->
        <div class="p-4 border-r border-[var(--c-border)] flex flex-col justify-between">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-widest opacity-60">Order</span>
            <h1 class="order-num-display text-5xl leading-none text-oxblood">${ordNum(order.id)}</h1>
          </div>
          <div class="mt-4">
            <div class="mb-1">${platformBadge}</div>
            <p class="text-[10px] opacity-80">Placed ${placedTime}</p>
          </div>
        </div>
        <!-- Top Right -->
        <div class="flex-grow flex flex-col">
          <div class="bg-oxblood text-vellum p-4 flex-grow flex flex-col items-end justify-center">
            <span class="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">Time Remaining</span>
            <div class="countdown-display text-4xl"><span class="kds-timer-autocancel"></span></div>
          </div>
        </div>
      </header>

      <!-- Alert Banners -->
      ${oos ? `<div class="px-4 py-2 bg-yellow-100/90 border-b border-[var(--c-border)] font-bold text-xs text-yellow-900 flex-shrink-0">⚠️ Has out-of-stock items — check before starting</div>` : ''}
      ${capWarnHTML}
      ${batchHTML}
      ${canceledPromptHTML}

      <!-- CUSTOMER INFO -->
      <div class="px-4 py-2.5 border-b border-[var(--c-border)] bg-linen/30 flex-shrink-0">
        <div class="flex justify-between items-center">
          <p class="text-sm font-semibold">${order.customer}</p>
          ${order.notes ? `<p class="text-xs italic opacity-80">"${order.notes}"</p>` : ''}
        </div>
      </div>

      <!-- MAIN CONTENT -->
      <main class="flex-grow overflow-y-auto">
        ${itemSectionsHTML}
      </main>

      <!-- FOOTER ACTIONS -->
      <footer class="border-t border-[var(--c-border)] flex divide-x divide-[var(--c-border)] bg-linen h-12 flex-shrink-0">
        <button class="flex-[3] flex items-center justify-center bg-oxblood text-vellum hover:bg-oxblood/90 text-xs font-bold uppercase tracking-widest kds-interactive border-0" data-accept="${order.id}">
          ✓ Start This Order
        </button>
        <button class="flex-[2] flex items-center justify-center text-oxblood hover:bg-oxblood/10 text-xs font-bold uppercase tracking-widest kds-interactive border-0 bg-transparent" data-open-reject="${order.id}">
          ✕ Turn Away
        </button>
      </footer>
    `;

    if (card.dataset.structuralHtml !== structuralHtml) {
      card.innerHTML = structuralHtml;
      card.dataset.structuralHtml = structuralHtml;
    }

    // Direct leaf node text update (no innerHTML rebuilds)
    const autoCancelEl = card.querySelector('.kds-timer-autocancel');
    if (autoCancelEl) {
      autoCancelEl.textContent = `Accept in ${fmtMSS(secs)}`;
    }

    list.appendChild(card);
  });
}

// ── Col 2: Active/cooking orders ──
function renderActiveOrders() {
  const now = Date.now();
  const activeOrders = Object.values(state.orders)
    .filter(o => ['active','packed'].includes(o.status))
    .sort((a, b) => a.slaSecsRemaining - b.slaSecsRemaining);

  const grid  = document.getElementById('active-grid');
  const empty = document.getElementById('active-empty');

  empty.style.display = activeOrders.length === 0 ? 'flex' : 'none';

  // 1. Remove cards that are no longer in activeOrders
  const existingCards = grid.querySelectorAll('.active-card');
  existingCards.forEach(card => {
    const orderId = card.dataset.orderId;
    if (!activeOrders.some(o => o.id === orderId)) {
      card.remove();
    }
  });

  // 2. Add or update cards
  activeOrders.forEach(order => {
    const slaClass = order.slaSecsRemaining < 0 ? 'breach'
                   : order.slaSecsRemaining <= CFG.SLA_WARN_SECS ? 'warn' : '';

    const isUrgent = order.slaSecsRemaining <= CFG.SLA_WARN_SECS;
    const doneCount = order.items.filter(i => i.state === 'Ready').length;
    const total     = order.items.length;
    const allReady   = doneCount === total;

    const cardClass = ['active-card', 'kds-interactive',
      slaClass === 'breach' ? 'sla-breach kds-sla-breached' : slaClass === 'warn' ? 'at-risk' : '',
      order.status === 'packed' ? 'packing' : '',
      order.status === 'active' && allReady ? 'ready-to-pack' : '',
      isUrgent ? 'kds-sla-urgent' : '',
    ].filter(Boolean).join(' ');

    const elapsed  = fmtMSS(order.elapsedPrepSimSecs || 0);
    const slaLabel = fmtMSS(Math.floor(order.slaSecsRemaining));

    let card = grid.querySelector(`.active-card[data-order-id="${order.id}"]`);

    if (card && card.classList.contains('kds-ticket-exit')) return;

    const wrapperClassBase = `active-card ${cardClass} w-full max-w-[420px] bg-vellum border border-[var(--c-border)] rounded-custom overflow-hidden flex flex-col text-[var(--c-ink)] shadow-lg`;

    if (!card) {
      card = document.createElement('article');
      card.className = `${wrapperClassBase} kds-ticket-entry`;
      card.dataset.orderId = order.id;
      grid.appendChild(card);
    } else {
      card.className = wrapperClassBase;
    }

    // ── Build Canceled stock prompts inside active card ──
    let canceledPromptHTML = '';
    if (order.status === 'active') {
      const canceledMatches = getCanceledMatchesForOrder(order);
      canceledMatches.forEach(match => {
        const item = order.items.find(i => i.name === match.name);
        if (item && item.state !== 'Ready') {
          canceledPromptHTML += `
            <div class="active-fulfill-prompt flex items-center justify-center gap-1.5 px-3 py-1.5 bg-yellow-50/70 border border-dashed border-oxblood rounded-custom text-[10px] font-bold text-oxblood kds-interactive" data-active-fulfill="${order.id}|${item.id}|${match.matchId}|${item.name}" title="Click to fulfill from canceled stock immediately">
              ↺ Fulfill ${item.name} from Canceled Stock? (Made ${match.ageMins}m ago)
            </div>
          `;
        }
      });
    }

    // Group items by station
    const itemsByStation = {};
    order.items.forEach(item => {
      const stn = item.station;
      if (!itemsByStation[stn]) {
        itemsByStation[stn] = [];
      }
      itemsByStation[stn].push(item);
    });

    let itemSectionsHTML = '';
    if (order.status !== 'packed') {
      Object.entries(itemsByStation).forEach(([station, stationItems]) => {
        const stationItemsHTML = stationItems.map(item => {
          let rightContent = '';
          let rowExtra     = '';

          const isOverloaded = (state.stationLoads[station] || 0) >= 90;

          if (item.state === 'Queued') {
            rowExtra = ' state-ready-to-start bg-yellow-50/50';
            rightContent = `
              <div class="queue-item-actions flex items-center gap-1.5" style="margin-left:auto;">
                <button class="px-2 py-1 border border-oxblood rounded-custom text-[10px] font-bold uppercase hover:bg-oxblood hover:text-vellum transition-all kds-interactive bg-transparent text-oxblood" data-prepare="${order.id}|${item.id}">Prep</button>
                <button class="px-2 py-1 border border-oxblood rounded-custom text-[10px] font-bold uppercase hover:bg-oxblood hover:text-vellum transition-all kds-interactive bg-transparent text-oxblood ${isOverloaded ? 'suggest-hold' : ''}" data-hold="${order.id}|${item.id}">Hold</button>
              </div>
            `;
          } else if (item.state === 'Hold') {
            rowExtra     = ' state-hold opacity-70';
            rightContent = `
              <div class="queue-item-actions flex items-center gap-1.5" style="margin-left:auto;">
                <span class="text-[9px] font-bold opacity-50 uppercase mr-1">[ On Hold ]</span>
                <button class="px-2 py-1 border border-oxblood rounded-custom text-[10px] font-bold uppercase hover:bg-oxblood hover:text-vellum transition-all kds-interactive bg-transparent text-oxblood" data-prepare="${order.id}|${item.id}">Prep</button>
              </div>
            `;
          } else if (item.state === 'Cooking') {
            rowExtra       = ' state-cooking';
            rightContent   = `
              <div class="text-right flex-shrink-0">
                <div class="text-[9px] font-bold opacity-50 uppercase mb-0.5">Cooking</div>
                <div class="font-mono text-xs font-bold kds-timer-item-cooking text-[var(--c-ink)]" data-item-id="${item.id}"></div>
              </div>
            `;
          } else if (item.state === 'Ready') {
            rowExtra       = ' state-done';
            rightContent   = `<span class="text-xs font-bold text-green-700 flex-shrink-0">✓ Done</span>`;
          }

          const cbChecked = item.state === 'Ready' ? 'checked' : '';
          const modifierHTML = getItemModifierHTML(item);

          return `
            <article class="p-3 flex items-start justify-between border-b border-[var(--c-border)]/10 last:border-b-0 item-row${rowExtra}"
              data-order-id="${order.id}" data-item-id="${item.id}"
              role="button" tabindex="0"
              aria-label="${item.qty}× ${item.name} — ${item.state}"
              style="cursor: pointer;">
              <div class="flex items-start gap-2.5 flex-grow mr-2">
                <input class="mt-0.5 w-4 h-4 border-[var(--c-border)] rounded-sm text-oxblood focus:ring-oxblood bg-transparent kds-item-cb" type="checkbox" ${cbChecked} aria-hidden="true" style="pointer-events: none;" />
                <div class="min-w-0">
                  <p class="text-[10px] font-bold opacity-60">${item.qty}×</p>
                  <h3 class="text-sm font-bold leading-tight ${item.state === 'Ready' ? 'line-through opacity-50' : ''} item-name text-[var(--c-ink)]">${item.name}</h3>
                  ${modifierHTML}
                </div>
              </div>
              ${rightContent}
            </article>
          `;
        }).join('');

        itemSectionsHTML += `
          <section class="border-b border-[var(--c-border)] last:border-b-0">
            <div class="bg-linen px-4 py-1 border-b border-[var(--c-border)]/20">
              <span class="station-label font-bold uppercase text-oxblood">${station} Station</span>
            </div>
            ${stationItemsHTML}
          </section>
        `;
      });
    }

    // ── Bottom CTA & Progress Bar ──
    let ctaHTML = '';
    if (order.status === 'packed') {
      const rider   = state.riders.find(r => r.orderId === order.id);
      const canGive = rider && rider.status === 'arrived';
      const riderMsg = rider
        ? (rider.status === 'arrived' ? `Rider ${rider.name} is HERE` : `Rider on the way — ${fmtMSS(rider.eta)} left`)
        : 'Waiting for rider';

      let callRiderBtn = '';
      if (rider && rider.status !== 'arrived' && order.slaSecsRemaining < 180) {
        callRiderBtn = `<button class="w-full py-1.5 border border-oxblood text-oxblood hover:bg-oxblood hover:text-vellum text-[10px] font-bold uppercase tracking-wider rounded-custom kds-interactive bg-transparent" data-call-rider="${order.id}">Call Rider</button>`;
      }

      ctaHTML = `
        <footer class="border-t border-[var(--c-border)] flex flex-col justify-between bg-linen h-auto p-3 gap-2 flex-shrink-0">
          <div class="text-[10px] font-bold text-center opacity-85 uppercase text-oxblood">
            [ Waiting for Handover ]<br>${riderMsg}
          </div>
          ${callRiderBtn ? `<div class="w-full">${callRiderBtn}</div>` : ''}
          <button class="w-full py-2 bg-oxblood text-vellum hover:bg-oxblood/90 disabled:opacity-40 text-xs font-bold uppercase tracking-widest kds-interactive border-0" data-handover="${order.id}" ${canGive ? '' : 'disabled'}>
            🤝 Give to Rider
          </button>
        </footer>
      `;
    } else {
      if (allReady) {
        ctaHTML = `
          <footer class="border-t border-[var(--c-border)] bg-linen h-12 flex flex-shrink-0">
            <button class="w-full h-full bg-oxblood text-vellum hover:bg-oxblood/90 text-xs font-bold uppercase tracking-widest kds-interactive border-0" data-pack-order="${order.id}">
              📦 Confirm Packed
            </button>
          </footer>
        `;
      } else {
        const percent = (doneCount / total) * 100;
        ctaHTML = `
          <footer class="border-t border-[var(--c-border)] flex divide-x divide-[var(--c-border)] bg-linen h-12 flex-shrink-0">
            <div class="flex-[3] flex items-center px-4">
              <div class="w-full bg-[var(--c-vellum)] h-2 rounded-full overflow-hidden border border-[var(--c-border)]/20">
                <div class="bg-oxblood h-full" style="width: ${percent}%"></div>
              </div>
            </div>
            <div class="flex-[2] flex items-center justify-center">
              <span class="text-[10px] font-bold uppercase tracking-widest text-oxblood">${doneCount} / ${total} READY</span>
            </div>
          </footer>
        `;
      }
    }

    const placedTime = getPlacedTime(order.arrivedAt);
    const platformBadge = getChannelBadge(order.source);

    const structuralHtml = `
      <!-- TOP SECTION -->
      <header class="flex justify-between items-stretch border-b border-[var(--c-border)] flex-shrink-0">
        <!-- Top Left -->
        <div class="p-4 border-r border-[var(--c-border)] flex flex-col justify-between">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-widest opacity-60">Order</span>
            <h1 class="order-num-display text-5xl leading-none text-oxblood">${ordNum(order.id)}</h1>
          </div>
          <div class="mt-4">
            <div class="mb-1">${platformBadge}</div>
            <p class="text-[10px] opacity-80">Placed ${placedTime}</p>
          </div>
        </div>
        <!-- Top Right -->
        <div class="flex-grow flex flex-col">
          <div class="bg-oxblood text-vellum p-4 flex-grow flex flex-col items-end justify-center">
            <span class="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">Time Remaining</span>
            <div class="countdown-display text-4xl"><span class="kds-timer-sla"></span></div>
          </div>
          <div class="p-2 flex justify-end gap-2 bg-linen/50 border-t border-[var(--c-border)]">
            <button class="px-3 py-1 border border-oxblood rounded-custom text-[10px] font-bold uppercase hover:bg-oxblood hover:text-vellum transition-all kds-interactive bg-transparent text-oxblood" data-cancel-order="${order.id}">
              Cancel
            </button>
          </div>
        </div>
      </header>

      <!-- Fulfill Prompts -->
      ${canceledPromptHTML ? `<div class="px-4 py-1.5 border-b border-[var(--c-border)] bg-linen/30 flex-shrink-0">${canceledPromptHTML}</div>` : ''}

      <!-- CUSTOMER INFO -->
      <div class="px-4 py-2.5 border-b border-[var(--c-border)] bg-linen/30 flex-shrink-0">
        <div class="flex justify-between items-center">
          <p class="text-sm font-semibold">${order.customer}</p>
          <div class="flex flex-col items-end">
            ${order.notes ? `<p class="text-xs italic opacity-80">"${order.notes}"</p>` : ''}
            <span class="text-[9px] opacity-60 font-bold">🕐 <span class="kds-timer-elapsed"></span></span>
          </div>
        </div>
      </div>

      <!-- MAIN CONTENT -->
      <main class="flex-grow overflow-y-auto">
        ${itemSectionsHTML}
      </main>

      <!-- FOOTER / ACTION BAR -->
      ${ctaHTML}
    `;

    if (card.dataset.structuralHtml !== structuralHtml) {
      card.innerHTML = structuralHtml;
      card.dataset.structuralHtml = structuralHtml;
    }

    // Direct leaf node text update (no innerHTML rebuilds)
    const slaEl = card.querySelector('.kds-timer-sla');
    if (slaEl) {
      slaEl.textContent = slaLabel;
    }

    const elapsedEl = card.querySelector('.kds-timer-elapsed');
    if (elapsedEl) {
      elapsedEl.textContent = elapsed;
    }

    // Update item-level cooking timers in-place
    if (order.status !== 'packed') {
      order.items.forEach(item => {
        if (item.state === 'Cooking') {
          const itemCookingEl = card.querySelector(`.kds-timer-item-cooking[data-item-id="${item.id}"]`);
          if (itemCookingEl) {
            itemCookingEl.textContent = fmtMSS(item.cookingElapsedSimSecs || 0);
          }
        }
      });
    }

    grid.appendChild(card);
  });
}


// ── Col 3A: Batch groups ──
function renderStationQueues() {
  const body = document.getElementById('queue-body');
  if (!body) return;

  const stations = ['Hot', 'Grill', 'Healthy Bowls'];

  stations.forEach(station => {
    const queuedItems = [];
    Object.values(state.orders).forEach(order => {
      if (order.status === 'active') {
        order.items.forEach(item => {
          if (item.state === 'Queued' && item.station === station) {
            queuedItems.push({ order, item });
          }
        });
      }
    });

    queuedItems.sort((a, b) => a.item.queuePriority - b.item.queuePriority);

    const bulkCandidates = getBulkCandidates(station);
    let bulkHTML = '';
    bulkCandidates.forEach(bulk => {
      bulkHTML += `
        <div class="queue-bulk-header">
          <span class="queue-bulk-title">[ ⌿ Cook Together: ${bulk.totalQty}x ${bulk.name} ]</span>
          <button class="btn-bulk suggest-bulk kds-interactive" data-bulk-name="${bulk.name}" data-station="${station}">Cook Bulk</button>
        </div>
      `;
    });

    const isOverloaded = (state.stationLoads[station] || 0) >= 90;
    let itemsHTML = '';
    if (queuedItems.length === 0) {
      itemsHTML = `<div class="panel-empty">Queue is empty</div>`;
    } else {
      itemsHTML = queuedItems.map(({ order, item }, idx) => {
        let moveUpBtn = '';
        let moveDownBtn = '';

        if (idx > 0) {
          moveUpBtn = `<button class="kds-interactive" data-move-up="${order.id}|${item.id}" style="padding:2px 4px; border:var(--b); border-radius:5px; background:var(--c-linen); font-size:9px; font-weight:700; color:var(--c-ink);" title="Move Up">▲</button>`;
        }
        if (idx < queuedItems.length - 1) {
          moveDownBtn = `<button class="kds-interactive" data-move-down="${order.id}|${item.id}" style="padding:2px 4px; border:var(--b); border-radius:5px; background:var(--c-linen); font-size:9px; font-weight:700; color:var(--c-ink);" title="Move Down">▼</button>`;
        }

        return `
          <div class="queue-item-card kds-interactive" draggable="true"
            data-order-id="${order.id}" data-item-id="${item.id}" data-station="${station}">
            <div class="queue-item-info">
              <div class="queue-item-name" style="font-size:12px; font-weight:700;">${item.qty}× ${item.name}</div>
              <div class="queue-item-meta" style="font-size:9px; font-weight:700; color:var(--c-graphite); margin-top:2px;">[Order ${ordNum(order.id)}] [SLA: <span class="kds-timer-queue-sla" data-order-id="${order.id}"></span>]</div>
            </div>
            <div class="queue-item-actions" style="display:flex; align-items:center; gap:3px;">
              ${moveUpBtn}
              ${moveDownBtn}
              <button class="btn-prepare kds-interactive" data-prepare="${order.id}|${item.id}">Prep</button>
              <button class="btn-hold kds-interactive ${isOverloaded ? 'suggest-hold' : ''}" data-hold="${order.id}|${item.id}">Hold</button>
            </div>
          </div>
        `;
      }).join('');
    }

    const stationSecHTML = `
      <div class="queue-station-title">${station} Station</div>
      ${bulkHTML}
      <div class="queue-list" id="queue-list-${station}">
        ${itemsHTML}
      </div>
    `;

    let stationSec = body.querySelector(`.queue-station-sec[data-station-sec="${station}"]`);
    if (!stationSec) {
      stationSec = document.createElement('div');
      stationSec.className = 'queue-station-sec';
      stationSec.dataset.stationSec = station;
      body.appendChild(stationSec);
    }

    if (stationSec.dataset.structuralHtml !== stationSecHTML) {
      stationSec.innerHTML = stationSecHTML;
      stationSec.dataset.structuralHtml = stationSecHTML;
    }

    // Direct leaf node text update (no innerHTML rebuilds)
    queuedItems.forEach(({ order }) => {
      const slaEl = stationSec.querySelector(`.kds-timer-queue-sla[data-order-id="${order.id}"]`);
      if (slaEl) {
        slaEl.textContent = fmtMSS(order.slaSecsRemaining);
      }
    });
  });
}

// ── Col 3B: Riders ──
function renderRiders() {
  const body  = document.getElementById('riders-body');
  const empty = document.getElementById('riders-empty');

  if (state.riders.length === 0) {
    body.querySelectorAll('.rider-card').forEach(el => el.remove());
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // 1. Remove riders no longer present
  const existingCards = body.querySelectorAll('.rider-card');
  existingCards.forEach(card => {
    const riderId = card.dataset.riderId;
    if (!state.riders.some(r => r.id === riderId)) {
      card.remove();
    }
  });

  // 2. Add or update riders
  state.riders.forEach(rider => {
    const order   = rider.orderId ? state.orders[rider.orderId] : null;
    const matched = order && order.status === 'packed';
    const canHandover = matched && rider.status === 'arrived';

    const statusLine = rider.status === 'arrived'
      ? `<div class="rider-status-line here">🟢 HERE NOW — waiting <span class="kds-timer-rider-wait" data-rider-id="${rider.id}"></span></div>`
      : `<div class="rider-status-line">🚴 On the way — <span class="kds-timer-rider-eta" data-rider-id="${rider.id}"></span> away</div>`;

    const detailsHTML = `${rider.orderId ? `<div><span class="rider-order-tag">Collecting ${ordNum(rider.orderId)}</span></div>` : '<div class="rider-wait">Waiting for order</div>'}
      ${matched ? `
        <button class="btn-handover kds-interactive" data-rider-handover="${rider.id}" ${canHandover?'':'disabled'}
          title="${canHandover ? 'Tap to hand over' : 'Wait for rider to arrive'}">
          ${canHandover ? '✓ Confirm Handover' : '⏳ Rider not here yet'}
        </button>
      ` : ''}`;

    let card = body.querySelector(`.rider-card[data-rider-id="${rider.id}"]`);
    const cardClass = `rider-card kds-interactive ${rider.status}${matched ? ' matched' : ''}`;

    if (!card) {
      card = document.createElement('div');
      card.className = cardClass;
      card.dataset.riderId = rider.id;
      body.insertBefore(card, empty);
    } else {
      card.className = cardClass;
    }

    const htmlContent = `
      <div class="rider-top">
        <span class="rider-name">${rider.name}</span>
        <span class="rider-platform">${rider.platform}</span>
      </div>
      ${statusLine}
      ${detailsHTML}
    `;

    if (card.dataset.structuralHtml !== htmlContent) {
      card.innerHTML = htmlContent;
      card.dataset.structuralHtml = htmlContent;
    }

    // Direct leaf node text update (no innerHTML rebuilds)
    if (rider.status === 'arrived') {
      const waitEl = card.querySelector(`.kds-timer-rider-wait[data-rider-id="${rider.id}"]`);
      if (waitEl) waitEl.textContent = fmtMSS(rider.waitSecs);
    } else {
      const etaEl = card.querySelector(`.kds-timer-rider-eta[data-rider-id="${rider.id}"]`);
      if (etaEl) etaEl.textContent = fmtMSS(rider.eta);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// 18. EVENT DELEGATION
// ══════════════════════════════════════════════════════════════

// Col 1 — new orders
document.getElementById('new-list').addEventListener('click', e => {
  // Accept order
  const accept = e.target.closest('[data-accept]');
  if (accept) { acceptOrder(accept.dataset.accept); return; }

  // Open the rejection reason modal
  const openReject = e.target.closest('[data-open-reject]');
  if (openReject) { openRejectOverlay(openReject.dataset.openReject); return; }
});

// Centered Rejection modal click listeners
const rejectModal = document.getElementById('reject-modal');
if (rejectModal) {
  rejectModal.addEventListener('click', e => {
    // Scrim click closes modal
    if (e.target === rejectModal) {
      closeRejectOverlay();
      return;
    }

    // Close button
    const closeBtn = e.target.closest('#reject-close');
    if (closeBtn) { closeRejectOverlay(); return; }

    // Back / cancel button
    const backBtn = e.target.closest('#reject-back');
    if (backBtn) { closeRejectOverlay(); return; }

    // Select reason
    const reasonItem = e.target.closest('[data-reason]');
    if (reasonItem) { selectRejectReason(reasonItem.dataset.reason); return; }

    // Confirm button
    const confirmBtn = e.target.closest('#reject-confirm');
    if (confirmBtn) { finalizeReject(state.rejectingOrderId); return; }
  });
}

// Keyboard support on new ticket cards
document.getElementById('new-list').addEventListener('keydown', e => {
  const card       = e.target.closest('.new-ticket');

  // On a focused ticket card:
  // Enter  → accept the order
  // Escape → open the rejection modal
  if (card && !state.rejectingOrderId) {
    const orderId = card.dataset.orderId;
    if (e.key === 'Enter')  { e.preventDefault(); acceptOrder(orderId); return; }
    if (e.key === 'Escape') { e.preventDefault(); openRejectOverlay(orderId); return; }
  }
});

// Col 2 — active orders
document.getElementById('active-grid').addEventListener('click', e => {
  const prepareBtn = e.target.closest('[data-prepare]');
  if (prepareBtn) {
    const [oId, iId] = prepareBtn.dataset.prepare.split('|');
    startItemManual(oId, iId);
    return;
  }

  const holdBtn = e.target.closest('[data-hold]');
  if (holdBtn) {
    const [oId, iId] = holdBtn.dataset.hold.split('|');
    holdItemManual(oId, iId);
    return;
  }

  const activeFulfill = e.target.closest('[data-active-fulfill]');
  if (activeFulfill) {
    const [oId, itemId, matchId, itemName] = activeFulfill.dataset.activeFulfill.split('|');
    consumeCanceledStock(matchId, oId, itemName);
    return;
  }

  const packOrderBtn = e.target.closest('[data-pack-order]');
  if (packOrderBtn) {
    packOrder(packOrderBtn.dataset.packOrder);
    return;
  }

  const callRiderBtn = e.target.closest('[data-call-rider]');
  if (callRiderBtn) {
    callRider(callRiderBtn.dataset.callRider);
    return;
  }

  const cancelBtn = e.target.closest('[data-cancel-order]');
  if (cancelBtn) {
    cancelOrder(cancelBtn.dataset.cancelOrder);
    return;
  }

  const handBtn = e.target.closest('[data-handover]');
  if (handBtn) {
    confirmHandover(handBtn.dataset.handover);
    return;
  }

  // Item checkbox toggle
  const row = e.target.closest('.item-row');
  if (row && !e.target.closest('button')) {
    const { orderId, itemId } = row.dataset;
    const order = state.orders[orderId];
    const item  = order?.items.find(i => i.id === itemId);
    if (item) {
      if (item.state === 'Queued' || item.state === 'Hold') {
        startItemManual(orderId, itemId);
      } else if (item.state === 'Cooking' || item.state === 'Ready') {
        markItemReady(orderId, itemId);
      }
    }
  }
});

// Col 3A — Station Queues click and drag-and-drop
const queueBody = document.getElementById('queue-body');
if (queueBody) {
  queueBody.addEventListener('click', e => {
    const prepBtn = e.target.closest('[data-prepare]');
    if (prepBtn) {
      const [orderId, itemId] = prepBtn.dataset.prepare.split('|');
      startItemManual(orderId, itemId);
      return;
    }

    const holdBtn = e.target.closest('[data-hold]');
    if (holdBtn) {
      const [orderId, itemId] = holdBtn.dataset.hold.split('|');
      holdItemManual(orderId, itemId);
      return;
    }

    const moveUp = e.target.closest('[data-move-up]');
    if (moveUp) {
      const [orderId, itemId] = moveUp.dataset.moveUp.split('|');
      moveQueueItem(orderId, itemId, 'up');
      return;
    }

    const moveDown = e.target.closest('[data-move-down]');
    if (moveDown) {
      const [orderId, itemId] = moveDown.dataset.moveDown.split('|');
      moveQueueItem(orderId, itemId, 'down');
      return;
    }

    const bulkBtn = e.target.closest('[data-bulk-name]');
    if (bulkBtn) {
      const name = bulkBtn.dataset.bulkName;
      const station = bulkBtn.dataset.station;
      prepareInBulk(name, station);
      return;
    }
  });

  queueBody.addEventListener('dragstart', e => {
    const card = e.target.closest('.queue-item-card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({
      orderId: card.dataset.orderId,
      itemId: card.dataset.itemId,
      station: card.dataset.station
    }));
    card.classList.add('dragging');
  });

  queueBody.addEventListener('dragend', e => {
    const card = e.target.closest('.queue-item-card');
    if (card) {
      card.classList.remove('dragging');
    }
    document.querySelectorAll('.queue-item-card').forEach(el => el.classList.remove('drag-over'));
  });

  queueBody.addEventListener('dragover', e => {
    const card = e.target.closest('.queue-item-card');
    if (!card) return;
    e.preventDefault();
    const draggingCard = document.querySelector('.queue-item-card.dragging');
    if (draggingCard && draggingCard.dataset.station === card.dataset.station) {
      card.classList.add('drag-over');
    }
  });

  queueBody.addEventListener('dragleave', e => {
    const card = e.target.closest('.queue-item-card');
    if (card) {
      card.classList.remove('drag-over');
    }
  });

  queueBody.addEventListener('drop', e => {
    const card = e.target.closest('.queue-item-card');
    if (!card) return;
    e.preventDefault();
    card.classList.remove('drag-over');

    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.station === card.dataset.station) {
        reorderQueueItems(
          data.orderId,
          data.itemId,
          card.dataset.orderId,
          card.dataset.itemId,
          data.station
        );
      }
    } catch (err) {}
  });
}

// Col 3B — rider handover
document.getElementById('riders-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-rider-handover]');
  if (!btn) return;
  const rider = state.riders.find(r => r.id === btn.dataset.riderHandover);
  if (rider?.orderId) confirmHandover(rider.orderId);
});

// Keyboard support on item rows (Col 2)
[document.getElementById('active-grid')].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const row = e.target.closest('.item-row');
      if (row) { e.preventDefault(); row.click(); }
    }
  });
});

// Hover Highlight: Active Card to Queue Card
const activeGridEl = document.getElementById('active-grid');
if (activeGridEl) {
  activeGridEl.addEventListener('mouseover', e => {
    const card = e.target.closest('.active-card');
    if (!card) return;
    const orderId = card.dataset.orderId;
    if (!orderId) return;

    // Highlight matching queued items in Col 3A
    const matchingQueueCards = document.querySelectorAll(`.queue-item-card[data-order-id="${orderId}"]`);
    matchingQueueCards.forEach(qc => {
      qc.classList.add('kds-linked-highlight');
    });
  });

  activeGridEl.addEventListener('mouseout', e => {
    const card = e.target.closest('.active-card');
    if (!card) return;
    const orderId = card.dataset.orderId;
    if (!orderId) return;

    // Remove highlight
    const matchingQueueCards = document.querySelectorAll(`.queue-item-card[data-order-id="${orderId}"]`);
    matchingQueueCards.forEach(qc => {
      qc.classList.remove('kds-linked-highlight');
    });
  });
}


// ══════════════════════════════════════════════════════════════
// 19. UNDO KEYBOARD
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-undo').addEventListener('click', executeUndo);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); executeUndo(); }
  if (e.key === 'Escape') {
    const rejectModal = document.getElementById('reject-modal');
    if (rejectModal && rejectModal.classList.contains('open')) {
      e.preventDefault();
      closeRejectOverlay();
    } else {
      document.querySelectorAll('.modal-ov.open').forEach(m => m.classList.remove('open'));
    }
  }
});

// ══════════════════════════════════════════════════════════════
// 20. OPEN / CLOSE ORDERS & AUTO-ACCEPT
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-open').addEventListener('click', () => setOpen(true));
document.getElementById('btn-close').addEventListener('click', () => setOpen(false));
document.getElementById('btn-reopen').addEventListener('click', () => setOpen(true));

function setOpen(open) {
  state.isOpen = open;
  document.getElementById('btn-open').className  = 'oc-btn' + (open  ? ' active-open'  : '');
  document.getElementById('btn-close').className = 'oc-btn' + (!open ? ' active-close' : '');
  renderBanners();
}

document.getElementById('btn-auto-accept-on').addEventListener('click', () => setAutoAccept(true));
document.getElementById('btn-auto-accept-off').addEventListener('click', () => setAutoAccept(false));

function setAutoAccept(on) {
  state.autoAccept = on;
  document.getElementById('btn-auto-accept-on').className = 'oc-btn' + (on ? ' active-open' : '');
  document.getElementById('btn-auto-accept-on').setAttribute('aria-pressed', String(on));
  document.getElementById('btn-auto-accept-off').className = 'oc-btn' + (!on ? ' active-close' : '');
  document.getElementById('btn-auto-accept-off').setAttribute('aria-pressed', String(!on));
  
  // When auto-accept is toggled ON, accept all currently 'new' orders immediately
  if (on) {
    Object.keys(state.orders).forEach(orderId => {
      if (state.orders[orderId].status === 'new') {
        acceptOrderImmediately(orderId);
      }
    });
  }
  render();
}

// ══════════════════════════════════════════════════════════════
// 21. SOUND TOGGLE
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-sound').addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('kds-sound', state.soundEnabled);
  const btn = document.getElementById('btn-sound');
  btn.textContent = state.soundEnabled ? '🔔' : '🔕';
  btn.title       = state.soundEnabled ? 'Turn alert sounds off' : 'Turn alert sounds on';
  btn.setAttribute('aria-label', state.soundEnabled ? 'Sound alerts on' : 'Sound alerts off');
  btn.classList.toggle('active', state.soundEnabled);
  if (state.soundEnabled) playSound('newOrder'); // preview
});

// ══════════════════════════════════════════════════════════════
// 22. DARK / LIGHT MODE
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-theme').addEventListener('click', () => {
  state.darkMode = !state.darkMode;
  localStorage.setItem('kds-dark', state.darkMode);
  document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
  const btn = document.getElementById('btn-theme');
  btn.textContent = state.darkMode ? '☀️' : '🌙';
  btn.title       = state.darkMode ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label', state.darkMode ? 'Switch to light mode' : 'Switch to dark mode');
});

// ══════════════════════════════════════════════════════════════
// 23. PAUSE APPS MODAL
// ══════════════════════════════════════════════════════════════
const pauseModal = document.getElementById('pause-modal');
document.getElementById('btn-pause').addEventListener('click', () => pauseModal.classList.add('open'));
document.getElementById('pause-close').addEventListener('click', () => pauseModal.classList.remove('open'));
document.getElementById('pause-back').addEventListener('click', () => pauseModal.classList.remove('open'));
document.getElementById('pause-apply').addEventListener('click', () => {
  const selectedDurBtn = document.querySelector('#dur-row .dur-btn.sel');
  const mins = selectedDurBtn ? parseInt(selectedDurBtn.dataset.min, 10) : 0;
  
  if (mins === 0) {
    // Resume All
    state.pausedChannels = { Swiggy: false, Zomato: false, DirectApp: false };
    state.pausedBrand = 'All Brands';
    state.pausedUntil = null;
    document.querySelectorAll('.plat-row').forEach(row => {
      row.classList.remove('checked');
      row.setAttribute('aria-checked', 'false');
      const infoEl = row.querySelector('.plat-sub');
      if (infoEl) infoEl.textContent = 'Currently taking orders';
    });
  } else {
    // Pause selected
    const rows = document.querySelectorAll('.plat-row');
    let anyPaused = false;
    rows.forEach(row => {
      const plat = row.dataset.plat; // swiggy | zomato | ownapp
      const checked = row.classList.contains('checked');
      const channel = plat === 'swiggy' ? 'Swiggy' : plat === 'zomato' ? 'Zomato' : 'DirectApp';
      state.pausedChannels[channel] = checked;
      
      const infoEl = row.querySelector('.plat-sub');
      if (infoEl) {
        infoEl.textContent = checked ? `Paused for ${mins} mins` : 'Currently taking orders';
      }
      if (checked) anyPaused = true;
    });
    
    const brandSelect = document.getElementById('pause-brand-select');
    state.pausedBrand = brandSelect ? brandSelect.value : 'All Brands';
    
    if (anyPaused) {
      state.pausedUntil = (state.currentSimSecs || 0) + (mins * 60);
    } else {
      state.pausedUntil = null;
      state.pausedBrand = 'All Brands';
    }
  }
  
  pauseModal.classList.remove('open');
  render();
});
pauseModal.addEventListener('click', e => { if (e.target === pauseModal) pauseModal.classList.remove('open'); });

document.getElementById('platform-list').addEventListener('click', e => {
  const row = e.target.closest('.plat-row');
  if (!row) return;
  const checked = row.classList.toggle('checked');
  row.setAttribute('aria-checked', String(checked));
});
document.getElementById('platform-list').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.closest('.plat-row')?.click(); }
});
document.getElementById('dur-row').addEventListener('click', e => {
  const btn = e.target.closest('.dur-btn');
  if (!btn) return;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
});

// ══════════════════════════════════════════════════════════════
// 24. MENU / OUT-OF-STOCK MODAL
// ══════════════════════════════════════════════════════════════
let selectedBrand = 'Hot';
const menuModal   = document.getElementById('menu-modal');

function renderMenuItems() {
  const list = document.getElementById('menu-item-list');
  let html = '';
  let count = 1;
  Object.entries(BRANDS).forEach(([brand, data]) => {
    data.items.forEach(item => {
      const isOos = !!state.oosItems[item.name];
      html += `
        <div class="menu-item-row" style="display:flex; align-items:center; padding:10px 0; border-bottom:1px dashed rgba(55,8,8,0.18); gap:6px;">
          <span class="mi-num" style="font-size: 11px; font-weight: 700; color: var(--c-graphite); width: 18px; flex-shrink: 0; text-align: right;">${count++}.</span>
          <span class="mi-name" style="font-size: 14px; font-weight: 700; color: var(--c-ink); flex: 1;">${item.name}</span>
          <span class="mi-dots" style="flex: 1; height: 0; border-bottom: 1.5px dotted rgba(77,75,71,0.3); margin: 0 8px; align-self: flex-end; margin-bottom: 5px;" aria-hidden="true"></span>
          <button class="kds-oos-toggle kds-interactive ${isOos ? 'off' : 'on'}" data-item-name="${item.name}" aria-pressed="${isOos ? 'false' : 'true'}">
            ${isOos ? 'OFF' : 'ON'}
          </button>
        </div>
      `;
    });
  });
  list.innerHTML = html;
}

document.getElementById('btn-menu').addEventListener('click', () => {
  renderMenuItems();
  menuModal.classList.add('open');
});
document.getElementById('menu-close').addEventListener('click', () => menuModal.classList.remove('open'));
document.getElementById('menu-back').addEventListener('click',  () => menuModal.classList.remove('open'));
document.getElementById('menu-save').addEventListener('click',  () => menuModal.classList.remove('open'));
menuModal.addEventListener('click', e => { if (e.target === menuModal) menuModal.classList.remove('open'); });

document.getElementById('brand-select').addEventListener('change', e => {
  selectedBrand = e.target.value;
  renderMenuItems();
});

document.getElementById('menu-item-list').addEventListener('click', e => {
  const toggleBtn = e.target.closest('.kds-oos-toggle');
  if (!toggleBtn) return;
  const name = toggleBtn.dataset.itemName;
  state.oosItems[name] = !state.oosItems[name];
  renderMenuItems();
  render(); // refresh OOS warnings on tickets
});

// ══════════════════════════════════════════════════════════════
// 25. MANUAL NEW ORDER MODAL
// ══════════════════════════════════════════════════════════════
const newOrderModal = document.getElementById('new-order-modal');
let noSelectedBrand = 'Hot';

const noItemQtys    = {}; // itemName → qty

function renderNoItems(brand) {
  const data = BRANDS[brand];
  if (!data) return;
  const grid = document.getElementById('no-items-grid');
  Object.keys(noItemQtys).forEach(k => delete noItemQtys[k]);

  grid.innerHTML = data.items.map(item => `
    <div class="no-item-row" data-no-item="${item.name}">
      <span class="no-item-name">${item.name}</span>
      <input class="no-item-qty" type="number" min="0" max="20" value="0"
        data-no-qty="${item.name}" aria-label="Quantity of ${item.name}" />
    </div>
  `).join('');
}

document.getElementById('btn-new-order').addEventListener('click', () => {
  noSelectedBrand = 'Hot';
  document.getElementById('no-brand').value = noSelectedBrand;
  document.getElementById('no-customer').value = '';
  document.getElementById('no-notes').value    = '';
  renderNoItems(noSelectedBrand);
  newOrderModal.classList.add('open');
});

document.getElementById('no-close').addEventListener('click',  () => newOrderModal.classList.remove('open'));
document.getElementById('no-cancel').addEventListener('click', () => newOrderModal.classList.remove('open'));
newOrderModal.addEventListener('click', e => { if (e.target === newOrderModal) newOrderModal.classList.remove('open'); });

document.getElementById('no-brand').addEventListener('change', e => {
  noSelectedBrand = e.target.value;
  renderNoItems(noSelectedBrand);
});

document.getElementById('no-submit').addEventListener('click', () => {
  const customer = document.getElementById('no-customer').value.trim() || 'Walk-in';
  const platform = document.getElementById('no-platform').value;
  const notes    = document.getElementById('no-notes').value.trim();

  // Collect selected items
  const qtyInputs = document.querySelectorAll('[data-no-qty]');
  const items     = [];
  qtyInputs.forEach(inp => {
    const qty = parseInt(inp.value, 10) || 0;
    if (qty > 0) items.push(makeItem(inp.dataset.noQty, qty));
  });

  if (items.length === 0) {
    alert('Please add at least one item!');
    return;
  }

  const id = nextOrderId();
  const order = makeOrder({ id, brand: noSelectedBrand, source: platform, customer, items, notes });
  state.orders[id] = order;

  playSound('newOrder');
  newOrderModal.classList.remove('open');
  render();
});

// ══════════════════════════════════════════════════════════════
// 26. ANALYTICS MODAL
// ══════════════════════════════════════════════════════════════
document.getElementById('analytics-close').addEventListener('click', () => document.getElementById('analytics-modal').classList.remove('open'));
document.getElementById('analytics-done').addEventListener('click', () => document.getElementById('analytics-modal').classList.remove('open'));
document.getElementById('analytics-modal').addEventListener('click', e => { if (e.target === document.getElementById('analytics-modal')) document.getElementById('analytics-modal').classList.remove('open'); });

// ══════════════════════════════════════════════════════════════
// 27. CLOCK
// ══════════════════════════════════════════════════════════════
function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
}
setInterval(updateClock, 1000);
updateClock();

// ══════════════════════════════════════════════════════════════
// 28. INIT
// ══════════════════════════════════════════════════════════════
setOpen(false);
setAutoAccept(state.autoAccept);

// Set sound button initial state
const soundBtn = document.getElementById('btn-sound');
soundBtn.textContent = state.soundEnabled ? '🔔' : '🔕';
soundBtn.classList.toggle('active', state.soundEnabled);

// Set theme button initial state
const themeBtn = document.getElementById('btn-theme');
themeBtn.textContent = state.darkMode ? '☀️' : '🌙';
themeBtn.title       = state.darkMode ? 'Switch to light mode' : 'Switch to dark mode';

render();
