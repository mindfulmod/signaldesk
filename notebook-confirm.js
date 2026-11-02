// A single pending choice: a repeated navigation must never inherit consent.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SIGNALDESK_NOTEBOOK_CONFIRM = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  function create(dialog) {
    let pending = null, origin = null;
    function finish(discard) {
      if (!pending) return;
      const resolve = pending; pending = null;
      if (dialog.open) dialog.close();
      if (!discard && origin?.isConnected) origin.focus({ preventScroll: true });
      origin = null;
      resolve(discard);
    }
    dialog?.addEventListener("click", event => {
      const choice = event.target.closest("[data-notebook-choice]");
      if (choice) finish(choice.dataset.notebookChoice === "discard");
    });
    dialog?.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    dialog?.addEventListener("close", () => { if (!dialog.open) finish(false); });
    return {
      get pending() { return Boolean(pending); },
      request(trigger) {
        if (pending || !dialog?.showModal) return Promise.resolve(false);
        origin = trigger;
        return new Promise(resolve => {
          pending = resolve;
          try {
            dialog.showModal();
            dialog.querySelector('[data-notebook-choice="keep"]').focus();
          } catch { finish(false); }
        });
      },
    };
  }
  return { create };
});
