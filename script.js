// script.js (type=module)
// ======================= FIRESTORE-SYNCED TRACKER LOGIC =======================
import { app } from "./firebase-init.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, query
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const db = getFirestore(app);
const auth = getAuth(app);

// UI refs
const el = {
  fileInput: document.getElementById('fileInput'),
  btnUpload: document.getElementById('btnUpload'),
  btnExport: document.getElementById('btnExport'),
  btnImport: document.getElementById('btnImport'),
  importBackupInput: document.getElementById('importBackupInput'),
  btnLogout: document.getElementById('btnLogout'),

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
  btnSideApply: document.getElementById('btnSideApply'),
  btnSideClose: document.getElementById('btnSideClose'),
  filtersContainer: document.getElementById('filtersContainer'),

  tbody: document.getElementById('tbody'),

  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  optDate: document.getElementById('optDate'),
  optFlag: document.getElementById('optFlag'),
  optNotes: document.getElementById('optNotes'),
  optLastActioned: document.getElementById('optLastActioned'),
  btnModalSave: document.getElementById('btnModalSave'),
  btnModalClose: document.getElementById('btnModalClose'),

  toast: document.getElementById('toast'),
  btnTheme: document.getElementById('btnTheme'),
  btnHamburger: document.getElementById('btnHamburger'),
};

// State
let allCases = [];
let state = {
  rows: [],
  filters: { search:'', status:'', from:'', to:'', mode:'normal', sortByDateAsc:null }
};

const CASES_COLLECTION = "cases";

// ---------- Helpers ----------
function todayYMD(){ const d=new Date(); return d.toISOString().split('T')[0]; }
function formatDMY(iso){ if(!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}-${m}-${y}`; }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function toast(msg='Copied!'){ el.toast.textContent = msg; el.toast.classList.add('show'); setTimeout(()=>el.toast.classList.remove('show'), 1100); }

// ---------- Load cases ----------
export async function loadAllCases(){
  try{
    const snap = await getDocs(collection(db, CASES_COLLECTION));
    allCases = [];
    snap.forEach(s => allCases.push({ id: s.id, ...s.data() }));
    applyFilters(); // render
  } catch(err){
    console.error("Error loading cases:", err);
  }
}

// ---------- Render ----------
function render(){
  const tb = el.tbody; tb.innerHTML = '';
  const tdy = todayYMD();
  state.rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    if ((r.followDate||'') === tdy) tr.classList.add('due-today');
    else if (r.flagged) tr.classList.add('flagged');
    else if (r.notes && r.notes.trim()) tr.classList.add('has-notes');

    tr.innerHTML = `
      <td class="sno">${idx+1}</td>
      <td class="caseid">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td>${escapeHtml(r.caseResolutionCode)}</td>
      <td>${escapeHtml(r.caseOwner)}</td>
      <td>${escapeHtml(r.caGroup)}</td>
      <td>${escapeHtml(r.sbd)}</td>
      <td>${renderStatusSelect(r.id, r.status)}</td>
      <td class="right"><span class="gear" title="Case Options" data-action="opts" data-id="${r.id}">⚙️</span></td>`;
    tb.appendChild(tr);
  });
}

function renderStatusSelect(id,val){
  const opts = ['','Closed','NCM 1','NCM 2','PNS','Service Pending','Monitoring'];
  return `<select class="status-select" data-id="${id}">${opts.map(o=>`<option ${val===o?'selected':''}>${o}</option>`).join('')}</select>`;
}

// ---------- Filtering ----------
function applyFilters(){
  const f = state.filters; const tdy = todayYMD();
  let rows = [...allCases];

  if (f.search){ const q=f.search.toLowerCase(); rows = rows.filter(r=> Object.values({id:r.id,customerName:r.customerName,country:r.country,crc:r.caseResolutionCode,owner:r.caseOwner,ca:r.caGroup,sbd:r.sbd,tl:r.tl,notes:r.notes}).some(v=>String(v||'').toLowerCase().includes(q))); }
  if (f.status) rows = rows.filter(r=> (r.status||'')===f.status);
  if (f.from) rows = rows.filter(r=> (r.createdOn||'') >= f.from);
  if (f.to) rows = rows.filter(r=> (r.createdOn||'') <= f.to);

  if (f.mode === 'due') rows = rows.filter(r=> (r.followDate||'').trim()===tdy && r.status && r.status!=='Closed');
  else if (f.mode === 'flagged') rows = rows.filter(r=> !!r.flagged);
  else if (f.mode === 'repeat'){
    const counts = new Map(); rows.forEach(r=> counts.set(r.customerName, (counts.get(r.customerName)||0)+1));
    rows = rows.filter(r=> (counts.get(r.customerName)||0)>1).sort((a,b)=> String(a.customerName||'').localeCompare(String(b.customerName||'')));
  } else if (f.mode==='unupdated'){
    rows = rows.filter(r=> !r.status || r.status.trim()==='');
  }

  if (f.sortByDateAsc !== null){
    rows.sort((a,b)=>{ const da=a.createdOn||''; const db=b.createdOn||''; if (da===db) return 0; return f.sortByDateAsc ? (da<db?-1:1) : (da>db?-1:1); });
  }

  state.rows = rows;
  render();
  refreshBadges();
}

// ---------- Badges ----------
function refreshBadges(){
  const tdy = todayYMD();
  const due = allCases.filter(r=> (r.followDate||'').trim()===tdy && r.status && r.status!=='Closed').length;
  const flagged = allCases.filter(r=> !!r.flagged).length;
  el.badgeDue.textContent = String(due);
  el.badgeFlag.textContent = String(flagged);
}

// ---------- Events: table (status change + options click) ----------
el.tbody.addEventListener('change', async (e)=>{
  const sel = e.target.closest('select.status-select'); if(!sel) return;
  const id = sel.dataset.id; const val = sel.value;
  try{
    await updateDoc(doc(db, CASES_COLLECTION, id), { status: val, lastActionedOn: todayYMD(), updatedBy: auth.currentUser?.email || 'unknown' });
    // update local
    const idx = allCases.findIndex(x=>x.id===id); if (idx!==-1){ allCases[idx].status = val; allCases[idx].lastActionedOn = todayYMD(); }
    applyFilters();
  }catch(err){ console.error("Error updating status:", err); alert("Error updating status: "+err.message); }
});

el.tbody.addEventListener('click', (e)=>{
  const gear = e.target.closest('[data-action=opts]'); if(!gear) return;
  openModalFor(gear.dataset.id);
});

// double click copy case id
document.addEventListener('dblclick', (e)=>{
  const cell = e.target.closest('.caseid'); if(!cell) return;
  navigator.clipboard.writeText(cell.textContent.trim()).then(()=>toast('Copied ID'));
});

// ---------- Modal ----------
let modalId = null;
function openModalFor(id){
  const r = allCases.find(x=>x.id===id); if(!r) return;
  modalId = id; el.modalTitle.textContent = `Case Options - ${id}`;
  el.optLastActioned.textContent = r.lastActionedOn ? formatDMY(r.lastActionedOn) : '—';
  el.optDate.value = r.followDate || '';
  setFlagToggle(!!r.flagged);
  el.optNotes.value = r.notes || '';
  el.modal.classList.add('show');
}
function closeModal(){ el.modal.classList.remove('show'); modalId = null; }
el.btnModalClose.addEventListener('click', closeModal);
el.modal.addEventListener('click', (e)=>{ if (e.target === el.modal) closeModal(); });

function setFlagToggle(on){ el.optFlag.classList.toggle('on', on); el.optFlag.setAttribute('aria-checked', on?'true':'false'); }
el.optFlag.addEventListener('click', ()=> setFlagToggle(!el.optFlag.classList.contains('on')));

el.btnModalSave.addEventListener('click', async ()=>{
  if (!modalId) return;
  try{
    const updates = {
      followDate: el.optDate.value ? el.optDate.value : null,
      flagged: el.optFlag.classList.contains('on'),
      notes: el.optNotes.value.trim(),
      lastActionedOn: todayYMD(),
      updatedBy: auth.currentUser?.email || 'unknown'
    };
    await updateDoc(doc(db, CASES_COLLECTION, modalId), updates);
    // update local copy
    const idx = allCases.findIndex(x=>x.id===modalId);
    if (idx!==-1) Object.assign(allCases[idx], updates);
    applyFilters();
    closeModal();
  }catch(err){
    console.error("Error saving modal:", err);
    alert("Error saving: " + err.message);
  }
});

// ---------- Upload / Export / Import UI & Admin-only visibility ----------
async function ensureAdminEmail(){
  try{
    const s = await getDoc(doc(db, "settings", "access"));
    return s.exists() ? s.data().adminEmail : null;
  }catch(e){ console.error("err",e); return null; }
}

async function setupAdminControls() {
  const adminEmail = await ensureAdminEmail();
  const user = auth.currentUser;

  // show/hide admin-only controls
  if (user && user.email === adminEmail) {
    // admin sees buttons
    [el.btnUpload, el.btnExport, el.btnImport].forEach(b=>{ if(b) b.style.display='inline-block'; });
    // add admin dashboard link
    const header = document.querySelector('.header');
    if (header && !document.getElementById('adminBtn')) {
      const btn = document.createElement('button');
      btn.id = 'adminBtn';
      btn.className = 'upload-btn';
      btn.textContent = 'Admin Dashboard';
      btn.addEventListener('click', ()=> window.location.href = 'admin.html');
      header.insertBefore(btn, el.btnTheme);
    }
  } else {
    // hide admin-only features
    [el.btnUpload, el.btnExport, el.btnImport].forEach(b=>{ if(b) b.style.display='none'; });
  }
}

// Import Excel (admin only)
el.btnUpload.addEventListener('click', ()=> el.fileInput.click());
el.fileInput.addEventListener('change', handleExcelUpload);

async function handleExcelUpload(e){
  const f = e.target.files && e.target.files[0]; if(!f) return;
  const user = auth.currentUser;
  if (!user) return alert('Please sign in.');
  const adminEmail = await ensureAdminEmail();
  if (user.email !== adminEmail) return alert('Only admin can upload Excel.');

  try{
    if (typeof XLSX === 'undefined') throw new Error('XLSX not loaded');
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    const excelIds = new Set();

    // fetch existing ids to decide deletions
    const existingSnap = await getDocs(collection(db, CASES_COLLECTION));
    const existingIds = new Set();
    existingSnap.forEach(s => existingIds.add(s.id));

    let added=0, updated=0;
    for (const r of rows){
      const id = String(r['Case ID'] || r['CaseID'] || r['id'] || '').trim();
      if (!id) continue;
      excelIds.add(id);
      const caseDoc = {
        customerName: r['Full Name (Primary Contact) (Contact)'] || r['Customer Name'] || '',
        createdOn: (r['Created On'] && typeof r['Created On'] === 'string') ? r['Created On'].split(' ')[0] : (r['Created On']||''),
        createdBy: r['Created By'] || '',
        country: r['Country'] || '',
        caseResolutionCode: r['Case Resolution Code'] || '',
        caseOwner: r['Full Name (Owning User) (User)'] || '',
        caGroup: r['CA Group'] || '',
        sbd: r['SBD'] || '',
        onsiteRFC: r['Onsite RFC Status'] || '',
        csrRFC: r['CSR RFC Status'] || '',
        benchRFC: r['Bench RFC Status'] || '',
        // preserve status/followDate/flagged/notes if present — merge:true will keep them
        lastActionedOn: null,
        updatedBy: ''
      };
      const ref = doc(db, CASES_COLLECTION, id);
      await setDoc(ref, caseDoc, { merge: true });
      if (existingIds.has(id)) updated++; else added++;
    }

    // delete missing
    let deleted=0;
    for (const oldId of existingIds){
      if (!excelIds.has(oldId)){
        await deleteDoc(doc(db, CASES_COLLECTION, oldId));
        deleted++;
      }
    }

    alert(`Import done. Added: ${added}, Updated: ${updated}, Deleted: ${deleted}`);
    await loadAllCases();
  }catch(err){
    console.error("Error importing Excel:", err);
    alert("Error importing Excel: " + err.message);
  } finally {
    el.fileInput.value = '';
  }
}

// Export backup (admin)
el.btnExport.addEventListener('click', async ()=>{
  const user = auth.currentUser; const adminEmail = await ensureAdminEmail();
  if (!user || user.email !== adminEmail) return alert('Admin only');
  try{
    const snap = await getDocs(collection(db, CASES_COLLECTION));
    const data = [];
    snap.forEach(s=> data.push({ id: s.id, ...s.data() }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `KCI_Backup_${todayYMD()}.json`; a.click();
  }catch(err){ alert('Export failed: '+err.message); }
});

// Import backup (admin)
el.btnImport.addEventListener('click', ()=> el.importBackupInput.click());
el.importBackupInput.addEventListener('change', async (e)=>{
  const f = e.target.files && e.target.files[0]; if(!f) return;
  const user = auth.currentUser; const adminEmail = await ensureAdminEmail();
  if (!user || user.email !== adminEmail) return alert('Admin only');
  try{
    const txt = await f.text(); const data = JSON.parse(txt);
    for (const item of data){
      if (!item.id) continue;
      await setDoc(doc(db, CASES_COLLECTION, item.id), item, { merge: true });
    }
    alert('Backup imported');
    await loadAllCases();
  }catch(err){ alert('Import failed: '+err.message); }
  finally{ el.importBackupInput.value=''; }
});

// ---------- Sidebar, theme, hamburger ----------
el.btnHamburger.addEventListener('click', ()=>{ el.sidebar.classList.add('open'); el.overlay.classList.add('show'); });
el.btnSideClose.addEventListener('click', ()=>{ el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); });
el.overlay.addEventListener('click', ()=>{ el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); });

el.btnTheme.addEventListener('click', ()=>{
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('KCI_THEME_V1', next);
  el.btnTheme.textContent = next === 'light' ? '🌙' : '☀️';
});

// ---------- Set1 & Set2 handlers ----------
el.btnApply.addEventListener('click', ()=>{ state.filters.search = el.txtSearch.value.trim(); state.filters.status = el.ddlStatusFilter.value; state.filters.from = el.dateFrom.value; state.filters.to = el.dateTo.value; applyFilters(); });
el.btnClear.addEventListener('click', ()=>{ el.txtSearch.value=''; el.ddlStatusFilter.value=''; el.dateFrom.value=''; el.dateTo.value=''; state.filters = { search:'', status:'', from:'', to:'', mode:'normal', sortByDateAsc:null }; applyFilters(); });

el.btnDueToday.addEventListener('click', ()=>{ state.filters.mode='due'; applyFilters(); });
el.btnFlagged.addEventListener('click', ()=>{ state.filters.mode='flagged'; applyFilters(); });
el.btnRepeating.addEventListener('click', ()=>{ state.filters.mode='repeat'; applyFilters(); });
el.btnSortDate.addEventListener('click', ()=>{ if (state.filters.sortByDateAsc===null) state.filters.sortByDateAsc=false; else state.filters.sortByDateAsc=!state.filters.sortByDateAsc; applyFilters(); });
el.btnUnupdated.addEventListener('click', ()=>{ state.filters.mode='unupdated'; applyFilters(); });

// ---------- Logout ----------
el.btnLogout.addEventListener('click', async ()=>{
  await signOut(auth);
  localStorage.clear();
  window.location.replace('login.html');
});

// ---------- onAuthState to setup admin controls & initial load ----------
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
onAuthStateChanged(auth, async (user)=>{
  if (user) {
    await setupAdminControls();
    await loadAllCases();
  }
});

// Initialize theme from storage
(() => {
  const saved = localStorage.getItem('KCI_THEME_V1') || 'dark';
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
  el.btnTheme.textContent = saved === 'light' ? '🌙' : '☀️';
})();
