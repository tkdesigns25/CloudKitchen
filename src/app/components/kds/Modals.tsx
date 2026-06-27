import React, { useState } from 'react';
import type { KDSOrder, AnalyticsData, KDSItem } from './types';
import { BRANDS, REJECTION_REASONS, makeItem } from './config';
import { OxBtn, GhostBtn } from './KDSApp';

interface PoolItem { name: string; ageMins: number; matchId: string; }

interface ModalsProps {
  showNewOrder: boolean;
  showPause: boolean;
  showMenu: boolean;
  showReject: boolean;
  showAnalytics: boolean;
  showPoolConfirm: boolean;
  poolConfirmItems: PoolItem[];
  rejectReason: string | null;
  analyticsSnapshot: AnalyticsData | null;
  oosItems: Record<string, boolean>;
  rejectingOrderId: string | null;
  orders: Record<string, KDSOrder>;
  onCloseNewOrder: () => void;
  onClosePause: () => void;
  onCloseMenu: () => void;
  onCloseReject: () => void;
  onCloseAnalytics: () => void;
  onClosePoolConfirm: () => void;
  onSelectRejectReason: (r: string) => void;
  onFinalizeReject: () => void;
  onApplyPause: (channels: {Swiggy: boolean; Zomato: boolean; DirectApp: boolean}, brand: string, mins: number) => void;
  onSaveOos: (items: Record<string, boolean>) => void;
  onSubmitManualOrder: (params: { customer: string; platform: string; brand: string; items: KDSItem[]; notes: string }) => boolean;
  onPoolAcceptUseItems: () => void;
  onPoolAcceptCookFresh: () => void;
}

export type { PoolItem, ModalsProps as KDSModalsProps };

export function KDSModals(props: ModalsProps) {
  return (
    <>
      {props.showNewOrder && <NewOrderModal {...props} />}
      {props.showPause    && <PauseModal {...props} />}
      {props.showMenu     && <MenuModal {...props} />}
      {props.showReject   && <RejectModal {...props} />}
      {props.showAnalytics && props.analyticsSnapshot && <AnalyticsModal {...props} data={props.analyticsSnapshot} />}
      {props.showPoolConfirm && props.poolConfirmItems.length > 0 && (
        <PoolItemsModal
          items={props.poolConfirmItems}
          onUseItems={props.onPoolAcceptUseItems}
          onCookFresh={props.onPoolAcceptCookFresh}
          onClose={props.onClosePoolConfirm}
        />
      )}
    </>
  );
}

// ── Modal Shell ────────────────────────────────────────────────
function ModalShell({ children, onClose, width = 480 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ display: 'flex', position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(55,8,8,0.16)', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        className="kds-modal-in"
        style={{ background: 'var(--kds-vellum)', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', overflow: 'hidden', width, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: 'var(--kds-b)', flexShrink: 0 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--kds-ink)', margin: 0 }}>{title}</h2>
      <button
        onClick={onClose}
        style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 'var(--kds-r)', color: 'var(--kds-graphite)', fontSize: 16, cursor: 'pointer' }}
      >✕</button>
    </div>
  );
}

function ModalBody({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {children}
    </div>
  );
}

function ModalFoot({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderTop: 'var(--kds-b)', flexShrink: 0, gap: 10 }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--kds-graphite)', margin: 0 }}>{children}</p>;
}

// ── Reject Modal ───────────────────────────────────────────────
function RejectModal({ rejectReason, onCloseReject, onSelectRejectReason, onFinalizeReject }: ModalsProps) {
  return (
    <ModalShell onClose={onCloseReject} width={480}>
      <ModalHead title="Decline Order" onClose={onCloseReject} />
      <ModalBody>
        <SectionLabel>Select the reason for declining this order:</SectionLabel>
        <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {REJECTION_REASONS.map(reason => {
            const selected = rejectReason === reason;
            return (
              <div
                key={reason}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                className={`kds-reject-row kds-interactive`}
                onClick={() => onSelectRejectReason(reason)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRejectReason(reason); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', border: selected ? '1px solid var(--kds-oxblood)' : 'var(--kds-b)',
                  borderRadius: 'var(--kds-r)', background: selected ? 'var(--kds-vellum)' : 'var(--kds-linen)',
                  cursor: 'pointer', userSelect: 'none',
                }}
              >
                {/* Radio circle */}
                <div
                  className="kds-reject-radio"
                  style={{
                    flexShrink: 0, width: 17, height: 17, borderRadius: 5,
                    border: selected ? '1px solid var(--kds-oxblood)' : 'var(--kds-b)',
                    background: selected ? 'var(--kds-oxblood)' : 'var(--kds-vellum)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {selected && <div style={{ width: 6, height: 6, background: 'var(--kds-vellum)', borderRadius: 1 }} />}
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kds-ink)' }}>{reason}</span>
              </div>
            );
          })}
        </div>
      </ModalBody>
      <ModalFoot>
        <GhostBtn onClick={onCloseReject}>Go Back (Esc)</GhostBtn>
        <OxBtn onClick={onFinalizeReject} disabled={!rejectReason}>Confirm Decline</OxBtn>
      </ModalFoot>
    </ModalShell>
  );
}

// ── Pause Modal ────────────────────────────────────────────────
function PauseModal({ onClosePause, onApplyPause }: ModalsProps) {
  const [channels, setChannels] = useState({ Swiggy: true, Zomato: true, DirectApp: false });
  const [brand, setBrand] = useState('All Brands');
  const [mins, setMins] = useState(15);

  const platRows: Array<{ key: keyof typeof channels; label: string }> = [
    { key: 'Swiggy',    label: 'Swiggy' },
    { key: 'Zomato',    label: 'Zomato' },
    { key: 'DirectApp', label: 'Own App' },
  ];

  const durations = [
    { label: '15 Mins', val: 15 },
    { label: '30 Mins', val: 30 },
    { label: '1 Hour',  val: 60 },
    { label: '2 Hours', val: 120 },
    { label: 'Resume All', val: 0 },
  ];

  return (
    <ModalShell onClose={onClosePause} width={440}>
      <ModalHead title="Stop Incoming Orders" onClose={onClosePause} />
      <ModalBody>
        {/* Brand select */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <SectionLabel>For which brand menu?</SectionLabel>
          <KDSSelect value={brand} onChange={setBrand}>
            <option value="All Brands">All Brands</option>
            {Object.keys(BRANDS).map(b => <option key={b} value={b}>{b}</option>)}
          </KDSSelect>
        </div>

        {/* Platform checkboxes */}
        <div>
          <SectionLabel>Step 1 — Which apps to stop?</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 7 }}>
            {platRows.map(({ key, label }) => {
              const checked = channels[key];
              return (
                <div
                  key={key}
                  role="checkbox" aria-checked={checked} tabIndex={0}
                  className="kds-interactive"
                  onClick={() => setChannels(c => ({ ...c, [key]: !c[key] }))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChannels(c => ({ ...c, [key]: !c[key] })); } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-linen)', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ flexShrink: 0, width: 19, height: 19, border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: checked ? 'var(--kds-oxblood)' : 'var(--kds-vellum)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderColor: checked ? 'var(--kds-oxblood)' : undefined }}>
                    {checked && <div style={{ width: 9, height: 5, borderLeft: '2px solid var(--kds-vellum)', borderBottom: '2px solid var(--kds-vellum)', transform: 'rotate(-45deg) translateY(-1px)' }} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kds-ink)' }}>{label}</div>
                    <div style={{ fontSize: 10, color: 'var(--kds-graphite)', marginTop: 1 }}>
                      {checked ? 'Will be paused' : 'Currently taking orders'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Duration */}
        <div>
          <SectionLabel>Step 2 — For how long?</SectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
            {durations.map(d => (
              <button
                key={d.val}
                className="kds-interactive"
                onClick={() => setMins(d.val)}
                style={{
                  flex: 1, minWidth: 70, padding: '9px 6px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)',
                  background: mins === d.val ? 'var(--kds-oxblood)' : 'var(--kds-linen)',
                  color: mins === d.val ? 'var(--kds-vellum)' : 'var(--kds-graphite)',
                  borderColor: mins === d.val ? 'var(--kds-oxblood)' : undefined,
                  fontFamily: 'var(--kds-font-ui)', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'center',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </ModalBody>
      <ModalFoot>
        <GhostBtn onClick={onClosePause}>Go Back</GhostBtn>
        <OxBtn onClick={() => { onApplyPause(channels, brand, mins); onClosePause(); }}>
          {mins === 0 ? 'Resume All Apps' : 'Stop Orders Now'}
        </OxBtn>
      </ModalFoot>
    </ModalShell>
  );
}

// ── Menu / OOS Modal ───────────────────────────────────────────
function MenuModal({ oosItems, onCloseMenu, onSaveOos }: ModalsProps) {
  const [localOos, setLocalOos]       = useState<Record<string, boolean>>({ ...oosItems });
  const [selectedBrand, setSelectedBrand] = useState(Object.keys(BRANDS)[0]);

  function toggle(name: string) {
    setLocalOos(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function save() {
    onSaveOos(localOos);
    onCloseMenu();
  }

  const brandItems = BRANDS[selectedBrand]?.items ?? [];

  return (
    <ModalShell onClose={onCloseMenu} width={480}>
      <ModalHead title="Mark Items Out of Stock" onClose={onCloseMenu} />
      <ModalBody>
        {/* Brand selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <SectionLabel>Which brand's menu?</SectionLabel>
          <KDSSelect value={selectedBrand} onChange={setSelectedBrand}>
            {Object.keys(BRANDS).map(b => <option key={b} value={b}>{b}</option>)}
          </KDSSelect>
        </div>

        {/* Item rows */}
        <div>
          {brandItems.map((item, idx) => {
            const isOos = !!localOos[item.name];
            return (
              <div key={item.name} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed rgba(55,8,8,0.18)', gap: 10 }}>
                {/* Number */}
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--kds-graphite)', width: 22, flexShrink: 0, textAlign: 'right' }}>
                  {idx + 1}.
                </span>
                {/* Name */}
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kds-ink)', flex: 1, minWidth: 0 }}>
                  {item.name}
                </span>
                {/* IN STOCK / OUT OF STOCK toggle pair */}
                <div style={{ display: 'flex', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', overflow: 'hidden', flexShrink: 0 }}>
                  <button
                    className="kds-interactive"
                    onClick={() => isOos ? toggle(item.name) : undefined}
                    style={{
                      padding: '6px 11px', border: 'none', borderRight: 'var(--kds-b)',
                      fontFamily: 'var(--kds-font-ui)', fontWeight: 800, fontSize: 9,
                      letterSpacing: '0.07em', textTransform: 'uppercase',
                      cursor: isOos ? 'pointer' : 'default',
                      background: 'var(--kds-linen)',
                      color: !isOos ? 'var(--kds-ink)' : 'var(--kds-graphite)',
                      opacity: !isOos ? 1 : 0.55,
                    }}
                  >
                    In Stock
                  </button>
                  <button
                    className="kds-interactive"
                    onClick={() => !isOos ? toggle(item.name) : undefined}
                    style={{
                      padding: '6px 11px', border: 'none',
                      fontFamily: 'var(--kds-font-ui)', fontWeight: 800, fontSize: 9,
                      letterSpacing: '0.07em', textTransform: 'uppercase',
                      cursor: !isOos ? 'pointer' : 'default',
                      background: isOos ? 'var(--kds-oxblood)' : 'var(--kds-linen)',
                      color: isOos ? 'var(--kds-vellum)' : 'var(--kds-graphite)',
                    }}
                  >
                    Out of Stock
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ModalBody>
      <ModalFoot>
        <GhostBtn onClick={onCloseMenu}>Go Back</GhostBtn>
        <OxBtn onClick={save}>Save</OxBtn>
      </ModalFoot>
    </ModalShell>
  );
}

// ── New Order Modal (Manual) ───────────────────────────────────
function NewOrderModal({ onCloseNewOrder, onSubmitManualOrder }: ModalsProps) {
  const [customer, setCustomer] = useState('');
  const [platform, setPlatform] = useState('Phone');
  const [brand, setBrand] = useState('Hot');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const brandData = BRANDS[brand];

  function changeQty(name: string, val: number) {
    setQtys(prev => ({ ...prev, [name]: Math.max(0, Math.min(20, val)) }));
  }

  function changeBrand(b: string) {
    setBrand(b);
    setQtys({});
  }

  function submit() {
    const items: KDSItem[] = Object.entries(qtys)
      .filter(([, qty]) => qty > 0)
      .map(([name, qty]) => makeItem(name, qty));

    if (items.length === 0) { setError('Please add at least one item!'); return; }
    setError('');

    const ok = onSubmitManualOrder({
      customer: customer.trim() || 'Phone Customer',
      platform, brand, items, notes: notes.trim(),
    });
    if (ok) onCloseNewOrder();
  }

  return (
    <ModalShell onClose={onCloseNewOrder} width={520}>
      <ModalHead title="Add Order by Hand" onClose={onCloseNewOrder} />
      <ModalBody>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormRow label="Customer Name">
            <KDSInput value={customer} onChange={setCustomer} placeholder="e.g. Table 5 / Rahul" />
          </FormRow>
          <FormRow label="Order From">
            <KDSSelect value={platform} onChange={setPlatform}>
              <option value="Phone">Phone Order</option>
              <option value="Swiggy">Swiggy</option>
              <option value="Zomato">Zomato</option>
            </KDSSelect>
          </FormRow>
        </div>
        <FormRow label="Which Brand?">
          <KDSSelect value={brand} onChange={changeBrand}>
            {Object.keys(BRANDS).map(b => <option key={b} value={b}>{b}</option>)}
          </KDSSelect>
        </FormRow>
        <FormRow label="Select Items & Quantity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {brandData.items.map(item => (
              <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-linen)' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--kds-ink)' }}>{item.name}</span>
                <input
                  type="number" min={0} max={20} value={qtys[item.name] ?? 0}
                  onChange={e => changeQty(item.name, parseInt(e.target.value) || 0)}
                  style={{ width: 48, padding: '3px 5px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-vellum)', fontFamily: 'var(--kds-font-ui)', fontSize: 13, fontWeight: 700, textAlign: 'center', color: 'var(--kds-ink)' }}
                />
              </div>
            ))}
          </div>
        </FormRow>
        <FormRow label="Any Special Instructions?">
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. No onions, extra spicy..."
            style={{ width: '100%', padding: '9px 12px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-linen)', fontFamily: 'var(--kds-font-ui)', fontSize: 14, color: 'var(--kds-ink)', resize: 'vertical', minHeight: 60 }}
          />
        </FormRow>
        {error && <div style={{ color: 'var(--kds-red)', fontSize: 12, fontWeight: 700 }}>{error}</div>}
      </ModalBody>
      <ModalFoot>
        <GhostBtn onClick={onCloseNewOrder}>Cancel</GhostBtn>
        <OxBtn onClick={submit}>Add This Order →</OxBtn>
      </ModalFoot>
    </ModalShell>
  );
}

// ── Analytics Modal ────────────────────────────────────────────
function AnalyticsModal({ data, onCloseAnalytics }: ModalsProps & { data: AnalyticsData }) {
  const tipText = (() => {
    if (data.coldLog > 0) return `💡 Tip: ${data.coldLog} order${data.coldLog > 1 ? 's' : ''} sat packed too long. Next rush, hold the drinks and fast sides a few extra minutes so everything is ready together.`;
    if (data.onTimeRate < 80) return `💡 Tip: Only ${data.onTimeRate}% of orders were on time. Check if the ${data.peakStation?.[0] ?? ''} station needs more hands during peak.`;
    if (data.rejectedCount > 2) return `💡 Tip: ${data.rejectedCount} orders were turned away. Consider pausing Swiggy/Zomato earlier next time to avoid auto-cancellations.`;
    return '👍 Solid rush! Everything ran smoothly.';
  })();

  const stats = [
    { val: `${data.onTimeRate}%`, lbl: 'Orders on time',       sub: `${data.onTimeCount} of ${data.totalCompleted} packed within promised time` },
    { val: data.avgVel,          lbl: 'Avg. minutes per order', sub: 'From accepting to handing over' },
    { val: data.peakStation?.[0] ?? '—', lbl: 'Busiest station this rush', sub: `Hit ${Math.round(data.peakStation?.[1] ?? 0)}% max load` },
    { val: data.coldLog,          lbl: 'Orders that sat too long', sub: 'Packed but waited too long for rider' },
    { val: data.rejectedCount,    lbl: 'Orders turned away',    sub: 'Rejected or cancelled this rush' },
    { val: data.totalCompleted,   lbl: 'Total orders finished', sub: 'Successfully handed over this rush' },
  ];

  return (
    <ModalShell onClose={onCloseAnalytics} width={560}>
      <ModalHead title="Rush Summary — How did we do?" onClose={onCloseAnalytics} />
      <ModalBody>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ padding: 14, border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-linen)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontFamily: 'Libre Caslon Text, serif', fontWeight: 400, fontSize: 36, lineHeight: 1, color: 'var(--kds-oxblood)' }}>{String(s.val)}</div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>{s.lbl}</div>
              <div style={{ fontSize: 11, color: 'var(--kds-graphite)', marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 14px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-gold)', color: 'var(--kds-ink)', fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
          <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 5, opacity: 0.65 }}>Tip for next rush</div>
          {tipText}
        </div>
      </ModalBody>
      <ModalFoot>
        <div />
        <OxBtn onClick={onCloseAnalytics}>Close &amp; Start Fresh</OxBtn>
      </ModalFoot>
    </ModalShell>
  );
}

// ── Shared form primitives ─────────────────────────────────────
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--kds-graphite)' }}>{label}</label>
      {children}
    </div>
  );
}

function KDSInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text" value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '9px 12px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)', background: 'var(--kds-linen)', fontFamily: 'var(--kds-font-ui)', fontSize: 14, color: 'var(--kds-ink)' }}
    />
  );
}

function KDSSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '9px 34px 9px 12px', border: 'var(--kds-b)', borderRadius: 'var(--kds-r)',
        background: 'var(--kds-linen)',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7' viewBox='0 0 11 7'%3E%3Cpath d='M0.5 0.5L5.5 5.5L10.5 0.5' stroke='%23370808' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
        appearance: 'none',
        fontFamily: 'var(--kds-font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--kds-ink)', cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
}

// ── Pool Items Confirmation Modal ──────────────────────────────
function PoolItemsModal({ items, onUseItems, onCookFresh, onClose }: {
  items: PoolItem[];
  onUseItems: () => void;
  onCookFresh: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} width={440}>
      <ModalHead title="Ready Items Available in Pool" onClose={onClose} />
      <ModalBody>
        <div style={{ padding: '10px 12px', background: 'rgba(217,119,6,0.08)', border: '1px solid #d97706', borderRadius: 'var(--kds-r)', marginBottom: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#92400e', marginBottom: 8 }}>
            ↺ Items prepped from a cancelled order
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(item => (
              <div key={item.matchId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#fff7ed', borderRadius: 4, border: '1px solid rgba(217,119,6,0.2)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--kds-ink)' }}>{item.name}</span>
                <span style={{ fontSize: 10, color: '#92400e', fontWeight: 600 }}>Made {item.ageMins}m ago</span>
              </div>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--kds-graphite)', margin: 0, lineHeight: 1.5 }}>
          These items are sitting in the Ready Items Pool. Use them for this order instead of cooking fresh? They'll be marked as ready immediately.
        </p>
      </ModalBody>
      <ModalFoot>
        <GhostBtn onClick={onCookFresh} style={{ flex: 1, justifyContent: 'center' }}>Cook Fresh Instead</GhostBtn>
        <OxBtn onClick={onUseItems} style={{ flex: 1, justifyContent: 'center', background: '#d97706', borderColor: '#d97706' }}>↺ Use Pool Items</OxBtn>
      </ModalFoot>
    </ModalShell>
  );
}

