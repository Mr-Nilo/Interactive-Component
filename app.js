/* ============================================================
   PASSENGER COUNTER
   Architecture: User Interaction → Event Handler → Update State → Render UI
   The DOM is treated as read-only output. Only render() writes to it.
   ============================================================ */


/* ----- 1. CONFIGURATION ------------------------------------- */
const STORAGE_KEY      = 'passengerCounter:v2';
const MAX_UNDO         = 20;

const DEFAULT_CAPACITY = 40;
const MIN_CAPACITY     = 10;
const MAX_CAPACITY     = 80;

const DEFAULT_RESERVED = 4;
const MIN_RESERVED     = 0;
const MAX_RESERVED     = 12;

// Categories are data, not hard-coded HTML. The `reserved` flag drives
// a different seat-allocation rule AND a different visual treatment.
const CATEGORIES = [
  { id: 'adults',     label: 'Adults',            hint: 'Age 12+' },
  { id: 'children',   label: 'Children',          hint: 'Age 2–11' },
  { id: 'accessible', label: 'Differently-abled', hint: 'Reserved seating', reserved: true },
];


/* ----- 2. STATE — single source of truth ------------------- */
let state = {
  counts:      { adults: 0, children: 0, accessible: 0 },
  capacity:    DEFAULT_CAPACITY,
  reserved:    DEFAULT_RESERVED,
  history:     [],
  lastSavedAt: Date.now(),
};

let undoStack = [];

// Modal open/closed is transient UI state — not persisted, not in `state`.
let modalOpen = false;


/* ----- 3. PERSISTENCE -------------------------------------- */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.counts      = { ...state.counts, ...(saved.counts || {}) };
    state.capacity    = typeof saved.capacity === 'number' ? saved.capacity : DEFAULT_CAPACITY;
    state.reserved    = typeof saved.reserved === 'number' ? saved.reserved : DEFAULT_RESERVED;
    state.history     = Array.isArray(saved.history) ? saved.history : [];
    state.lastSavedAt = saved.lastSavedAt || Date.now();
  } catch (e) {
    console.warn('Could not load saved state:', e);
  }
}

function saveToStorage() {
  try {
    state.lastSavedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save state:', e);
  }
}


/* ----- 4. DERIVED VALUES ----------------------------------- */
function computeTotal()        { return Object.values(state.counts).reduce((s, n) => s + n, 0); }
function generalSeats()        { return state.capacity - state.reserved; }
function generalCount()        { return state.counts.adults + state.counts.children; }
function generalRemaining()    { return Math.max(0, generalSeats() - generalCount()); }
function reservedRemaining()   { return Math.max(0, state.reserved - state.counts.accessible); }
function isBusFull()           { return generalRemaining() === 0 && reservedRemaining() === 0; }

function canIncrement(catId) {
  if (catId === 'accessible') return reservedRemaining() > 0;
  return generalRemaining() > 0;
}

function canSetCapacity(n) {
  if (n < MIN_CAPACITY || n > MAX_CAPACITY) return false;
  if (n < state.reserved)                   return false;   // capacity must hold reserved
  if (n - state.reserved < generalCount())  return false;   // and current general usage
  return true;
}

function canSetReserved(n) {
  if (n < MIN_RESERVED || n > MAX_RESERVED) return false;
  if (n < state.counts.accessible)              return false;   // can't reserve fewer than in use
  if (state.capacity - n < generalCount())      return false;   // can't squeeze general too small
  return true;
}

function formatRelativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


/* ----- 5. STATE UPDATERS ----------------------------------- */
function snapshotForUndo() {
  undoStack.push({
    counts:   structuredClone(state.counts),
    capacity: state.capacity,
    reserved: state.reserved,
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function increment(catId) {
  if (!canIncrement(catId)) return;
  snapshotForUndo();
  state.counts[catId]++;
  commit();
}

function decrement(catId) {
  if (state.counts[catId] <= 0) return;
  snapshotForUndo();
  state.counts[catId]--;
  commit();
}

function resetAll() {
  snapshotForUndo();
  for (const k in state.counts) state.counts[k] = 0;
  commit();
}

function setCapacity(n) {
  if (!canSetCapacity(n)) return;
  snapshotForUndo();
  state.capacity = n;
  commit();
}

function setReserved(n) {
  if (!canSetReserved(n)) return;
  snapshotForUndo();
  state.reserved = n;
  commit();
}

function saveCheckpoint() {
  const total = computeTotal();
  if (total === 0) return;
  state.history.unshift({
    id:        uid(),
    timestamp: Date.now(),
    counts:    { ...state.counts },
    capacity:  state.capacity,
    reserved:  state.reserved,
    total,
  });
  commit();
}

function deleteHistoryEntry(id) {
  state.history = state.history.filter(h => h.id !== id);
  commit();
}

function undo() {
  if (!undoStack.length) return;
  const s = undoStack.pop();
  state.counts   = s.counts;
  state.capacity = s.capacity;
  state.reserved = s.reserved;
  commit();
}

function commit() {
  saveToStorage();
  render();
}


/* ----- 6. DOM REFERENCES ----------------------------------- */
const els = {
  hero:           document.getElementById('hero'),
  totalCount:     document.getElementById('totalCount'),
  totalStatus:    document.getElementById('totalStatus'),

  capacityValue:  document.getElementById('capacityValue'),
  capacityInc:    document.getElementById('capacityInc'),
  capacityDec:    document.getElementById('capacityDec'),

  reservedValue:  document.getElementById('reservedValue'),
  reservedInc:    document.getElementById('reservedInc'),
  reservedDec:    document.getElementById('reservedDec'),

  counters:       document.querySelector('.counters'),

  undoBtn:        document.getElementById('undoBtn'),
  resetBtn:       document.getElementById('resetBtn'),
  saveBtn:        document.getElementById('saveBtn'),
  historyBtn:     document.getElementById('historyBtn'),

  historyModal:   document.getElementById('historyModal'),
  historyClose:   document.getElementById('historyClose'),
  historyList:    document.getElementById('historyList'),
  emptyHistory:   document.getElementById('emptyHistory'),

  saveStatus:     document.getElementById('saveStatus'),
};


/* ----- 7. RENDER — the only place state becomes DOM -------- */
function render() {
  renderHero();
  renderSettings();
  renderCounters();
  renderActions();
  renderHistory();
  renderModal();
  renderSaveStatus();
}

function renderHero() {
  const total = computeTotal();
  const full  = isBusFull();
  els.totalCount.textContent = total;

  if (full) {
    els.totalStatus.textContent = 'Bus Full';
  } else {
    const parts = [];
    if (generalRemaining() > 0)  parts.push(`${generalRemaining()} general`);
    if (reservedRemaining() > 0) parts.push(`${reservedRemaining()} reserved`);
    els.totalStatus.textContent = `${parts.join(' · ')} free`;
  }
  els.hero.classList.toggle('is-full', full);
}

function renderSettings() {
  // Don't overwrite the input while the user is actively typing in it.
  if (document.activeElement !== els.capacityValue) els.capacityValue.value = state.capacity;
  els.capacityDec.disabled = !canSetCapacity(state.capacity - 1);
  els.capacityInc.disabled = !canSetCapacity(state.capacity + 1);

  if (document.activeElement !== els.reservedValue) els.reservedValue.value = state.reserved;
  els.reservedDec.disabled = !canSetReserved(state.reserved - 1);
  els.reservedInc.disabled = !canSetReserved(state.reserved + 1);
}

function renderCounters() {
  if (els.counters.children.length === 0) {
    els.counters.innerHTML = CATEGORIES.map(cat => `
      <article class="row counter" data-id="${cat.id}">
        <div class="row-info">
          <span class="row-label">
            ${cat.label}
            ${cat.reserved ? '<span class="badge">Reserved</span>' : ''}
          </span>
          <span class="row-hint" data-hint="${cat.id}">${cat.hint}</span>
        </div>
        <div class="stepper" role="group" aria-label="${cat.label} count">
          <button class="stepper-btn"
                  data-action="decrement" data-target="${cat.id}"
                  aria-label="Decrease ${cat.label}">−</button>
          <span class="stepper-value" data-value="${cat.id}" aria-live="polite">0</span>
          <button class="stepper-btn"
                  data-action="increment" data-target="${cat.id}"
                  aria-label="Increase ${cat.label}">+</button>
        </div>
      </article>
    `).join('');
  }

  CATEGORIES.forEach(cat => {
    const value = state.counts[cat.id];
    els.counters.querySelector(`[data-value="${cat.id}"]`).textContent = value;
    const decBtn = els.counters.querySelector(`[data-action="decrement"][data-target="${cat.id}"]`);
    const incBtn = els.counters.querySelector(`[data-action="increment"][data-target="${cat.id}"]`);
    decBtn.disabled = value <= 0;
    incBtn.disabled = !canIncrement(cat.id);

    if (cat.id === 'accessible') {
      const hint = els.counters.querySelector(`[data-hint="${cat.id}"]`);
      hint.textContent = state.reserved === 0
        ? 'No reserved seats configured'
        : `${value} of ${state.reserved} reserved seats used`;
    }
  });
}

function renderActions() {
  const total = computeTotal();
  els.undoBtn.disabled  = undoStack.length === 0;
  els.resetBtn.disabled = total === 0;
  els.saveBtn.disabled  = total === 0;
  els.historyBtn.textContent = state.history.length > 0
    ? `History (${state.history.length})`
    : 'History';
}

function renderHistory() {
  const hasHistory = state.history.length > 0;
  els.emptyHistory.classList.toggle('hidden', hasHistory);
  els.historyList.innerHTML = state.history.map(entry => `
    <li class="history-item">
      <div>
        <div class="history-item-counts">
          Total: <strong>${entry.total}</strong>
          <span class="history-item-breakdown">
            (A:${entry.counts.adults} · C:${entry.counts.children} · D:${entry.counts.accessible ?? 0})
          </span>
        </div>
        <div class="history-item-time">${new Date(entry.timestamp).toLocaleString()}</div>
      </div>
      <button class="history-delete"
              data-action="delete-history" data-id="${entry.id}"
              aria-label="Delete history entry from ${new Date(entry.timestamp).toLocaleString()}">
        Delete
      </button>
    </li>
  `).join('');
}

function renderModal() {
  if (modalOpen && !els.historyModal.open) els.historyModal.showModal();
  else if (!modalOpen && els.historyModal.open) els.historyModal.close();
  els.historyBtn.setAttribute('aria-expanded', modalOpen ? 'true' : 'false');
}

function renderSaveStatus() {
  els.saveStatus.textContent = `Auto-saved ${formatRelativeTime(state.lastSavedAt)}`;
}


/* ----- 8. EVENT HANDLERS ----------------------------------- */
els.counters.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, target } = btn.dataset;
  if (action === 'increment') increment(target);
  if (action === 'decrement') decrement(target);
});

els.historyList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action="delete-history"]');
  if (!btn) return;
  deleteHistoryEntry(btn.dataset.id);
});

els.capacityInc.addEventListener('click', () => setCapacity(state.capacity + 1));
els.capacityDec.addEventListener('click', () => setCapacity(state.capacity - 1));
els.reservedInc.addEventListener('click', () => setReserved(state.reserved + 1));
els.reservedDec.addEventListener('click', () => setReserved(state.reserved - 1));

// Capacity manual input: clamp to valid range on commit, revert if empty/invalid.
els.capacityValue.addEventListener('change', () => {
  const n = parseInt(els.capacityValue.value, 10);
  if (!isNaN(n)) setCapacity(Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, n)));
  els.capacityValue.value = state.capacity;  // always sync back (shows clamped value)
});
els.capacityValue.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.capacityValue.blur();
});

// Reserved seats manual input: same pattern.
els.reservedValue.addEventListener('change', () => {
  const n = parseInt(els.reservedValue.value, 10);
  if (!isNaN(n)) setReserved(Math.min(MAX_RESERVED, Math.max(MIN_RESERVED, n)));
  els.reservedValue.value = state.reserved;
});
els.reservedValue.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.reservedValue.blur();
});

els.undoBtn.addEventListener('click', undo);
els.saveBtn.addEventListener('click', saveCheckpoint);
els.resetBtn.addEventListener('click', () => {
  if (confirm('Reset all counters to zero? (You can still Undo afterward.)')) resetAll();
});

els.historyBtn.addEventListener('click', () => { modalOpen = true;  render(); });
els.historyClose.addEventListener('click', () => { modalOpen = false; render(); });
els.historyModal.addEventListener('close', () => {
  modalOpen = false;
  els.historyBtn.setAttribute('aria-expanded', 'false');
});
els.historyModal.addEventListener('click', e => {
  if (e.target === els.historyModal) { modalOpen = false; render(); }
});


/* ----- 9. KEYBOARD SHORTCUTS ------------------------------- */
document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea')) return;

  const activeCard = document.activeElement?.closest?.('.counter');
  const targetId   = activeCard?.dataset.id || CATEGORIES[0].id;

  if (e.key === '+' || e.key === '=') increment(targetId);
  else if (e.key === '-' || e.key === '_') decrement(targetId);
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCheckpoint(); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) { modalOpen = !modalOpen; render(); }
});


/* ----- 10. AUTO-SAVE STATUS TICK --------------------------- */
setInterval(renderSaveStatus, 1000);


/* ----- 11. INIT -------------------------------------------- */
loadFromStorage();
render();
