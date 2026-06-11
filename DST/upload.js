/* ======================================================
   DST Upload Engine
   ====================================================== */

export const uploadState = {
  selectedTeam: null,
  file: null,
  previewData: [],
  firestoreData: [],
  diff: null
};

export function initializeUploadModule() {
  bindUploadEvents();
}

function bindUploadEvents() {
  const btn = document.getElementById("btnUpdateData");
  const modal = document.getElementById("modalUpdateData");
  const closeBtn = document.getElementById("btnUpdateClose");

  if (btn) {
    btn.addEventListener("click", () => {
      modal.classList.add("show");
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.classList.remove("show");
    });
  }
}
