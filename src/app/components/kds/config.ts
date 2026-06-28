import type { KDSItem, KDSOrder } from './types';

export const CFG = {
  AUTO_CANCEL_SECS:      150,
  SLA_MINUTES:           15,
  MAX_STATION_ITEMS:     8,
  THROTTLE_TRIGGER_SECS: 10,
  UNDO_WINDOW_MS:        6000,
  ANALYTICS_MIN_ORDERS:  3,
  SLA_WARN_SECS:         120,
  COLD_ORDER_SECS:       15,
  RUSH_SESSION_SECS:     300, // 5 minutes rush session
} as const;

export const BRANDS: Record<string, {
  station: string;
  color: string;
  items: Array<{ name: string; prepSecs: number }>;
}> = {
  'Burger Craft': {
    station: 'Hot',
    color: '#8b1a1a',
    items: [
      { name: 'Classic Cheese Burger',       prepSecs: 14 },
      { name: 'Chicken Double Patty Burger', prepSecs: 16 },
      { name: 'Veg Patty Burger',            prepSecs: 12 },
      { name: 'Paneer Fresh Burger',         prepSecs: 14 },
      { name: 'BBQ Bacon Smash Burger',       prepSecs: 16 },
      { name: 'Spicy Jalapeño Crispy Chicken',prepSecs: 15 },
      { name: 'Truffle Mushroom Swiss Burger',prepSecs: 16 },
      { name: 'Fiery Crispy Paneer Burger',   prepSecs: 14 },
      { name: 'Double Stack Cheeseburger',   prepSecs: 16 },
      { name: 'Mini Sliders Trio',           prepSecs: 12 },
    ],
  },
  'Grill House': {
    station: 'Grill',
    color: '#2d5a2d',
    items: [
      { name: 'Classic French Fries',        prepSecs: 10 },
      { name: 'Peri Peri Crinkle Fries',     prepSecs: 12 },
      { name: 'Loaded Cheese Fries',         prepSecs: 14 },
      { name: 'Grilled Chicken Wings (6pcs)',prepSecs: 14 },
      { name: 'Smoky BBQ Chicken Skewers',   prepSecs: 15 },
      { name: 'Grilled Paneer Tikka Bites',  prepSecs: 12 },
      { name: 'Garlic Herb Grilled Chicken', prepSecs: 16 },
      { name: 'Crispy Golden Onion Rings',   prepSecs: 10 },
      { name: 'Cheesy Loaded Potato Wedges', prepSecs: 12 },
      { name: 'Grilled Lamb Seekh Kebab',    prepSecs: 16 },
    ],
  },
  'Bowl & Salad Co.': {
    station: 'Assembly',
    color: '#1a4a6b',
    items: [
      { name: 'Brioche Burger Buns',        prepSecs: 8 },
      { name: 'Extra Spicy Mayo Modifier',  prepSecs: 6 },
      { name: 'Garlic Dip Portion',         prepSecs: 6 },
      { name: 'Greek Mediterranean Salad',  prepSecs: 10 },
      { name: 'Teriyaki Chicken Protein Bowl',prepSecs:12 },
      { name: 'Mexican Burrito Power Bowl', prepSecs: 12 },
      { name: 'Chipotle Paneer Super Bowl', prepSecs: 10 },
      { name: 'Asian Sesame Tofu Bowl',     prepSecs: 10 },
      { name: 'Classic Caesar Salad Bowl',  prepSecs: 8 },
      { name: 'Creamy Ranch Dip Portion',   prepSecs: 6 },
    ],
  },
};

export const ITEM_STATION: Record<string, string> = {};
export const ITEM_PREP:    Record<string, number> = {};
export const ITEM_BRAND:   Record<string, string> = {};

Object.entries(BRANDS).forEach(([brand, data]) => {
  data.items.forEach(i => {
    ITEM_STATION[i.name] = data.station;
    ITEM_PREP[i.name]    = i.prepSecs;
    ITEM_BRAND[i.name]   = brand;
  });
});

export const REJECTION_REASONS = [
  'Item Out of Stock',
  'Station Overloaded',
  'Kitchen Closing',
  'Other / Operational Issue',
] as const;

export const STATIONS = ['Hot', 'Grill', 'Assembly'] as const;

export const CUSTOMERS = [
  'Rahul S.', 'Ananya G.', 'Vikram K.', 'Neha M.', 'Rohan P.',
  'Aditi V.', 'Kabir D.', 'Ishaan B.', 'Pooja R.', 'Siddharth M.',
];

export const NOTES_POOL = [
  'Extra Spicy please!', 'No onions', 'Sauce on the side', 'Less oil',
  'Make it crispy', 'Double cheese', 'Gluten-free preference',
];

export const RIDER_NAMES = [
  'Rajan K.', 'Priya S.', 'Arjun M.', 'Sundar D.',
  'Meena P.', 'Vikram J.', 'Anita R.', 'Deepak L.',
];

const COLORS = ['Blue', 'Red', 'Green', 'Yellow', 'Orange'];

let _idCounter = 0;
export function makeId() { return `item-${Date.now()}-${++_idCounter}`; }

let _nameIdx = 0;
export function pickRiderName()  { return RIDER_NAMES[_nameIdx++ % RIDER_NAMES.length]; }
export function randomColor()    { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
export function pickCustomer()   { return CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)]; }
export function pickNote()       { return NOTES_POOL[Math.floor(Math.random() * NOTES_POOL.length)]; }

export function makeItem(name: string, qty: number, modifier = ''): KDSItem {
  return {
    id:                    makeId(),
    name,
    qty,
    station:               ITEM_STATION[name] || 'Hot',
    prepSecs:              ITEM_PREP[name]    || 14,
    state:                 'Queued',
    cookingElapsedSimSecs: 0,
    queuePriority:         Date.now() + Math.random(),
    modifier,
  };
}

export function makeOrder(params: {
  id: string; brand: string; source: string; customer: string;
  items: KDSItem[]; notes?: string;
}): KDSOrder {
  return {
    id:                 params.id,
    brand:              params.brand,
    source:             params.source,
    customer:           params.customer,
    items:              params.items,
    notes:              params.notes ?? '',
    status:             'new',
    arrivedAt:          Date.now(),
    autoCancelSecs:     CFG.AUTO_CANCEL_SECS,
    acceptedAt:         null,
    packedAt:           null,
    completedAt:        null,
    slaMinutes:         CFG.SLA_MINUTES,
    slaSecsRemaining:   CFG.SLA_MINUTES * 60,
    elapsedPrepSimSecs: 0,
    riderStatus:        'none',
    riderEta:           null,
    riderId:            null,
    riderWaitSecs:      0,
    hasOOS:             false,
  };
}

export function safeStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function safeStorageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sandboxed */ }
}

export function createInitialState(): KDSState {
  return {
    orders:            {},
    rejected:          [],
    completed:         [],
    riders:            [],
    orderCounter:      100,
    soundEnabled:      safeStorage('kds-sound') !== 'false',
    isOpen:            false,
    autoAccept:        false,
    canceledStock:     [],
    currentSimSecs:    0,
    oosItems: {
      'Classic Cheese Burger':       false,
      'Chicken Double Patty Burger': false,
      'Veg Patty Burger':            false,
      'Paneer Fresh Burger':         false,
      'Classic French Fries':        false,
      'Peri Peri Crinkle Fries':     false,
      'Loaded Cheese Fries':         false,
      'Brioche Burger Buns':         false,
      'Extra Spicy Mayo Modifier':   false,
      'Garlic Dip Portion':          false,
    },
    pausedChannels: { Swiggy: false, Zomato: false, DirectApp: false },
    pausedBrands:   { 'All Brands': true },
    pausedUntil:    null,
    rejectingOrderId:  null,
    rejectReason:      null,
    undoEntry:         null,
    undoTimer:         null,
    throttleActive:    false,
    throttleStart:     null,
    stationLoads:      { 'Hot': 0, 'Grill': 0, 'Assembly': 0 },
    slaAlerted:        new Set(),
    completedRush:     0,
    shiftStats: {
      onTimeCount: 0, totalCompleted: 0, velocities: [],
      peakLoad: { 'Hot': 0, 'Grill': 0, 'Assembly': 0 },
      coldLog: 0, rejectedCount: 0,
    },
    showAnalyticsModal:  false,
    analyticsSnapshot:   null,
    firstOrderSent:      false,
    firstOrderCountdown: 0,
    rushStartSimSecs:    0,
  };
}

export function deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }

export function fmtMSS(totalSecs: number): string {
  const abs  = Math.abs(totalSecs);
  const m    = Math.floor(abs / 60);
  const s    = Math.floor(abs % 60);
  const sign = totalSecs < 0 ? '-' : '';
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ordNum(id: string): string {
  return '#' + (String(id).replace(/\D/g, '').replace(/^0+/, '') || id);
}

export function getPlacedTime(arrivedAt: number): string {
  const d = new Date(arrivedAt);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
