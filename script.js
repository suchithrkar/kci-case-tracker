// ======== Keys & Constants ========
  const LS_KEY = 'KCI_CASES_V1';
  const FILTERS_KEY = 'KCI_FILTERS_V1';
  const THEME_KEY = 'KCI_THEME_V1';
  const STATUS_OPTIONS = ['Closed','NCM 1','NCM 2','PNS','Service Pending','Monitoring'];

  // ======== State ========
  const state = {
    rows: [],
    raw: loadAll(),
    filters: {
      search:'', status:'', from:'', to:'',
      primaries:{ caseResolutionCode:[], tl:[], sbd:[], caGroup:[], onsiteRFC:[], csrRFC:[], benchRFC:[], country:[] },
      primaryLocks:{ caseResolutionCode:false, tl:false, sbd:false, caGroup:false, onsiteRFC:false, csrRFC:false, benchRFC:false, country:false },
      mode:'normal',            // 'normal'|'due'|'flagged'|'repeat'
      sortByDateAsc:null        // null|true|false
    }
  };

  // Restore saved filters if present
  try{ const saved = JSON.parse(localStorage.getItem(FILTERS_KEY)||'null'); if (saved) Object.assign(state.filters, saved); }catch{}

  // ======== Storage helpers ========
  function saveAll(arr){ localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
  function loadAll(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); }catch{ return []; } }

  // ======== Date helpers ========
  function excelDateToYMD(v){
    if (v==null) return '';
    if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))){
      const epoch = Date.UTC(1899,11,30);
      const ms = Math.round(Number(v) * 86400000);
      const d = new Date(epoch + ms);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth()+1).padStart(2,'0');
      const dd = String(d.getUTCDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const s = String(v).trim();
    const m1 = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})/);
    if (m1){ const dd=m1[1], mm=m1[2], yyyy=m1[3]; return `${yyyy}-${mm}-${dd}`; }
    const d2 = new Date(s); if (!isNaN(d2)){
      const yyyy = d2.getFullYear(); const mm=String(d2.getMonth()+1).padStart(2,'0'); const dd=String(d2.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return '';
  }
  function todayYMD(){ const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function formatDMY(isoDate){
  if(!isoDate) return '';
  const [y,m,d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}


  // ======== UI refs ========
  const el = {
    // header + upload
    btnHamburger: document.getElementById('btnHamburger'),
    btnTheme: document.getElementById('btnTheme'),
    btnUpload: document.getElementById('btnUpload'),
    fileInput: document.getElementById('fileInput'),

    // controls
    txtSearch: document.getElementById('txtSearch'),
    ddlStatusFilter: document.getElementById('ddlStatusFilter'),
    dateFrom: document.getElementById('dateFrom'),
    dateTo: document.getElementById('dateTo'),
    btnApply: document.getElementById('btnApply'),
    btnClear: document.getElementById('btnClear'),

    // set2
    btnDueToday: document.getElementById('btnDueToday'),
    btnFlagged: document.getElementById('btnFlagged'),
    btnRepeating: document.getElementById('btnRepeating'),
    btnSortDate: document.getElementById('btnSortDate'),
btnUnupdated: document.getElementById('btnUnupdated'),
    badgeDue: document.getElementById('badgeDue'),
    badgeFlag: document.getElementById('badgeFlag'),

    // sidebar
    overlay: document.getElementById('overlay'),
    sidebar: document.getElementById('sidebar'),
    filtersContainer: document.getElementById('filtersContainer'),
    btnSideApply: document.getElementById('btnSideApply'),
    btnSideClose: document.getElementById('btnSideClose'),

    // table
    tbody: document.getElementById('tbody'),

    // modal
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
optLastActioned: document.getElementById('optLastActioned'),

    optDate: document.getElementById('optDate'),
    optFlag: document.getElementById('optFlag'),
    optNotes: document.getElementById('optNotes'),
    btnModalSave: document.getElementById('btnModalSave'),
    btnModalClose: document.getElementById('btnModalClose'),

    // toast
    toast: document.getElementById('toast')
  };

  // ======== Theme ========
  const savedTheme = localStorage.getItem(THEME_KEY)||'dark';
  document.documentElement.dataset.theme = savedTheme;
  el.btnTheme.textContent = savedTheme==='light' ? '🌙' : '☀️';
  el.btnTheme.addEventListener('click', ()=>{
    const next = (document.documentElement.dataset.theme==='light') ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    el.btnTheme.textContent = next==='light' ? '🌙' : '☀️';
  });

  // ======== Sidebar open/close ========
  el.btnHamburger.addEventListener('click', ()=>{ el.sidebar.classList.add('open'); el.overlay.classList.add('show'); });
  el.overlay.addEventListener('click', closeSidebar);
  el.btnSideClose.addEventListener('click', closeSidebar);
  function closeSidebar(){ el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }

  // ======== Upload handling ========
  el.btnUpload.addEventListener('click', ()=> el.fileInput.click());

// ✅ Full Environment Backup (Cases + Filters + Theme)
const btnExport = document.getElementById('btnExport');
const btnImport = document.getElementById('btnImport');
const importInput = document.getElementById('importBackupInput');

btnExport.addEventListener('click', ()=>{
  try {
    const cases = JSON.parse(localStorage.getItem('KCI_CASES_V1') || '[]');
    const filters = JSON.parse(localStorage.getItem('KCI_FILTERS_V1') || '{}');
    const theme = localStorage.getItem('KCI_THEME_V1') || 'dark';

    const fullBackup = { 
      version: 1,
      exportedOn: new Date().toISOString(),
      cases,
      filters,
      theme
    };

    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `KCI_FullBackup_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    alert('✅ Full environment backup created successfully!');
  } catch(err){
    alert('Backup failed: ' + err.message);
  }
});

// ✅ Full Environment Restore
btnImport.addEventListener('click', ()=> importInput.click());

importInput.addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) {
      alert('❌ Invalid backup file — missing cases array.');
      return;
    }

    const confirmRestore = confirm(
      `This will overwrite your current tracker data, filters, and theme.\n\n` +
      `Cases: ${parsed.cases.length}\nTheme: ${parsed.theme || 'N/A'}\n\nContinue?`
    );
    if (!confirmRestore) return;

    localStorage.setItem('KCI_CASES_V1', JSON.stringify(parsed.cases || []));
    if (parsed.filters) localStorage.setItem('KCI_FILTERS_V1', JSON.stringify(parsed.filters));
    if (parsed.theme) localStorage.setItem('KCI_THEME_V1', parsed.theme);

    alert('✅ Full backup restored! The page will now reload.');
    location.reload();
  } catch(err){
    alert('Import failed: ' + err.message);
  } finally {
    e.target.value = ''; // reset input
  }
});


  el.fileInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return; const name = file.name.toLowerCase();
    try{
      if (name.endsWith('.xlsx')){
        if (typeof XLSX === 'undefined'){
          alert('To import .xlsx directly, paste SheetJS (xlsx.mini.min.js) into the placeholder script tag. For now, please upload CSV.');
          return;
        }
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, {header:1, raw:true});
        handleGridUpload(data);
      } else if (name.endsWith('.csv')){
        const text = await file.text();
        const rows = text.split(/\r?\n/).map(r=>r.split(','));
        handleGridUpload(rows);
      } else {
        alert('Unsupported file type. Upload .xlsx or .csv');
      }
    } finally { e.target.value = ''; }
  });

  function handleGridUpload(grid){
    if (!grid || !grid.length){ alert('Empty file.'); return; }
    const header = grid[0].map(h=>String(h||'').trim());

    // Expected columns subset by fixed positions
    const idx = {A:0,B:1,C:2,D:3,G:6,I:8,J:9,R:17,U:20,AD:29,AH:33,AI:34,AJ:35};

    const incoming = new Map(); let totalRows = 0;
    for (let r=1; r<grid.length; r++){
      const row = grid[r]; if (!row || row.length===0) continue;
      const id = String(row[idx.A]||'').trim(); if(!id) continue;
      const rec = {
        id,
        customerName: String(row[idx.B]||'').trim(),
        createdOn: excelDateToYMD(row[idx.C]),
        createdBy: String(row[idx.D]||'').trim(),
        country: String(row[idx.G]||'').trim(),
        caseResolutionCode: String(row[idx.I]||'').trim(),
        caseOwner: String(row[idx.J]||'').trim(),
        caGroup: String(row[idx.R]||'').trim(),
        tl: String(row[idx.U]||'').trim(),
        sbd: String(row[idx.AD]||'').trim(),
        onsiteRFC: String(row[idx.AH]||'').trim(),
        csrRFC: String(row[idx.AI]||'').trim(),
        benchRFC: String(row[idx.AJ]||'').trim(),
        status: '', followDate: null, flagged:false, notes:''
      };
      incoming.set(id, rec); totalRows++;
    }

    const prev = loadAll(); const prevMap = new Map(prev.map(p=>[p.id,p]));
    const toDelete = prev.filter(p=>!incoming.has(p.id));

    const merged = []; let newCount=0, updatedCount=0;
    for (const [id, rec] of incoming){
      const old = prevMap.get(id);
      if (old){
        merged.push({...rec, status:old.status||'', followDate:old.followDate||null, flagged:!!old.flagged, notes:old.notes||'',lastActionedOn: old.lastActionedOn || null});
        updatedCount++;
      } else { merged.push(rec); newCount++; }
    }

    saveAll(merged); state.raw = merged; buildPrimaryFilters(); applyFilters();
    alert(`Imported ${totalRows} cases. Deleted ${toDelete.length}. Added ${newCount}. Updated ${updatedCount}.`);
  }

  // ======== Primary Filters ========
  const PRIMARY_SPECS = [
    { key:'caseResolutionCode', label:'Case Resolution Code', options:['Onsite Solution','Offsite Solution','Parts Shipped'] },
    { key:'tl', label:'TL', options:['Aarthi','Sandeep','Ratan'] },
    { key:'sbd', label:'SBD', options:['Met','Not Met','NA'] },
    { key:'caGroup', label:'CA Group', options:['0-3 Days','3-5 Days','5-10 Days','10-14 Days','15-30 Days','30-60 Days','60-90 Days','> 90 Days'] },
    { key:'onsiteRFC', label:'Onsite RFC Status', options:['Closed - Canceled','Closed - Posted','Open - Completed','Open - In Progress','Open - Scheduled','Open - Unscheduled'] },
    { key:'csrRFC', label:'CSR RFC Status', options:['Cancelled','Closed','POD','New','Order Pending','Ordered','Shipped'] },
    { key:'benchRFC', label:'Bench RFC Status', options:['Possible completed','Repair Pending'] },
    { key:'country', label:'Country', options:['Austria','Belgium','Czech Republic','Denmark','Germany','Hungary','Ireland','Jersey','Netherlands','Nigeria','Norway','South Africa','Sweden','Switzerland','United Kingdom','Luxembourg','Poland'] }
  ];

  function buildPrimaryFilters(){
    const fc = el.filtersContainer; fc.innerHTML='';
    PRIMARY_SPECS.forEach(spec=>{
      const blk = document.createElement('div'); blk.className='filter-block'; blk.dataset.key = spec.key;
      if (state.filters.primaryLocks[spec.key]) blk.classList.add('filter-locked');
      const optionsHtml = spec.options.map(opt=>{
        const sel = state.filters.primaries[spec.key]?.includes(opt);
        return `<label class="chip"><input type="checkbox" data-key="${spec.key}" value="${opt.replace(/"/g,'&quot;')}" ${sel?'checked':''}/> ${opt}</label>`
      }).join('');
      blk.innerHTML = `
        <div class="filter-head" data-action="toggle">
          <div class="filter-title">${spec.label}</div>
          <div class="flex">
            <span class="lock" data-action="lock" title="Lock/Unlock">${state.filters.primaryLocks[spec.key]?'🔒':'🔓'}</span>
            <span>▾</span>
          </div>
        </div>
        <div class="filter-body"><div class="chips">${optionsHtml}</div></div>`;
      fc.appendChild(blk);
    });
  }

  el.filtersContainer.addEventListener('click', (e)=>{
    const head = e.target.closest('[data-action]'); const blk = e.target.closest('.filter-block'); if(!blk) return; const key = blk.dataset.key;
    if (head?.dataset.action==='toggle') blk.querySelector('.filter-body').classList.toggle('open');
    if (head?.dataset.action==='lock'){ state.filters.primaryLocks[key] = !state.filters.primaryLocks[key]; buildPrimaryFilters(); }
  });
  el.filtersContainer.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type=checkbox]'); if(!cb) return; const key = cb.dataset.key, val = cb.value; const set = new Set(state.filters.primaries[key]||[]);
    if (cb.checked) set.add(val); else set.delete(val); state.filters.primaries[key] = [...set];
  });

  el.btnSideApply.addEventListener('click', ()=>{ applyFilters(); closeSidebar(); });

  // ======== Set 1 & Set 2 ========
  el.btnApply.addEventListener('click', applyFilters);
  el.btnClear.addEventListener('click', ()=>{
    state.filters.search=''; el.txtSearch.value='';
    state.filters.status=''; el.ddlStatusFilter.value='';
    state.filters.from=''; el.dateFrom.value='';
    state.filters.to=''; el.dateTo.value='';
    state.filters.mode='normal';
    state.filters.sortByDateAsc = null;
    for (const spec of PRIMARY_SPECS){ if (!state.filters.primaryLocks[spec.key]) state.filters.primaries[spec.key]=[]; }
    buildPrimaryFilters(); applyFilters();
  });

  el.btnDueToday.addEventListener('click', ()=>{ state.filters.mode='due'; applyFilters(); });
  el.btnFlagged.addEventListener('click', ()=>{ state.filters.mode='flagged'; applyFilters(); });
  el.btnRepeating.addEventListener('click', ()=>{ state.filters.mode='repeat'; applyFilters(); });
  el.btnSortDate.addEventListener('click', ()=>{
    if (state.filters.sortByDateAsc===null) state.filters.sortByDateAsc=false; else state.filters.sortByDateAsc=!state.filters.sortByDateAsc; applyFilters();
  });
// 📝 Unupdated Cases (Status empty)
el.btnUnupdated.addEventListener('click', ()=>{
  state.filters.mode = 'unupdated';
  applyFilters();
});


  // type-to-apply convenience
  el.txtSearch.addEventListener('input', (e)=>{ state.filters.search = e.target.value.trim(); });
  el.txtSearch.addEventListener('keydown', (e)=>{ if(e.key==='Enter') applyFilters(); });
  el.ddlStatusFilter.addEventListener('change', (e)=>{ state.filters.status = e.target.value; });
  el.dateFrom.addEventListener('change', (e)=>{ state.filters.from = e.target.value; });
  el.dateTo.addEventListener('change', (e)=>{ state.filters.to = e.target.value; });

  // ======== Filtering + Rendering ========
  function applyFilters(){
    const f = state.filters; const tdy = todayYMD();
    let rows = [...state.raw];

    // Set1 filters
    if (f.search){ const q = f.search.toLowerCase(); rows = rows.filter(r=> Object.values({id:r.id,customerName:r.customerName,country:r.country,crc:r.caseResolutionCode,owner:r.caseOwner,ca:r.caGroup,sbd:r.sbd,tl:r.tl,ons:r.onsiteRFC,csr:r.csrRFC,bench:r.benchRFC,notes:r.notes}).some(v=> String(v||'').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter(r=> (r.status||'')===f.status);
    if (f.from) rows = rows.filter(r=> (r.createdOn||'') >= f.from);
    if (f.to) rows = rows.filter(r=> (r.createdOn||'') <= f.to);

    // Primary filters (OR within, AND across)
    const prim = f.primaries; function applyPrimary(arr, key){ const sel=prim[key]||[]; if(!sel.length) return arr; return arr.filter(r=> sel.includes(String(r[key]||''))); }
    rows = applyPrimary(rows,'caseResolutionCode'); rows = applyPrimary(rows,'tl'); rows = applyPrimary(rows,'sbd'); rows = applyPrimary(rows,'caGroup'); rows = applyPrimary(rows,'onsiteRFC'); rows = applyPrimary(rows,'csrRFC'); rows = applyPrimary(rows,'benchRFC'); rows = applyPrimary(rows,'country');

    // Modes
    if (f.mode==='due') rows = rows.filter(r=> (r.followDate||'').trim()===tdy && r.status && r.status!=='Closed');
    else if (f.mode==='flagged') rows = rows.filter(r=> !!r.flagged);
    else if (f.mode==='repeat'){
      const counts = new Map(); rows.forEach(r=> counts.set(r.customerName, (counts.get(r.customerName)||0)+1));
      rows = rows.filter(r=> (counts.get(r.customerName)||0)>1).sort((a,b)=> String(a.customerName||'').localeCompare(String(b.customerName||'')) );
    }else if (f.mode==='unupdated') {
  rows = rows.filter(r=> !r.status || r.status.trim()==='');
}


    // Sort by creation date
    if (f.sortByDateAsc!==null){ rows.sort((a,b)=>{ const da=a.createdOn||''; const db=b.createdOn||''; if (da===db) return 0; return f.sortByDateAsc ? (da<db?-1:1) : (da>db?-1:1); }); }

    state.rows = rows; render(); refreshBadges();

    // Persist current filters
    try{ localStorage.setItem(FILTERS_KEY, JSON.stringify(state.filters)); }catch{}
  }

  function refreshBadges(){
    const all = loadAll(); const tdy = todayYMD();
    const due = all.filter(r=> (r.followDate||'').trim()===tdy && r.status && r.status!=='Closed').length;
    const flagged = all.filter(r=> !!r.flagged).length;
    el.badgeDue.textContent = String(due); el.badgeFlag.textContent = String(flagged);
  }

  function render(){
    const tb = el.tbody; tb.innerHTML=''; const tdy = todayYMD();
    state.rows.forEach((r, idx)=>{
      const tr = document.createElement('tr');
      // Highlight priority: Due Today > Flagged > Notes
if ((r.followDate || '').trim() === tdy) {
  tr.classList.add('due-today');
} else if (r.flagged) {
  tr.classList.add('flagged');
} else if (r.notes && r.notes.trim()) {
  tr.classList.add('has-notes');
}

      tr.innerHTML = `
        <td class="sno">${idx+1}</td>
        <td class="caseid">${r.id}</td>
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

  function renderStatusSelect(id, val){
    return `<select class="status-select" data-action="status" data-id="${id}">` +
           `<option value=""></option>` +
           STATUS_OPTIONS.map(o=>`<option ${val===o?'selected':''}>${o}</option>`).join('') +
           `</select>`;
  }

  function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

  // ======== Row events ========
  el.tbody.addEventListener('change', (e)=>{
    const sel = e.target.closest('select[data-action=status]'); if (!sel) return;
    const id = sel.dataset.id; const val = sel.value; const all = loadAll(); const r = all.find(x=>x.id===id); if(!r) return; r.status = val; r.lastActionedOn = new Date().toISOString().split('T')[0];
saveAll(all); state.raw = all; refreshBadges();
  });

  el.tbody.addEventListener('click', (e)=>{ const gear = e.target.closest('[data-action=opts]'); if (!gear) return; openModalFor(gear.dataset.id); });

  // Double-click to copy Case ID
  document.addEventListener('dblclick', (e)=>{
    const cell = e.target.closest('.caseid'); if(!cell) return; const text = cell.textContent.trim();
    navigator.clipboard.writeText(text).then(()=>{ el.toast.classList.add('show'); setTimeout(()=> el.toast.classList.remove('show'), 1000); });
  });

  // ======== Modal ========
  let modalId = null;
  function openModalFor(id){ const all = loadAll(); const r = all.find(x=>x.id===id); if(!r) return; modalId=id; el.modalTitle.textContent = `Case Options - ${id}`; el.optLastActioned.textContent = r.lastActionedOn
  ? formatDMY(r.lastActionedOn)
  : '—';

 el.optDate.value = r.followDate||''; setFlag(r.flagged); el.optNotes.value = r.notes||''; el.modal.classList.add('show'); }
  function closeModal(){ el.modal.classList.remove('show'); modalId=null; }
  el.btnModalClose.addEventListener('click', closeModal);
  el.modal.addEventListener('click', (e)=>{ if(e.target===el.modal) closeModal(); });
  el.optFlag.addEventListener('click', ()=> setFlag(!el.optFlag.classList.contains('on')));
  function setFlag(on){ el.optFlag.classList.toggle('on', on); el.optFlag.setAttribute('aria-checked', on?'true':'false'); }

  el.btnModalSave.addEventListener('click', ()=>{
    if (!modalId) return; const all = loadAll(); const r = all.find(x=>x.id===modalId); if(!r) return;
    r.followDate = el.optDate.value ? new Date(el.optDate.value).toISOString().split('T')[0] : null; // normalize
    r.flagged = el.optFlag.classList.contains('on');
    r.notes = el.optNotes.value.trim();
r.lastActionedOn = new Date().toISOString().split('T')[0];
    saveAll(all); state.raw = all; refreshBadges(); applyFilters(); closeModal();
  });

  // ======== Smart tooltip edge handling ========
  document.querySelectorAll('.icon-btn').forEach(btn=>{
    const tip = btn.querySelector('.tooltip'); if(!tip) return;
    btn.addEventListener('mouseenter', ()=>{
      tip.style.left='50%'; tip.style.right='auto'; tip.style.transform='translateX(-50%)';
      const rect = tip.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8){ tip.style.left='auto'; tip.style.right='0'; tip.style.transform='translateX(0)'; }
      if (rect.left < 8){ tip.style.left='0'; tip.style.right='auto'; tip.style.transform='translateX(0)'; }
    });
  });

  // ======== Init ========
  buildPrimaryFilters();
  // Set input values from state.filters
  el.txtSearch.value = state.filters.search||''; el.ddlStatusFilter.value = state.filters.status||''; el.dateFrom.value = state.filters.from||''; el.dateTo.value = state.filters.to||'';
  applyFilters();
  refreshBadges();