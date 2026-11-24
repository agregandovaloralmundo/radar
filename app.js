const STORAGE_KEY_LEADS = "avm_radar_leads_v8";
const STORAGE_KEY_CONFIG = "avm_radar_config_v8";
const SCAN_INTERVAL_SECONDS = 900; // 15 minutos
const MAX_AGE_HOURS = 168; // Últimos 7 días

let leads = JSON.parse(localStorage.getItem(STORAGE_KEY_LEADS) || "[]");
let secondsRemaining = SCAN_INTERVAL_SECONDS;
let currentModalLeadId = null;

// Palabras clave por defecto enfocadas en encargos puntuales de programación y automatización
const DEFAULT_KEYWORDS = "website, web app, database, sql, c#, .net, python, html, dashboard, automation, script, scraper, software, developer, programmer, excel, api, bot, app, fix, build";

// Fuentes RSS directas de encargos puntuales y desarrollo freelance
const PROJECT_SOURCES = [
  {
    name: "Reddit r/forhire",
    type: "reddit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/forhire/new/.rss"
  },
  {
    name: "Reddit r/freelance_forhire",
    type: "reddit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/freelance_forhire/new/.rss"
  },
  {
    name: "Reddit r/slavelabour",
    type: "reddit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/slavelabour/new/.rss"
  },
  {
    name: "Reddit r/hiring",
    type: "reddit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/hiring/new/.rss"
  },
  {
    name: "Reddit r/ProgrammingTasks",
    type: "reddit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/ProgrammingTasks/new/.rss"
  },
  {
    name: "Reddit r/Jobs4Bitcoins",
    type: "reddit",
    url: "https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/Jobs4Bitcoins/new/.rss"
  }
];

document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  renderLeads();
  updateStats();
  runGlobalScan();
  startTimer();

  document.getElementById("btnScanNow").addEventListener("click", () => {
    secondsRemaining = SCAN_INTERVAL_SECONDS;
    runGlobalScan();
  });

  document.getElementById("btnSaveConfig").addEventListener("click", saveConfig);
  document.getElementById("filterStatus").addEventListener("change", renderLeads);
  document.getElementById("chkOnlyEmail").addEventListener("change", renderLeads);
  document.getElementById("btnExportJson").addEventListener("click", exportLeads);
  document.getElementById("fileImportJson").addEventListener("change", importLeads);
  document.getElementById("btnCopyProposal").addEventListener("click", copyProposalAndMark);
});

function loadConfig() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_CONFIG) || "null");
  if (saved && typeof saved.keywords === "string") {
    document.getElementById("inputKeywords").value = saved.keywords;
  } else {
    document.getElementById("inputKeywords").value = DEFAULT_KEYWORDS;
  }
}

function saveConfig() {
  const keywords = document.getElementById("inputKeywords").value.trim();
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({ keywords }));
  runGlobalScan();
}

function getKeywordsArray() {
  return document.getElementById("inputKeywords").value
    .split(",")
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0);
}

function startTimer() {
  setInterval(() => {
    secondsRemaining--;
    if (secondsRemaining <= 0) {
      secondsRemaining = SCAN_INTERVAL_SECONDS;
      runGlobalScan();
    }
    const mins = String(Math.floor(secondsRemaining / 60)).padStart(2, "0");
    const secs = String(secondsRemaining % 60).padStart(2, "0");
    document.getElementById("countdownTimer").textContent = `${mins}:${secs}`;
  }, 1000);
}

function stripHtml(html) {
  if (!html) return "";
  const spaced = html.replace(/<[^>]*>/g, " ");
  const tmp = document.createElement("div");
  tmp.innerHTML = spaced;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

function extractEmails(text) {
  if (!text) return [];
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(regex) || [];
  return [...new Set(matches.map(e => e.toLowerCase()))]
    .filter(e => !e.includes("example.com") && !e.includes("domain.com"));
}

function extractBudget(text) {
  if (!text) return null;
  const match = text.match(/(\$\s?\d{1,5}(?:[.,]\d{3})?(?:\s?-\s?\$?\d{1,5}(?:[.,]\d{3})?)?(?:\s?\/?\s?(?:hr|hour|project|fixed|flat))?)/i);
  return match ? match[1].trim() : null;
}

function isPuntualProjectOnly(title, body, sourceType) {
  const titleLower = title.toLowerCase();
  const fullText = `${title} ${body}`.toLowerCase();

  // 1. Exigir publicación de cliente buscando ([Hiring] / [Task]) y jamás [For Hire]
  if (sourceType === "reddit") {
    const isClientAsking =
      titleLower.includes("[hiring]") ||
      titleLower.includes("(hiring)") ||
      titleLower.includes("[task]");
    const isSelfPromo =
      titleLower.includes("[for hire]") ||
      titleLower.includes("(for hire)") ||
      titleLower.includes("[offer]");

    if (!isClientAsking || isSelfPromo) return false;
  }

  // 2. Bloqueo estricto de plazas permanentes, empleos de tiempo completo, restricciones de país y Costa Rica/SICOP
  const blockedTerms = [
    "permanent",
    "full-time",
    "full time",
    "fulltime",
    "40 hours",
    "40 hrs",
    "onsite",
    "on-site",
    "hybrid",
    "10+ years",
    "staff engineer",
    "principal engineer",
    "annual salary",
    "per year",
    "/yr",
    "w2",
    "us citizens only",
    "uk only",
    "india",
    "costa rica",
    "san josé",
    "sicop"
  ];
  if (blockedTerms.some(term => fullText.includes(term))) {
    return false;
  }

  // 3. Coincidencia con palabras clave técnicas (si el campo está vacío, acepta todo encargo válido)
  const keywords = getKeywordsArray();
  if (keywords.length === 0) return true;
  return keywords.some(kw => fullText.includes(kw));
}

async function runGlobalScan() {
  const logEl = document.getElementById("lastScanLog");
  const btn = document.getElementById("btnScanNow");
  btn.disabled = true;
  logEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-primary"></i> Rastreando proyectos puntuales en tiempo real...`;

  let newCount = 0;
  let inspectedCount = 0;
  const nowMs = Date.now();
  const maxAgeMs = MAX_AGE_HOURS * 3600 * 1000;

  for (const src of PROJECT_SOURCES) {
    try {
      const resp = await fetch(src.url);
      if (!resp.ok) continue;
      const data = await resp.json();

      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          inspectedCount++;
          const pubDate = new Date((item.pubDate || "").replace(" ", "T") + "Z").getTime();
          if (!isNaN(pubDate) && (nowMs - pubDate > maxAgeMs)) continue;

          const cleanDesc = stripHtml(item.description || item.content || "");
          if (!isPuntualProjectOnly(item.title, cleanDesc, src.type)) continue;

          const uniqueId = `opp_${btoa(unescape(encodeURIComponent(item.link))).slice(0, 28)}`;
          if (leads.some(l => l.id === uniqueId)) continue;

          const emails = extractEmails(`${item.title} ${cleanDesc}`);
          const budget = extractBudget(`${item.title} ${cleanDesc}`);

          leads.unshift({
            id: uniqueId,
            source: src.name,
            title: item.title,
            description: cleanDesc.slice(0, 600) || "Ver especificaciones del proyecto en el enlace original.",
            url: item.link,
            author: item.author || "Client",
            emails: emails,
            budget: budget,
            createdAt: item.pubDate || new Date().toISOString(),
            status: "nuevo"
          });
          newCount++;
        }
      }
    } catch (err) {
      console.warn(`Error en ${src.name}:`, err);
    }
  }

  saveLeads();
  renderLeads();
  updateStats();

  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  logEl.innerHTML = `Último rastreo: <strong>${timeStr}</strong> (${inspectedCount} revisadas) — <span class="text-success fw-bold">+${newCount} proyectos puntuales</span>`;
  btn.disabled = false;
}

function saveLeads() {
  if (leads.length > 500) leads = leads.slice(0, 500);
  localStorage.setItem(STORAGE_KEY_LEADS, JSON.stringify(leads));
}

function updateStats() {
  document.getElementById("statNuevas").textContent = leads.filter(l => l.status === "nuevo").length;
  document.getElementById("statConCorreo").textContent = leads.filter(l => l.status === "nuevo" && l.emails.length > 0).length;
  document.getElementById("statEnviadas").textContent = leads.filter(l => l.status === "enviado").length;
  document.getElementById("statGanados").textContent = leads.filter(l => l.status === "ganado").length;
}

function renderLeads() {
  const container = document.getElementById("leadsContainer");
  const filterStatus = document.getElementById("filterStatus").value;
  const onlyEmail = document.getElementById("chkOnlyEmail").checked;

  const filtered = leads.filter(l => {
    if (filterStatus !== "todos" && l.status !== filterStatus) return false;
    if (onlyEmail && (!l.emails || l.emails.length === 0)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="alert alert-light border text-center py-5 text-muted">
          <i class="fa-solid fa-radar fa-2x mb-2 text-secondary"></i>
          <p class="mb-0">No hay proyectos puntuales nuevos en este momento. El radar sigue vigilando cada 15 minutos.</p>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(lead => {
    const dateObj = new Date(lead.createdAt);
    const dateFormatted = isNaN(dateObj.getTime())
      ? lead.createdAt
      : dateObj.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

    const emailBadge = lead.emails && lead.emails.length > 0
      ? `<span class="badge bg-success"><i class="fa-solid fa-envelope-circle-check me-1"></i>${lead.emails[0]}</span>`
      : `<span class="badge bg-secondary bg-opacity-25 text-dark">Contactar en publicación</span>`;

    const budgetBadge = lead.budget
      ? `<span class="badge bg-warning text-dark"><i class="fa-solid fa-dollar-sign"></i> ${escapeHtml(lead.budget)}</span>`
      : "";

    const statusBadgeMap = {
      nuevo: `<span class="badge bg-warning text-dark">🟡 Nuevo</span>`,
      enviado: `<span class="badge bg-info text-dark">🔵 Enviado</span>`,
      ganado: `<span class="badge bg-success">🟢 Ganado</span>`,
      descartado: `<span class="badge bg-dark">⚫ Descartado</span>`
    };

    return `
      <div class="col-md-6 col-xl-4">
        <div class="card border-0 shadow-sm h-100 lead-card">
          <div class="card-header bg-white border-0 pt-3 pb-0 d-flex justify-content-between align-items-center">
            <span class="badge bg-primary bg-opacity-10 text-primary badge-source">${lead.source}</span>
            ${statusBadgeMap[lead.status] || ""}
          </div>
          <div class="card-body d-flex flex-column">
            <h6 class="card-title fw-bold text-dark mb-2">${escapeHtml(lead.title)}</h6>
            <div class="mb-2 d-flex flex-wrap gap-1 align-items-center">
              ${emailBadge}
              ${budgetBadge}
              <span class="small text-muted ms-auto"><i class="fa-regular fa-clock"></i> ${dateFormatted}</span>
            </div>
            <p class="card-text small text-secondary lead-description flex-grow-1">${escapeHtml(lead.description)}</p>
            <div class="border-top pt-2 mt-2 d-flex gap-1 flex-wrap">
              <button class="btn btn-sm btn-primary flex-grow-1" onclick="openProposalModal('${lead.id}')">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Ofertar
              </button>
              <a href="${lead.url}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-dark" title="Abrir publicación original">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
              <button class="btn btn-sm btn-outline-success" onclick="changeStatus('${lead.id}', 'ganado')" title="Marcar como Ganado">
                <i class="fa-solid fa-trophy"></i>
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick="changeStatus('${lead.id}', 'descartado')" title="Descartar">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");
}

function changeStatus(id, newStatus) {
  const idx = leads.findIndex(l => l.id === id);
  if (idx !== -1) {
    leads[idx].status = newStatus;
    saveLeads();
    renderLeads();
    updateStats();
  }
}

function openProposalModal(id) {
  const lead = leads.find(l => l.id === id);
  if (!lead) return;
  currentModalLeadId = id;

  document.getElementById("modalSubject").value = `Custom Software Solution for: ${lead.title.slice(0, 65)}`;
  document.getElementById("modalBody").value =
`Hello ${lead.author},

I saw your request regarding "${lead.title}" and would be glad to build this exact solution for you on a fixed-project basis.

At AVM Software Development (Agregando Valor al Mundo), we build custom web apps, SQL databases, C#/.NET tools, Python automation scripts, and HTML5/JavaScript platforms.

You can see a live sample of our web engineering work here:
https://agregandovaloralmundo.github.io/multimediaonline/

We deliver fast, milestone-based results and accept PayPal. Let me know the details so we can get started!

Best regards,
Antonio Ramírez
Lead Software Developer | AVM Digital Solutions`;

  const emailBox = document.getElementById("modalEmailBox");
  if (lead.emails && lead.emails.length > 0) {
    emailBox.classList.remove("d-none");
    emailBox.innerHTML = `<strong>Correo directo detectado:</strong> <a href="mailto:${lead.emails[0]}">${lead.emails[0]}</a>`;
  } else {
    emailBox.classList.add("d-none");
  }

  const modal = new bootstrap.Modal(document.getElementById("proposalModal"));
  modal.show();
}

function copyProposalAndMark() {
  const bodyText = document.getElementById("modalBody").value;
  navigator.clipboard.writeText(bodyText).then(() => {
    if (currentModalLeadId) {
      changeStatus(currentModalLeadId, "enviado");
    }
    const modalEl = document.getElementById("proposalModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
    alert("Propuesta copiada al portapapeles y marcada como 'Enviada' en su histórico.");
  });
}

function exportLeads() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(leads, null, 2));
  const a = document.createElement("a");
  a.href = dataStr;
  a.download = `respaldo_radar_avm_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function importLeads(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        leads = imported;
        saveLeads();
        renderLeads();
        updateStats();
        alert("Histórico restaurado correctamente.");
      }
    } catch {
      alert("El archivo JSON no tiene un formato válido.");
    }
  };
  reader.readAsText(file);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}