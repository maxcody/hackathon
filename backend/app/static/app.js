const number = new Intl.NumberFormat("en-US");
const byId = (id) => document.getElementById(id);
let portalSyncTimer = null;
let portalSyncInFlight = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.detail || `Request failed (${response.status})`);
  }
  return response.json();
}

function renderBrief(brief) {
  const imported = brief.data?.imported;
  byId("data-status").textContent = imported ? `${brief.data.file_count} files · ${brief.data.row_count} rows indexed` : "Kickoff baseline only";
  byId("data-detail").textContent = imported
    ? `Last imported ${new Date(brief.data.imported_at).toLocaleString()}. ${brief.data.warning_count} files need parser review.${brief.data.portal_sync_enabled ? " Auto-checks every 5 minutes." : ""}`
    : brief.data?.portal_sync_enabled
      ? "Portal sync is enabled. The first snapshot will be imported automatically."
      : "Import the Soony archive to inspect orders, suppliers, shipments, and new data drops.";
  if (brief.data?.portal_sync_enabled && portalSyncTimer === null) {
    portalSyncTimer = window.setInterval(() => syncPortal(true), 5 * 60 * 1000);
    syncPortal(true);
  }
  byId("required").textContent = number.format(brief.summary.required);
  byId("packed").textContent = number.format(brief.summary.packed);
  byId("remaining").textContent = number.format(brief.summary.remaining);
  byId("completion").textContent = `${brief.summary.completion_pct}%`;
  byId("overall-progress").style.width = `${brief.summary.completion_pct}%`;

  byId("editions").innerHTML = brief.editions.map((edition) => {
    const collector = edition.edition.includes("Collector");
    const riskLabel = collector ? "HIGHEST GAP" : "OPEN GAP";
    return `<article class="edition-card ${collector ? "collector" : ""}">
      <div class="edition-top"><span class="edition-name">${escapeHtml(edition.edition)}</span><span class="edition-risk">${riskLabel}</span></div>
      <div class="edition-numbers"><strong>${number.format(edition.packed)}</strong><span>packed</span><small>/ ${number.format(edition.required)} required</small></div>
      <div class="edition-track"><span style="width:${edition.completion_pct}%"></span></div>
      <div class="edition-bottom"><span>${edition.completion_pct}% complete</span><strong>${number.format(edition.remaining)} still to pack</strong></div>
    </article>`;
  }).join("");

  byId("risk-count").textContent = `${String(brief.risks.length).padStart(2, "0")} PRIORITIES`;
  byId("risks").innerHTML = brief.risks.map((risk) => {
    const edition = risk.title.startsWith("Collector") ? "Collector's Edition" : "Standard";
    const canDraft = risk.title.includes("Collector") || risk.title.includes("Standard edition");
    return `<article class="risk-card ${risk.severity}"><div class="risk-bar"></div><div>
      <div class="risk-title">${escapeHtml(risk.title)}</div><div class="risk-detail">${escapeHtml(risk.detail)}</div>
      <div class="risk-evidence">↳ ${escapeHtml(risk.evidence)}</div>
      ${canDraft ? `<button class="draft-action" data-edition="${edition}">Prepare supplier follow-up ↗</button>` : ""}
    </div><div class="risk-action">${escapeHtml(risk.action)}<div class="risk-owner">Owner: ${escapeHtml(risk.owner || "Unassigned")}</div></div></article>`;
  }).join("");
  document.querySelectorAll(".draft-action").forEach((button) => {
    button.addEventListener("click", () => showDraft(button.dataset.edition));
  });

  byId("agent-list").innerHTML = brief.agents.map((agent, index) => {
    const symbols = ["⌕", "⌁", "↗"];
    const label = agent.status === "complete" ? "COMPLETE" : "REVIEW NEEDED";
    return `<article class="agent-card ${escapeHtml(agent.status)}"><div class="agent-top"><span class="agent-icon">${symbols[index] || "✳"}</span><span class="agent-name">${escapeHtml(agent.name)}</span><span class="agent-state">${label}</span></div><p class="agent-result">${escapeHtml(agent.result)}</p></article>`;
  }).join("");

  renderEvents(brief.events || []);
}

function renderEvents(events) {
  byId("event-count").textContent = events.length ? `${events.length} RECENT FILE CHANGES` : "NO CHANGES DETECTED";
  byId("event-list").innerHTML = events.length ? events.map((event) =>
    `<article class="event-item"><span class="event-type ${escapeHtml(event.kind)}">${escapeHtml(event.kind)}</span><div class="event-text">${escapeHtml(event.summary)}<small>${escapeHtml(event.path)} · ${new Date(event.detected_at).toLocaleString()}</small></div></article>`
  ).join("") : '<p class="empty-events">No file changes recorded yet. Re-import the portal archive after a data drop to compare snapshots.</p>';
}

async function showDraft(edition) {
  try {
    const draft = await request(`/api/supplier-draft?edition=${encodeURIComponent(edition)}`);
    byId("draft-title").textContent = `${edition} supplier follow-up`;
    byId("draft-to").textContent = `TO: ${draft.to}`;
    byId("draft-subject").textContent = `SUBJECT: ${draft.subject}`;
    byId("draft-body").textContent = draft.body;
    byId("draft-dialog").showModal();
  } catch (error) {
    showToast(error.message);
  }
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

byId("run-agents").addEventListener("click", async () => {
  const button = byId("run-agents");
  button.disabled = true;
  button.innerHTML = "<span>✳</span> Agents working…";
  try {
    renderBrief(await request("/api/agents/run", { method: "POST" }));
    showToast("Launch brief reconciled from verified kickoff evidence.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>✳</span> Run agents <kbd>↵</kbd>";
  }
});

byId("copy-draft").addEventListener("click", async () => {
  await navigator.clipboard.writeText(byId("draft-body").textContent);
  byId("draft-dialog").close();
  showToast("Draft copied. Verify the contact before sending.");
});

request("/api/launch").then(renderBrief).catch((error) => {
  byId("editions").innerHTML = `<p class="loading">Could not load launch brief: ${escapeHtml(error.message)}</p>`;
});

byId("archive-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  showToast("Importing and indexing archive…");
  try {
    const result = await request("/api/data/import", { method: "POST", body: form });
    renderBrief(await request("/api/agents/run", { method: "POST" }));
    showToast(`Imported ${result.file_count} files; detected ${result.changed_count} changes.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    event.target.value = "";
  }
});

async function syncPortal(quiet = false) {
  if (portalSyncInFlight) return;
  portalSyncInFlight = true;
  const button = byId("sync-portal");
  button.disabled = true;
  try {
    const result = await request("/api/data/sync", { method: "POST" });
    if (result.changed_count) {
      renderBrief(await request("/api/agents/run", { method: "POST" }));
      showToast(`Synced ${result.file_count} files; detected ${result.changed_count} changes.`);
    } else if (!quiet) {
      showToast("Portal checked. No new file changes.");
    }
  } catch (error) {
    if (!quiet) showToast(error.message);
  } finally {
    button.disabled = false;
    portalSyncInFlight = false;
  }
}

byId("sync-portal").addEventListener("click", () => {
  syncPortal();
});
