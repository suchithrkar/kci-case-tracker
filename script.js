// script.js (module) — tracker logic with Firestore real-time sync
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

const CASES_COLLECTION = "cases";

// UI refs
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

const STATUS_OPTIONS = ['Closed','NCM 1','NCM 2','PNS','Service Pending','Monitoring'];

// STATE
let rows = [];
let filterState = {
  search: '', status:'', from:'', to:'',
  primaries: { caseResolutionCode:[], tl:[], sbd:[], caGroup:[], onsiteRFC:[], csrRFC:[], benchRFC:[], country:[] },
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

// UTIL: format date ISO <-> DD-MM-YYYY
function ymdToDMY(iso){ // iso = YYYY-MM-DD
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
function dmyToYMD(dmy){ // dmy = DD-MM-YYYY
  if(!dmy) return '';
  const [d,m,y] = dmy.split('-');
  return `${y}-${m}-${d}`;
}
function excelNumberToYMD(num){
  // handle Excel serial numbers -> Date string YYYY-MM-DD
  // Excel serial 1 = 1899-12-31 (but library ambiguity). We'll use epoch 1899-12-30 to match typical conversion
  const epoch = Date.UTC(1899,11,30);
  const ms = Math.round(Number(num) * 86400000);
  const d = new Date(epoch + ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function toDisplayDate(isoOrSerial){
  if(!isoOrSerial) return '';
  if(typeof isoOrSerial === 'number' || /^\d+(\.\d+)?$/.test(String(isoOrSerial))){
    return ymdToDMY(excelNumberToYMD(Number(isoOrSerial)));
  }
  // if iso-like '2025-10-01' or '2025-10-01T...' handle
  const s = String(isoOrSerial);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  // fallback: try Date parse
  const dt = new Date(s);
  if(!isNaN(dt)) {
    const dd = String(dt.getDate()).padStart(2,'0');
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const yyyy = dt.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  return s;
}

// build primary options dynamically from incoming rows
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
    s.options = Array.from(map[s.key]).sort((a,b)=>a.localeCompare(b));
  });
}

// Build Primary Filters UI
function buildPrimaryFilters(){
  const fc = el.filtersContainer;
  fc.innerHTML = '';
  PRIMARY_SPECS.forEach(spec=>{
    const blk = document.createElement('div'); blk.className='filter-block'; blk.dataset.key = spec.key;
    if (filterState.primaryLocks[spec.key]) blk.classList.add('filter-locked');
    const optionsHtml = spec.options.map(opt=>{
      const sel = filterState.primaries[spec.key]?.includes(opt);
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

// sidebar actions
el.filtersContainer.addEventListener('click', (e)=>{
  const head = e.target.closest('[data-action]'); const blk = e.target.closest('.filter-block'); if(!blk) return; const key = blk.dataset.key;
  if (head?.dataset.action==='toggle') blk.querySelector('.filter-body').classList.toggle('open');
  if (head?.dataset.action==='lock'){ filterState.primaryLocks[key] = !filterState.primaryLocks[key]; buildPrimaryFilters(); }
});
el.filtersContainer.addEventListener('change', (e)=>{
  const cb = e.target.closest('input[type=checkbox]'); if(!cb) return; const key = cb.dataset.key, val = cb.value; const set = new Set(filterState.primaries[key]||[]);
  if (cb.checked) set.add(val); else set.delete(val); filterState.primaries[key] = [...set];
});
el.btnSideApply.addEventListener('click', ()=>{ applyFilters(); closeSidebar(); });
function closeSidebar(){ el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }
el.btnHamburger.addEventListener('click', ()=>{ el.sidebar.classList.add('open'); el.overlay.classList.add('show'); });
el.btnSideClose.addEventListener('click', closeSidebar);
el.overlay.addEventListener('click', closeSidebar);

// Theme
const THEME_KEY = 'KCI_THEME_V1';
const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
document.documentElement.dataset.theme = savedTheme;
el.btnTheme.textContent = savedTheme === 'light' ? '🌙' : '☀️';
el.btnTheme.addEventListener('click', ()=>{
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  el.btnTheme.textContent = next==='light' ? '🌙' : '☀️';
});

// Modal logic
let modalCaseId = null;
function openModalFor(id){
  modalCaseId = id;
  const r = rows.find(x=>x.id === id);
  if(!r) return;
  el.modalTitle.textContent = `Case Options - ${id}`;
  el.optLastActioned.textContent = r.lastActionedOn ? r.lastActionedOn : '—';
  // store followDate as YYYY-MM-DD in data; modal date input needs YYYY-MM-DD
  el.optDate.value = r.followDate ? (() => {
    // r.followDate stored as DD-MM-YYYY
    const m=r.followDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if(m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  })() : '';
  el.optFlag.classList.toggle('on', !!r.flagged);
  el.optFlag.setAttribute('aria-checked', r.flagged ? 'true' : 'false');
  el.optNotes.value = r.notes || '';
  el.modal.classList.add('show');
}
el.optFlag.addEventListener('click', ()=> {
  const on = el.optFlag.classList.toggle('on');
  el.optFlag.setAttribute('aria-checked', on ? 'true' : 'false');
});
el.btnModalClose.addEventListener('click', ()=> { el.modal.classList.remove('show'); modalCaseId = null; });

el.btnModalSave.addEventListener('click', async ()=>{
  if(!modalCaseId) return;
  const followDateVal = el.optDate.value ? (() => {
    // convert YYYY-MM-DD -> DD-MM-YYYY
    const [y,m,d] = el.optDate.value.split('-');
    return `${d}-${m}-${y}`;
  })() : null;
  const flagged = el.optFlag.classList.contains('on');
  const notes = el.optNotes.value.trim();
  const lastActionedOn = (new Date()).toISOString().split('T')[0]; // YYYY-MM-DD
  // convert lastActionedOn to DD-MM-YYYY for display/storage
  const [y,m,d] = lastActionedOn.split('-');
  const lastActionedDMY = `${d}-${m}-${y}`;

  try{
    await updateDoc(doc(db, CASES_COLLECTION, modalCaseId), {
      followDate: followDateVal, // store DD-MM-YYYY
      flagged,
      notes,
      lastActionedOn: lastActionedDMY,
      updatedBy: auth.currentUser?.email || null
    });
    // close modal
    el.modal.classList.remove('show');
    modalCaseId = null;
  }catch(err){
    console.error("Error saving modal:", err);
    alert("Error saving: " + err.message);
  }
});

// Rendering
function render(){
  el.tbody.innerHTML = '';
  const tdy = (() => {
    const d = new Date(); const dd = String(d.getDate()).padStart(2,'0'); const mm = String(d.getMonth()+1).padStart(2,'0'); const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  })();

  rows.forEach((r, idx)=>{
    const tr = document.createElement('tr');

    // Priority coloring: due today > flagged > notes
    if (r.followDate === tdy) tr.classList.add('due-today');
    else if (r.flagged) tr.classList.add('flagged');
    else if (r.notes && r.notes.trim()) tr.classList.add('has-notes');

    const statusHtml = `<select class="status-select" data-id="${r.id}">
      <option value=""></option>
      ${STATUS_OPTIONS.map(o=>`<option ${r.status===o?'selected':''}>${o}</option>`).join('')}
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
    el.tbody.appendChild(tr);
  });

  // badges
  const dueCount = rows.filter(r=> r.followDate === tdy && r.status && r.status !== 'Closed').length;
  const flagCount = rows.filter(r=> !!r.flagged).length;
  el.badgeDue.textContent = String(dueCount);
  el.badgeFlag.textContent = String(flagCount);
}

// helpers
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// events: status change & gear click
el.tbody.addEventListener('change', async (e)=>{
  const sel = e.target.closest('select.status-select');
  if(!sel) return;
  const id = sel.dataset.id; const val = sel.value;
  try{
    await updateDoc(doc(db, CASES_COLLECTION, id), {
      status: val,
      lastActionedOn: (() => { const d = new Date(); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}-${mm}-${yyyy}`; })(),
      updatedBy: auth.currentUser?.email || null
    });
  }catch(err){
    console.error("Error updating status:", err);
    alert("Error updating status: " + err.message);
  }
});

el.tbody.addEventListener('click', (e)=>{
  const gear = e.target.closest('[data-action=opts]');
  if(!gear) return;
  openModalFor(gear.dataset.id);
});

// double click to copy case id
document.addEventListener('dblclick', (e)=>{
  const cell = e.target.closest('.caseid'); if(!cell) return;
  const text = cell.textContent.trim();
  navigator.clipboard.writeText(text).then(()=>{ el.toast.classList.add('show'); setTimeout(()=> el.toast.classList.remove('show'), 1000); });
});

// Filter inputs
el.txtSearch.addEventListener('input', (e)=> { filterState.search = e.target.value.trim(); });
el.txtSearch.addEventListener('keydown', (e)=> { if(e.key==='Enter') applyFilters(); });
el.ddlStatusFilter.addEventListener('change', (e)=> { filterState.status = e.target.value; });
el.dateFrom.addEventListener('change', (e)=> { filterState.from = e.target.value; });
el.dateTo.addEventListener('change', (e)=> { filterState.to = e.target.value; });
el.btnApply.addEventListener('click', applyFilters);
el.btnClear.addEventListener('click', ()=>{
  filterState = { ...filterState, search:'', status:'', from:'', to:'', mode:'normal', sortByDateAsc:null, primaries: {} };
  el.txtSearch.value=''; el.ddlStatusFilter.value=''; el.dateFrom.value=''; el.dateTo.value='';
  buildPrimaryFilters(); applyFilters();
});
el.btnDueToday.addEventListener('click', ()=>{ filterState.mode='due'; applyFilters(); });
el.btnFlagged.addEventListener('click', ()=>{ filterState.mode='flagged'; applyFilters(); });
el.btnRepeating.addEventListener('click', ()=>{ filterState.mode='repeat'; applyFilters(); });
el.btnSortDate.addEventListener('click', ()=>{ filterState.sortByDateAsc = filterState.sortByDateAsc === null ? false : !filterState.sortByDateAsc; applyFilters(); });
el.btnUnupdated.addEventListener('click', ()=>{ filterState.mode='unupdated'; applyFilters(); });

function applyFilters(){
  let out = [...rows];
  // search
  if(filterState.search){
    const q = filterState.search.toLowerCase();
    out = out.filter(r => Object.values({id:r.id, customerName:r.customerName, country:r.country, caseResolutionCode:r.caseResolutionCode, caseOwner:r.caseOwner, caGroup:r.caGroup, sbd:r.sbd, tl:r.tl, onsiteRFC:r.onsiteRFC, csrRFC:r.csrRFC, benchRFC:r.benchRFC, notes:r.notes}).some(v => String(v||'').toLowerCase().includes(q)));
  }
  if(filterState.status) out = out.filter(r => (r.status||'') === filterState.status);
  if(filterState.from) out = out.filter(r => {
    // createdOn stored as DD-MM-YYYY; convert to YYYY-MM-DD for comparison
    if(!r.createdOn) return false;
    const [dd,mm,yy] = r.createdOn.split('-'); const iso = `${yy}-${mm}-${dd}`; return iso >= filterState.from;
  });
  if(filterState.to) out = out.filter(r => {
    if(!r.createdOn) return false;
    const [dd,mm,yy] = r.createdOn.split('-'); const iso = `${yy}-${mm}-${dd}`; return iso <= filterState.to;
  });
  // primary filters (AND across)
  Object.keys(filterState.primaries||{}).forEach(key=>{
    const sel = filterState.primaries[key]||[];
    if(sel.length) out = out.filter(r => sel.includes(String(r[key]||'')));
  });

  // modes
  const tdy = (() => { const d=new Date(); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}-${mm}-${yyyy}`; })();
  if(filterState.mode === 'due') out = out.filter(r => (r.followDate||'') === tdy && r.status && r.status !== 'Closed');
  else if(filterState.mode === 'flagged') out = out.filter(r => !!r.flagged);
  else if(filterState.mode === 'repeat'){
    const counts = new Map(); out.forEach(r=> counts.set(r.customerName, (counts.get(r.customerName)||0)+1));
    out = out.filter(r=> (counts.get(r.customerName)||0) > 1).sort((a,b)=> String(a.customerName||'').localeCompare(String(b.customerName||'')));
  } else if(filterState.mode === 'unupdated'){
    out = out.filter(r => !r.status || r.status.trim() === '');
  }

  // sort by created
  if(filterState.sortByDateAsc !== null){
    out.sort((a,b)=>{
      const da = (a.createdOn||'').split('-').reverse().join(''); // YYYYMMDD
      const db = (b.createdOn||'').split('-').reverse().join('');
      if(da === db) return 0;
      return filterState.sortByDateAsc ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
    });
  }

  // apply to rendered set
  rowsFiltered = out;
  renderFromFiltered(out);
}

// render from filtered dataset (keeps coloring rules same)
function renderFromFiltered(filtered){
  const tb = el.tbody;
  tb.innerHTML = '';
  filtered.forEach((r, idx)=>{
    const tr = document.createElement('tr');
    if (r.followDate === (() => { const d = new Date(); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}-${mm}-${yyyy}`; })()) tr.classList.add('due-today');
    else if (r.flagged) tr.classList.add('flagged');
    else if (r.notes && r.notes.trim()) tr.classList.add('has-notes');

    const statusHtml = `<select class="status-select" data-id="${r.id}">
      <option value=""></option>
      ${STATUS_OPTIONS.map(o=>`<option ${r.status===o?'selected':''}>${o}</option>`).join('')}
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
  // reattach event listeners for status selects & gear (delegated)
  document.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async (e)=>{
      const id = sel.dataset.id; const newStatus = sel.value;
      try{
        await updateDoc(doc(db, CASES_COLLECTION, id), { status: newStatus, lastActionedOn: (()=>{ const d=new Date(); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}-${mm}-${yyyy}`; })(), updatedBy: auth.currentUser?.email || null });
      }catch(err){ console.error("Update status err",err); }
    });
  });
  document.querySelectorAll('.gear').forEach(g => g.addEventListener('click', e => openModalFor(e.target.dataset.id)));
}

// Real-time listener for cases
const casesCol = collection(db, CASES_COLLECTION);
let unsub = null;
function startRealtime(){
  if(unsub) unsub();
  unsub = onSnapshot(casesCol, snap => {
    const all = [];
    snap.forEach(docSnap => {
      all.push({ id: docSnap.id, ...docSnap.data() });
    });
    // ensure dates are stored/displayed as DD-MM-YYYY (if incoming createdOn is ISO or number convert)
    all.forEach(r=>{
      // normalize createdOn to DD-MM-YYYY if it looks like ISO or Excel serial
      if (r.createdOn) {
        // If createdOn is in YYYY-MM-DD format
        if(/^\d{4}-\d{2}-\d{2}/.test(r.createdOn)) {
          const [y,m,d] = r.createdOn.split('-'); r.createdOn = `${d}-${m}-${y}`;
        } else if (/^\d+(\.\d+)?$/.test(String(r.createdOn))) {
          // numeric excel serial
          r.createdOn = toDisplayDate(Number(r.createdOn));
        }
      }
    });
    // save to memory rows
    rows = all.sort((a,b)=> (a.id||'').localeCompare(b.id||''));
    // rebuild primary filters options and UI
    rebuildPrimaryOptions(rows);
    buildPrimaryFilters();
    // initial render
    applyFilters();
  }, err => {
    console.error("Realtime error:", err);
    alert("Realtime DB error: " + err.message);
  });
}

// ADMIN: Excel upload (only visible to admin in index.html)
el.btnUpload.addEventListener('click', ()=> el.fileInput.click());
el.fileInput.addEventListener('change', handleExcelUpload);

async function handleExcelUpload(e){
  const f = e.target.files[0];
  if(!f) return;
  try{
    // parse via global XLSX
    const buffer = await f.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rowsParsed = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if(!rowsParsed || !rowsParsed.length) { alert('No rows found'); return; }

    // Map columns per the structure you provided
    // We'll map using header keys in the Excel (exact names)
    const bulkIds = new Set();
    const existingDocs = await getDocs(casesCol);
    const existingIds = new Set();
    existingDocs.forEach(d => existingIds.add(d.id));

    let added = 0, updated = 0;
    for(const r of rowsParsed){
      const idRaw = r["Case ID"] || r["CaseId"] || r["case id"] || r["case id "];
      if(!idRaw) continue;
      const id = String(idRaw).trim();
      bulkIds.add(id);
      const customerName = r["Full Name (Primary Contact) (Contact)"] || r["Full Name (Primary Contact)"] || r["Customer Name"] || "";
      // Created On - convert to DD-MM-YYYY
      let createdOn = "";
      if (typeof r["Created On"] === 'number') {
        createdOn = toDisplayDate(r["Created On"]); // returns DD-MM-YYYY
      } else {
        createdOn = toDisplayDate(r["Created On"]);
      }
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

      // Prepare doc object
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
        status: "", // preserve existing if present via merge
        followDate: null,
        flagged: false,
        notes: "",
        lastActionedOn: null,
      };

      // write with merge: preserve previous fields like status, notes
      try{
        await setDoc(doc(db, CASES_COLLECTION, id), docObj, { merge: true });
        if(existingIds.has(id)) updated++; else added++;
      }catch(err){
        console.error("Upload doc error:", err);
      }
    }

    // delete any existing docs not in incoming (optional — same behavior as earlier)
    let deleted = 0;
    for(const exId of existingIds){
      if(!bulkIds.has(exId)){
        try{ await deleteDoc(doc(db, CASES_COLLECTION, exId)); deleted++; }catch(err){ console.error("delete err",err); }
      }
    }

    alert(`Import complete.\nAdded: ${added}\nUpdated: ${updated}\nRemoved: ${deleted}`);
  }catch(err){
    console.error("Error importing Excel:", err);
    alert("Error importing Excel: " + (err.message || err));
  }finally{
    e.target.value = '';
  }
}

// Export backup (JSON) — admin only (index guard hides)
el.btnExport.addEventListener('click', async ()=>{
  try{
    const snap = await getDocs(casesCol);
    const all = [];
    snap.forEach(d=> all.push({ id: d.id, ...d.data() }));
    const blob = new Blob([JSON.stringify({ exportedOn: new Date().toISOString(), cases: all }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kci_cases_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    alert('Export finished.');
  }catch(err){ console.error("Export err",err); alert("Export failed: " + err.message); }
});

// Import backup (JSON) — admin only
el.btnImport.addEventListener('click', ()=> el.importBackupInput.click());
el.importBackupInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  try{
    const text = await f.text();
    const parsed = JSON.parse(text);
    if(!parsed || !Array.isArray(parsed.cases)){
      alert('Invalid backup format.');
      return;
    }
    // confirm
    if(!confirm(`This will overwrite current cases collection. Proceed?`)) return;

    // delete existing then set new
    const existingSnap = await getDocs(casesCol);
    const batchOld = [];
    existingSnap.forEach(d => batchOld.push(d.id));
    for(const id of batchOld){
      await deleteDoc(doc(db, CASES_COLLECTION, id));
    }
    // write new
    for(const c of parsed.cases){
      const id = c.id || c.ID || c.caseId;
      if(!id) continue;
      await setDoc(doc(db, CASES_COLLECTION, id), c);
    }
    alert('Import complete. Reloading view.');
  }catch(err){
    console.error("Import backup err", err);
    alert('Import failed: ' + err.message);
  }finally{ e.target.value = ''; }
});

// start realtime listener
startRealtime();

// set initial UI state for primary filters etc.
buildPrimaryFilters();
