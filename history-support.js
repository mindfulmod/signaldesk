(() => {
  function savedSnapshotCount() {
    return Array.isArray(window.SIGNALDESK_HISTORY?.snapshots) ? window.SIGNALDESK_HISTORY.snapshots.length : 0;
  }

  function selectedRangeLabel() {
    const active = document.querySelector(".preset.active");
    return active?.textContent?.trim() || "1D";
  }

  function updateRangeNote() {
    const note = document.getElementById("rangeNote");
    if (!note) return;
    const count = savedSnapshotCount();
    const label = selectedRangeLabel();
    if (count <= 1) {
      note.textContent = `${label} view has ${count} saved daily snapshot${count === 1 ? "" : "s"}. Longer ranges become stronger after daily refreshes accumulate.`;
      return;
    }
    note.textContent = `${label} view can use ${count} saved daily snapshots from the refresh history.`;
  }

  function boot() {
    updateRangeNote();
    document.querySelectorAll(".preset").forEach((button) => button.addEventListener("click", () => setTimeout(updateRangeNote, 0)));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
