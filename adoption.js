(() => {
  const data = window.SIGNALDESK_ADOPTION;
  const container = document.getElementById("adoptionFeed");
  if (!data || !container) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const key = "signaldesk-adoption-followed-v1";
  let followed = new Set();
  try { followed = new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { /* optional persistence */ }
  const overdue = Date.now() > new Date(data.reviewDue + "T23:59:59Z").getTime();
  document.getElementById("adoptionReview").textContent = `${overdue ? "Review overdue" : "Manually reviewed"} · ${data.reviewedAt} · next review ${data.reviewDue}. These are research hypotheses, not live adoption feeds or stock recommendations.`;
  container.innerHTML = data.themes.map(theme => `
    <article class="adoption-card">
      <div class="adoption-card-top"><span class="section-kicker">${esc(theme.category)}</span><button type="button" class="adoption-follow" data-theme="${esc(theme.id)}" aria-label="Follow ${esc(theme.name)}" aria-pressed="${followed.has(theme.id)}">${followed.has(theme.id) ? "Following" : "Follow"}</button></div>
      <h3>${esc(theme.name)}</h3><p class="adoption-horizon">${esc(theme.horizon)}</p>
      <p class="adoption-proof">${esc(theme.headline)}</p>
      <p>${esc(theme.thesis)}</p>
      <details><summary>Evidence & what to watch</summary>
        <ol class="adoption-evidence">${theme.evidence.map(e => `<li><strong>${esc(e.display)} · ${esc(e.metric)}</strong><span>${esc(e.period)} · published ${esc(e.publishedAt)}</span><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.publisher)} source ↗</a><p>${esc(e.caveat)}</p></li>`).join("")}</ol>
        <h4>Next evidence to check</h4><p>${esc(theme.nextCheck)}</p>
        <h4>What could break the thesis</h4><p>${esc(theme.risk)}</p>
        <p class="adoption-companies">Related businesses: ${esc(theme.companies)}. Revenue exposure and valuation need separate research.</p>
      </details>
    </article>`).join("");
  container.addEventListener("click", event => {
    const button = event.target.closest(".adoption-follow");
    if (!button) return;
    const id = button.dataset.theme;
    if (followed.has(id)) followed.delete(id); else followed.add(id);
    try { localStorage.setItem(key, JSON.stringify([...followed])); } catch { /* remains usable in this session */ }
    button.setAttribute("aria-pressed", String(followed.has(id)));
    button.textContent = followed.has(id) ? "Following" : "Follow";
    document.getElementById("adoptionFollowStatus").textContent = `${followed.size} theme${followed.size === 1 ? "" : "s"} followed on this browser. No push notifications or automatic metric updates.`;
  });
})();
