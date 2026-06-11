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
  const btnUpdateData =
    document.getElementById("btnUpdateData");

  const modalUpdateData =
    document.getElementById("modalUpdateData");

  const btnUpdateClose =
    document.getElementById("btnUpdateClose");

  if (btnUpdateData) {
    btnUpdateData.addEventListener("click", () => {
      modalUpdateData.classList.add("show");
    });
  }

  if (btnUpdateClose) {
    btnUpdateClose.addEventListener("click", () => {
      modalUpdateData.classList.remove("show");
    });
  }
}
