// script.js — patched for: rowsFiltered bug, due/overdue logic, badge counts, date normalization
// Module expects ./firebase-init.js to export: { db, auth }

import { db, auth } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ----- CONFIG -----
const CASES_COLLECTION = "cases";
const STATUS_OPTIONS = ['Closed','NCM 1','NCM 2','PNS','Service Pending','Monitoring'];

// ----- UI refs -----
const el = {
  btnHamburger: document.getElementById('btnHamburger'),
  btnTheme: document.getElementById('btnTheme'),
  btnUpload: document.getElementById('btnUpload'),
  fileInput: document.getElementById('fileInput'),
  btnExport: document.getElementById('btnExport'),
  btnImport: document.getElementById('btnImport'),
  importBackupInput: document.getElementById('importBackupInput'),
  txtSearch: document.getElementById('txtSearch'),
  ddlStatusFilter: document.getElementById('ddlStatusFilter'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  btnApply: document.getElementById('btnApply'),
  btnClear: document.getElementById('btnClear'),
  btnDueToday: document.getElementById('btnDueToday'),
  btnFlagged: document.getElementById('btnFlagged'),
  btnRepeating: document.getElementById('btnRepeating'),
  btnSortDate: document.getElementById('btnSortDate'),
  btnUnupdated: document.getElementById('btnUnupdated'),
  badgeDue: document.getElementById('badgeDue'),
  badgeFlag: document.getElementById('badgeFlag'),
  overlay: document.getElementById('overlay'),
  sidebar: document.getElementById('sidebar'),
  filtersContainer: document.getElementById('filtersContainer'),
  btnSideApply: document.getElementById('btnSideApply'),
  btnSideClose: document.getElementById('btnSideClose'),
  tbody: document.getElementById('tbody'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  optLastActioned: document.getElementById('optLastActioned'),
  optDate: document.getElementById('optDate'),
  optFlag: document.getElementById('optFlag'),
  optNotes: document.getElementById('optNotes'),
  btnModalSave: document.getElementById('btnModalSave'),
  btnModalClose: document.getElementById('btnModalClose'),
  toast: document.getElementById('toast')
};

// ----- STATE -----
let rows = [];              // full dataset from Firestore
let rowsFiltered = [];      // declared so applyFilters won't create implicit global
let filterState = {
  search: '', status:'', from:'', to:'',
  primaries: {}, // key -> [values]
  primaryLocks: {},
  mode: 'normal',
  sortByDateAsc: null
};

const PRIMARY_SPECS = [
  { key:'caseResolutionCode', label:'Case Resolution Code', options:[] },
  { key:'tl', label:'TL', options:[] },
  { key:'sbd', label:'SBD', options:[] },
  { key:'caGroup', label:'CA Group', options:[] },
  { key:'onsiteRFC', label:'Onsite RFC Status', options:[] },
  { key:'csrRFC', label:'CSR RFC Status', options:[] },
  { key:'benchRFC', label:'Bench RFC Status', options:[] },
  { key:'country', label:'Country', options:[] }
];

// ----- DATE HELPERS -----
// today string in DD-MM-YYYY
function todayDMY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Convert Excel serial or ISO or other to DD-MM-YYYY
function toDisplayDate(val){
  if (val == null || val === "") return "";
  // numeric => excel serial
  if (typeof val === "number" || (/^\d+(\.\d+)?$/.test(String(val)) && !String(val).includes('-'))) {
    // Excel epoch fix: 1899-12-30
    const epoch = Date.UTC(1899,11,30);
    const ms = Math.round(Number(val) * 86400 * 1000);
    const d = new Date(epoch + ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth()+1).padStart(2,'0');
    const dd = String(d.getUTCDate()).padStart(2,'0');
    return `${dd}-${mm}-${yyyy}`;
  }
  // ISO-like YYYY-MM-DD...
  const s = String(val).trim();
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  // other date strings
  const parsed = new Date(s);
  if (!isNaN(parsed)) {
    const dd = String(parsed.getDate()).padStart(2,'0');
    const mm = String(parsed.getMonth()+1).padStart(2,'0');
    const yyyy = parsed.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  // fallback: return original
  return s;
}

// Compare two DD-MM-YYYY strings; returns -1,0,1 (works if both in DD-MM-YYYY)
function compareDMY(a, b){
  if(!a) return b ? -1 : 0;
  if(!b) return 1;
  const [ad,am,ay] = a.split('-').map(x=>parseInt(x,10));
  const [bd,bm,by] = b.split('-').map(x=>parseInt(x,10));
  const aa = `${ay}${String(am).padStart(2,'0')}${String(ad).padStart(2,'0')}`;
  const bb = `${by}${String(bm).padStart(2,'0')}${String(bd).padStart(2,'0')}`;
  if(aa === bb) return 0;
  return aa < bb ? -1 : 1;
}

// ----- PRIMARY FILTER UI (dynamic) -----
function rebuildPrimaryOptions(allRows){
  const map = {};
  PRIMARY_SPECS.forEach(s => map[s.key] = new Set());
  allRows.forEach(r=>{
    PRIMARY_SPECS.forEach(s=>{
      const v = (r[s.key] || '').toString().trim();
      if(v) map[s.key].add(v);
    });
  });
  PRIMARY_SPECS.forEach(s=>{
    s.options = Array.from(map[s.key]).sort((a,b)=> a.localeCompare(b));
  });
}

function buildPrimaryFilters(){
  const fc = el.filtersContainer;
  if(!fc) return;
  fc.innerHTML = '';
  PRIMARY_SPECS.forEach(spec=>{
    const blk = document.createElement('div'); blk.className='filter-block'; blk.dataset.key = spec.key;
    if (filterState.primaryLocks[spec.key]) blk.classList.add('filter-locked');
    const optionsHtml = spec.options.map(opt=>{
      const sel = (filterState.primaries[spec.key] || []).includes(opt);
      return `<label class="chip"><input type="checkbox" data-key="${spec.key}" value="${opt.replace(/"/g,'&quot;')}" ${sel?'checked':''}/> ${opt}</label>`;
    }).join('');
    blk.innerHTML = `
      <div class="filter-head" data-action="toggle">
        <div class="filter-title">${spec.label}</div>
        <div class="flex">
          <span class="lock" data-action="lock" title="Lock/Unlock">${filterState.primaryLocks[spec.key]?'🔒':'🔓'}</span>
          <span>▾</span>
        </div>
      </div>
      <div class="filter-body"><div class="chips">${optionsHtml}</div></div>`;
    fc.appendChild(blk);
  });
}

// filter container handlers
if (el.filtersContainer) {
  el.filtersContainer.addEventListener('click', (e)=>{
    const head = e.target.closest('[data-action]');
    const blk = e.target.closest('.filter-block');
    if(!blk) return;
    const key = blk.dataset.key;
    if (head?.dataset.action==='toggle') blk.querySelector('.filter-body').classList.toggle('open');
    if (head?.dataset.action==='lock'){ filterState.primaryLocks[key] = !filterState.primaryLocks[key]; buildPrimaryFilters(); }
  });
  el.filtersContainer.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type=checkbox]');
    if(!cb) return;
    const key = cb.dataset.key;
    const val = cb.value;
    const set = new Set(filterState.primaries[key] || []);
    if (cb.checked) set.add(val); else set.delete(val);
    filterState.primaries[key] = Array.from(set);
  });
}

// ----- UI controls: sidebar, theme, toggles -----
if (el.btnHamburger) el.btnHamburger.addEventListener('click', ()=>{ el.sidebar.classList.add('open'); el.overlay.classList.add('show'); });
if (el.btnSideClose) el.btnSideClose.addEventListener('click', ()=>{ el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); });
if (el.overlay) el.overlay.addEventListener('click', ()=>{ el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); });

const THEME_KEY = 'KCI_THEME_V1';
if (el.btnTheme) {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  el.btnTheme.textContent = savedTheme === 'light' ? '🌙' : '☀️';
  el.btnTheme.addEventListener('click', ()=>{
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    el.btnTheme.textContent = next === 'light' ? '🌙' : '☀️';
  });
}

// ----- RENDER / FILTERS -----
function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function render(){
  // render from rowsFiltered
  const tb = el.tbody;
  if(!tb) return;
  tb.innerHTML = '';
  const tdy = todayDMY();

  rowsFiltered.forEach((r, idx)=>{
    const tr = document.createElement('tr');

    // priority coloring: due (today/overdue) > flagged > notes
    const isDue = r.followDate && compareDMY(r.followDate, tdy) <= 0 && (!r.status || r.status !== 'Closed');
    if (isDue) tr.classList.add('due-today');
    else if (r.flagged) tr.classList.add('flagged');
    else if (r.notes && r.notes.trim()) tr.classList.add('has-notes');

    const statusHtml = `<select class="status-select" data-id="${r.id}">
      <option value=""></option>
      ${STATUS_OPTIONS.map(o=>`<option ${r.status===o ? 'selected':''}>${o}</option>`).join('')}
    </select>`;

    tr.innerHTML = `
      <td class="sno">${idx+1}</td>
      <td class="caseid">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName||'')}</td>
      <td>${escapeHtml(r.country||'')}</td>
      <td>${escapeHtml(r.caseResolutionCode||'')}</td>
      <td>${escapeHtml(r.caseOwner||'')}</td>
      <td>${escapeHtml(r.caGroup||'')}</td>
      <td>${escapeHtml(r.sbd||'')}</td>
      <td>${statusHtml}</td>
      <td class="right"><span class="gear" title="Case Options" data-action="opts" data-id="${r.id}">⚙️</span></td>
    `;
    tb.appendChild(tr);
  });

  // attach event handlers for the dynamic selects & gear buttons
  document.querySelectorAll('.status-select').forEach(sel=>{
    sel.onchange = async (e) => {
      const id = sel.dataset.id;
      const val = sel.value;
      try {
        await updateDoc(doc(db, CASES_COLLECTION, id), {
          status: val,
          lastActionedOn: (() => {
            const d = new Date();
            const dd = String(d.getDate()).padStart(2,'0');
            const mm = String(d.getMonth()+1).padStart(2,'0');
            const yyyy = d.getFullYear();
            return `${dd}-${mm}-${yyyy}`;
          })(),
          updatedBy: auth.currentUser?.email || null
        });
      } catch(err) {
        console.error("Update status err", err);
        alert("Error updating status: " + (err.message || err));
      }
    };
  });

  document.querySelectorAll('.gear').forEach(g => g.onclick = (e) => openModalFor(e.target.dataset.id));
}

// ----- RENDER HELPERS FOR FILTERS -----
function renderFromFiltered(filtered){
  rowsFiltered = filtered;
  render();
}

// ----- FILTER LOGIC -----
function applyFilters(){
  let out = [...rows];

  // search
  if(filterState.search){
    const q = filterState.search.toLowerCase();
    out = out.filter(r => {
      const joined = [
        r.id, r.customerName, r.country, r.caseResolutionCode,
        r.caseOwner, r.caGroup, r.sbd, r.tl, r.onsiteRFC, r.csrRFC, r.benchRFC, r.notes
      ].map(x => String(x||'')).join(' ').toLowerCase();
      return joined.includes(q);
    });
  }

  // status filter
  if(filterState.status){
    out = out.filter(r => (r.status || '') === filterState.status);
  }

  // createdOn range: r.createdOn stored as DD-MM-YYYY
  if(filterState.from){
    out = out.filter(r => {
      if(!r.createdOn) return false;
      const iso = (() => {
        const [dd,mm,yy] = r.createdOn.split('-'); return `${yy}-${mm}-${dd}`;
      })();
      return iso >= filterState.from;
    });
  }
  if(filterState.to){
    out = out.filter(r => {
      if(!r.createdOn) return false;
      const iso = (() => {
        const [dd,mm,yy] = r.createdOn.split('-'); return `${yy}-${mm}-${dd}`;
      })();
      return iso <= filterState.to;
    });
  }

  // primary filters (AND across)
  Object.keys(filterState.primaries || {}).forEach(key=>{
    const sel = filterState.primaries[key] || [];
    if(sel.length) out = out.filter(r => sel.includes(String(r[key] || '').trim()));
  });

  // modes
  const tdy = todayDMY();
  if(filterState.mode === 'due'){
    // show followDate <= today (due or overdue) AND status not Closed
    out = out.filter(r => {
      if(!r.followDate) return false;
      // compareDMY returns <= 0 if r.followDate <= today
      const cmp = compareDMY(r.followDate, tdy);
      return cmp <= 0 && ( !r.status || r.status !== 'Closed' );
    });
  } else if (filterState.mode === 'flagged'){
    out = out.filter(r => !!r.flagged);
  } else if (filterState.mode === 'repeat'){
    const counts = new Map();
    out.forEach(r => counts.set(r.customerName, (counts.get(r.customerName) || 0) + 1));
    out = out.filter(r => (counts.get(r.customerName) || 0) > 1)
             .sort((a,b)=> String(a.customerName||'').localeCompare(String(b.customerName||'')));
  } else if (filterState.mode === 'unupdated'){
    out = out.filter(r => !r.status || r.status.trim() === '');
  }

  // sort by created (if requested)
  if(filterState.sortByDateAsc !== null){
    out.sort((a,b)=>{
      const da = (a.createdOn || '').split('-').reverse().join(''); // YYYYMMDD
      const db = (b.createdOn || '').split('-').reverse().join('');
      if(da === db) return 0;
      return filterState.sortByDateAsc ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
    });
  }

  renderFromFiltered(out);
  refreshBadges(); // update counts whenever filters applied or data changed
}

// ----- BADGE COUNTS (Due & Flagged) -----
function refreshBadges(){
  const tdy = todayDMY();
  // Due count: followDate <= today AND status != Closed (per your F requirement)
  const dueCount = rows.filter(r => {
    if(!r.followDate) return false;
    if(r.status && r.status === 'Closed') return false;
    return compareDMY(r.followDate, tdy) <= 0;
  }).length;
  const flaggedCount = rows.filter(r => !!r.flagged).length;
  if (el.badgeDue) el.badgeDue.textContent = String(dueCount);
  if (el.badgeFlag) el.badgeFlag.textContent = String(flaggedCount);
}

// ----- MODAL logic -----
let modalCaseId = null;
function openModalFor(id){
  modalCaseId = id;
  const r = rows.find(x=> x.id === id);
  if(!r) return;
  el.modalTitle.textContent = `Case Options - ${id}`;
  el.optLastActioned.textContent = r.lastActionedOn ? r.lastActionedOn : '—';
  // followDate (stored as DD-MM-YYYY) -> modal input expects YYYY-MM-DD
  el.optDate.value = r.followDate ? (() => {
    const m = r.followDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if(m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  })() : '';
  el.optFlag.classList.toggle('on', !!r.flagged);
  el.optFlag.setAttribute('aria-checked', r.flagged ? 'true' : 'false');
  el.optNotes.value = r.notes || '';
  el.modal.classList.add('show');
}
if (el.optFlag) el.optFlag.addEventListener('click', () => {
  const on = el.optFlag.classList.toggle('on');
  el.optFlag.setAttribute('aria-checked', on ? 'true' : 'false');
});
if (el.btnModalClose) el.btnModalClose.addEventListener('click', ()=>{ el.modal.classList.remove('show'); modalCaseId = null; });

if (el.btnModalSave) el.btnModalSave.addEventListener('click', async ()=>{
  if(!modalCaseId) return;
  const followDateVal = el.optDate.value ? (() => {
    const [y,m,d] = el.optDate.value.split('-'); return `${d}-${m}-${y}`;
  })() : null;
  const flagged = el.optFlag.classList.contains('on');
  const notes = el.optNotes.value.trim();
  const lastActionedOn = (() => { const d = new Date(); const dd = String(d.getDate()).padStart(2,'0'); const mm = String(d.getMonth()+1).padStart(2,'0'); const yyyy = d.getFullYear(); return `${dd}-${mm}-${yyyy}`; })();

  try {
    await updateDoc(doc(db, CASES_COLLECTION, modalCaseId), {
      followDate: followDateVal,
      flagged,
      notes,
      lastActionedOn,
      updatedBy: auth.currentUser?.email || null
    });
    el.modal.classList.remove('show');
    modalCaseId = null;
  } catch(err) {
    console.error("Error saving modal:", err);
    alert("Error saving: " + (err.message || err));
  }
});

// ----- TABLE interactions (delegated) -----
el.tbody.addEventListener('change', async (e) => {
  const sel = e.target.closest('select.status-select');
  if(!sel) return;
  const id = sel.dataset.id; const val = sel.value;
  try {
    await updateDoc(doc(db, CASES_COLLECTION, id), {
      status: val,
      lastActionedOn: (() => {
        const d = new Date(); const dd = String(d.getDate()).padStart(2,'0'); const mm = String(d.getMonth()+1).padStart(2,'0'); const yyyy = d.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
      })(),
      updatedBy: auth.currentUser?.email || null
    });
  } catch(err) {
    console.error("Error updating status:", err);
    alert("Error updating status: " + (err.message || err));
  }
});

el.tbody.addEventListener('click', (e) => {
  const gear = e.target.closest('[data-action=opts]');
  if(!gear) return;
  openModalFor(gear.dataset.id);
});

// double-click copy case id
document.addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.caseid'); if(!cell) return;
  const text = cell.textContent.trim();
  navigator.clipboard.writeText(text).then(()=>{ el.toast.classList.add('show'); setTimeout(()=> el.toast.classList.remove('show'), 1000); });
});

// ----- FILTER inputs handlers -----
if (el.txtSearch) {
  el.txtSearch.addEventListener('input', e => { filterState.search = e.target.value.trim(); });
  el.txtSearch.addEventListener('keydown', e => { if(e.key === 'Enter') applyFilters(); });
}
if (el.ddlStatusFilter) el.ddlStatusFilter.addEventListener('change', e => { filterState.status = e.target.value; });
if (el.dateFrom) el.dateFrom.addEventListener('change', e => { filterState.from = e.target.value; });
if (el.dateTo) el.dateTo.addEventListener('change', e => { filterState.to = e.target.value; });
if (el.btnApply) el.btnApply.addEventListener('click', applyFilters);
if (el.btnClear) el.btnClear.addEventListener('click', ()=>{
  filterState.search=''; filterState.status=''; filterState.from=''; filterState.to=''; filterState.mode='normal'; filterState.sortByDateAsc=null;
  filterState.primaries = {}; filterState.primaryLocks = {};
  if (el.txtSearch) el.txtSearch.value=''; if (el.ddlStatusFilter) el.ddlStatusFilter.value=''; if (el.dateFrom) el.dateFrom.value=''; if (el.dateTo) el.dateTo.value='';
  buildPrimaryFilters(); applyFilters();
});
if (el.btnDueToday) el.btnDueToday.addEventListener('click', ()=>{ filterState.mode='due'; applyFilters(); });
if (el.btnFlagged) el.btnFlagged.addEventListener('click', ()=>{ filterState.mode='flagged'; applyFilters(); });
if (el.btnRepeating) el.btnRepeating.addEventListener('click', ()=>{ filterState.mode='repeat'; applyFilters(); });
if (el.btnSortDate) el.btnSortDate.addEventListener('click', ()=>{ filterState.sortByDateAsc = filterState.sortByDateAsc === null ? false : !filterState.sortByDateAsc; applyFilters(); });
if (el.btnUnupdated) el.btnUnupdated.addEventListener('click', ()=>{ filterState.mode='unupdated'; applyFilters(); });

// ----- REALTIME FIRESTORE LISTENER -----
const casesCol = collection(db, CASES_COLLECTION);
let unsub = null;

function startRealtime(){
  if(unsub) unsub();
  unsub = onSnapshot(casesCol, snap => {
    try {
      const all = [];
      snap.forEach(docSnap => all.push({ id: docSnap.id, ...docSnap.data() }));

      // Normalize createdOn and followDate to DD-MM-YYYY
      all.forEach(r=>{
        if (r.createdOn) r.createdOn = toDisplayDate(r.createdOn);
        if (r.followDate) r.followDate = toDisplayDate(r.followDate);
        // If lastActionedOn stored as ISO, normalize to DD-MM-YYYY
        if (r.lastActionedOn) r.lastActionedOn = toDisplayDate(r.lastActionedOn);
      });

      // update in-memory rows, sort by ID (stable)
      rows = all.sort((a,b)=> (a.id||'').localeCompare(b.id||''));

      // rebuild primary filter options
      rebuildPrimaryOptions(rows);
      buildPrimaryFilters();

      // apply current filters and render
      applyFilters();
      refreshBadges();
    } catch(err) {
      console.error("Realtime snapshot processing error:", err);
    }
  }, err => {
    console.error("Realtime DB error:", err);
    alert("Realtime DB error: " + (err.message || err));
  });
}

// ----- ADMIN: Excel upload + backup export/import -----
// Upload
if (el.btnUpload && el.fileInput) {
  el.btnUpload.addEventListener('click', ()=> el.fileInput.click());
  el.fileInput.addEventListener('change', handleExcelUpload);
}

async function handleExcelUpload(e){
  const f = e.target.files[0];
  if(!f) return;
  try {
    // parse via global XLSX (SheetJS must be included on page as script before this module)
    if (typeof XLSX === 'undefined') {
      alert('To import .xlsx directly, include SheetJS (xlsx.full.min.js) on the page. For now, upload CSV or add SheetJS.');
      return;
    }
    const buffer = await f.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rowsParsed = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if(!rowsParsed || !rowsParsed.length) { alert('No rows found'); return; }

    // prepare sets for comparison
    const bulkIds = new Set();
    const existingDocsSnap = await getDocs(casesCol);
    const existingIds = new Set();
    existingDocsSnap.forEach(d => existingIds.add(d.id));

    let added = 0, updated = 0;
    for(const r of rowsParsed){
      const idRaw = r["Case ID"] || r["CaseId"] || r["case id"] || r["case id "];
      if(!idRaw) continue;
      const id = String(idRaw).trim();
      bulkIds.add(id);

      const customerName = r["Full Name (Primary Contact) (Contact)"] || r["Full Name (Primary Contact)"] || r["Customer Name"] || "";
      let createdOn = toDisplayDate(r["Created On"]);
      const createdBy = r["Created By"] || "";
      const country = r["Country"] || "";
      const caseResolutionCode = r["Case Resolution Code"] || "";
      const caseOwner = r["Full Name (Owning User) (User)"] || "";
      const caGroup = r["CA Group"] || "";
      const tl = r["TL"] || "";
      const sbd = r["SBD"] || "";
      const onsiteRFC = r["Onsite RFC Status"] || "";
      const csrRFC = r["CSR RFC Status"] || "";
      const benchRFC = r["Bench RFC Status"] || "";

      const docObj = {
        id,
        customerName,
        createdOn, // stored as DD-MM-YYYY
        createdBy,
        country,
        caseResolutionCode,
        caseOwner,
        caGroup,
        tl,
        sbd,
        onsiteRFC,
        csrRFC,
        benchRFC,
        status: "", // merge will preserve any existing non-empty status
        followDate: null,
        flagged: false,
        notes: "",
        lastActionedOn: null,
      };

      try {
        await setDoc(doc(db, CASES_COLLECTION, id), docObj, { merge: true });
        if (existingIds.has(id)) updated++; else added++;
      } catch(err) {
        console.error("Upload doc error:", err);
      }
    }

    // delete existing docs not present in incoming file (behavior preserved)
    let deleted = 0;
    for(const exId of existingIds){
      if(!bulkIds.has(exId)){
        try { await deleteDoc(doc(db, CASES_COLLECTION, exId)); deleted++; } catch(err){ console.error("delete err", err); }
      }
    }

    alert(`Import complete.\nAdded: ${added}\nUpdated: ${updated}\nRemoved: ${deleted}`);
  } catch(err) {
    console.error("Error importing Excel:", err);
    alert("Error importing Excel: " + (err.message || err));
  } finally {
    e.target.value = '';
  }
}

// Export backup (JSON)
if (el.btnExport) el.btnExport.addEventListener('click', async ()=>{
  try {
    const snap = await getDocs(casesCol);
    const all = [];
    snap.forEach(d => all.push({ id: d.id, ...d.data() }));
    const blob = new Blob([JSON.stringify({ exportedOn: new Date().toISOString(), cases: all }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kci_cases_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    alert('Export finished.');
  } catch(err) {
    console.error("Export err", err);
    alert("Export failed: " + (err.message || err));
  }
});

// Import backup (JSON)
if (el.btnImport && el.importBackupInput) {
  el.btnImport.addEventListener('click', ()=> el.importBackupInput.click());
  el.importBackupInput.addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if(!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      if(!parsed || !Array.isArray(parsed.cases)) { alert('Invalid backup format.'); return; }
      if(!confirm(`This will overwrite current cases collection. Proceed?`)) return;

      // delete existing
      const existingSnap = await getDocs(casesCol);
      const toDelete = []; existingSnap.forEach(d => toDelete.push(d.id));
      for(const id of toDelete) { try { await deleteDoc(doc(db, CASES_COLLECTION, id)); } catch(err){ console.error("del err", err); } }

      // write new
      for(const c of parsed.cases){
        const id = c.id || c.ID || c.caseId;
        if(!id) continue;
        // normalize createdOn & followDate if present
        if (c.createdOn) c.createdOn = toDisplayDate(c.createdOn);
        if (c.followDate) c.followDate = toDisplayDate(c.followDate);
        await setDoc(doc(db, CASES_COLLECTION, id), c);
      }
      alert('Import complete.');
    } catch(err) {
      console.error("Import backup err", err);
      alert('Import failed: ' + (err.message || err));
    } finally {
      e.target.value = '';
    }
  });
}

// ----- START -----
startRealtime();
buildPrimaryFilters();
