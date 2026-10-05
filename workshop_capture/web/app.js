// Workshop Capture front end. Plain ES modules, no build step.
// All URLs are relative so the app also works behind Home Assistant ingress.

const $ = (sel) => document.querySelector(sel);
const MAX_EDGE = 1568; // long edge in px; plenty for labels, keeps uploads small

const state = { photos: [], locations: [], aiEnabled: false };

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") showLogin();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- views ----------

function show(viewId) {
  for (const id of ["login-view", "add-view", "find-view", "projects-view", "project-view"]) $(`#${id}`).hidden = id !== viewId;
  const tab = viewId === "project-view" ? "projects-view" : viewId;
  for (const b of document.querySelectorAll("#tabs button")) {
    if (b.dataset.view === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

function showLogin() {
  $("#tabs").hidden = true;
  $("#logout").hidden = true;
  show("login-view");
}

async function showApp() {
  $("#tabs").hidden = false;
  $("#logout").hidden = false;
  show("add-view");
  $("#identify").hidden = !state.aiEnabled;
  await loadLocations();
}

async function start() {
  const status = await api("status");
  state.aiEnabled = Boolean(status.ai);
  if (status.signedIn) await showApp();
  else showLogin();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $("#login-error").textContent = "";
  try {
    await api("login", { method: "POST", body: { username: form.get("username"), password: form.get("password") } });
    e.target.reset();
    await showApp();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("logout", { method: "POST", body: {} }).catch(() => {});
  showLogin();
});

$("#tabs").addEventListener("click", (e) => {
  const view = e.target.closest("button")?.dataset.view;
  if (view) show(view);
  if (view === "projects-view") loadProjects();
});

// ---------- locations ----------

const LAST_LOCATION = "wc:lastLocation";

async function loadLocations() {
  state.locations = await api("locations");
  const last = safeGet(LAST_LOCATION);
  fillLocationSelect($("#location-select"), last, "No location");
  fillLocationSelect($("#location-parent"), "", "Top level");
}

function fillLocationSelect(select, selected, emptyLabel) {
  select.replaceChildren(new Option(emptyLabel, ""));
  for (const loc of state.locations) select.add(new Option(loc.path, loc.id, false, loc.id === selected));
}

$("#new-location").addEventListener("click", () => {
  $("#location-parent").value = $("#location-select").value;
  $("#location-dialog").showModal();
});

$("#location-dialog").addEventListener("close", async () => {
  const dialog = $("#location-dialog");
  const form = $("#location-form");
  if (dialog.returnValue !== "ok") return form.reset();
  const data = new FormData(form);
  try {
    const loc = await api("locations", {
      method: "POST",
      body: { name: data.get("name"), parentId: data.get("parentId") || undefined },
    });
    form.reset();
    await loadLocations();
    $("#location-select").value = loc.id;
  } catch (err) {
    setStatus("#add-status", err.message, true);
  }
});

// ---------- photos ----------

/** Resize on the phone before upload: faster, cheaper for AI, and plenty for Homebox. */
async function toPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.split(",")[1], preview: dataUrl };
}

function renderPhotos() {
  const wrap = $("#photos");
  wrap.replaceChildren(
    ...state.photos.map((p, i) => {
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = p.preview;
      img.alt = `Photo ${i + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove photo ${i + 1}`);
      remove.onclick = () => {
        state.photos.splice(i, 1);
        renderPhotos();
      };
      fig.append(img, remove);
      return fig;
    }),
  );
  $("#identify").disabled = state.photos.length === 0;
}

$("#photo-input").addEventListener("change", async (e) => {
  for (const file of e.target.files) state.photos.push(await toPhoto(file));
  e.target.value = "";
  renderPhotos();
});

$("#identify").addEventListener("click", async () => {
  await busy("#add-status", "Identifying…", async () => {
    const hint = $("#say").value.trim() || undefined;
    const r = await api("ai/identify", { method: "POST", body: { photos: state.photos.slice(0, 4).map(strip), hint } });
    fill({
      name: r.name,
      manufacturer: r.manufacturer,
      modelNumber: r.modelNumber,
      description: r.description,
      tags: r.tags.join(", "),
      purchasePrice: r.estimatedValue ?? "",
    });
    const alts = r.alternatives.length ? ` Could also be: ${r.alternatives.join(", ")}.` : "";
    return `Identified with ${r.confidence} confidence. Check the details before saving.${alts}`;
  });
});

$("#label-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const photo = await toPhoto(file);
  state.photos.push(photo);
  renderPhotos();
  if (!state.aiEnabled) return;
  await busy("#add-status", "Reading label…", async () => {
    const r = await api("ai/label", { method: "POST", body: { photo: strip(photo) } });
    fill({ manufacturer: r.manufacturer, modelNumber: r.modelNumber, serialNumber: r.serialNumber }, true);
    const extra = [r.partNumber && `Part no. ${r.partNumber}`, r.manufactureDate && `Made ${r.manufactureDate}`, r.otherText]
      .filter(Boolean)
      .join(" · ");
    if (extra) appendNote(extra);
    return `Label read with ${r.confidence} confidence. Check the serial against the photo.`;
  });
});

// ---------- say or type ----------

$("#say-go").addEventListener("click", async () => {
  const text = $("#say").value.trim();
  if (!text) return;
  if (!state.aiEnabled) {
    fill({ name: text });
    return;
  }
  await busy("#add-status", "Working it out…", async () => {
    const r = await api("ai/parse", { method: "POST", body: { text } });
    if (r.action === "find") {
      show("find-view");
      $("#find-q").value = r.itemName || text;
      $("#find-form").requestSubmit();
      return "";
    }
    fill({ name: r.itemName, notes: r.notes, quantity: r.quantity ?? "" });
    if (r.locationId) $("#location-select").value = r.locationId;
    else if (r.locationName) return `I couldn't find a location called "${r.locationName}". Pick one or create it.`;
    return state.photos.length ? "Filled in. Check the details, then save." : "Filled in. Add a photo, then save.";
  });
});

// ---------- save ----------

$("#item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const num = (k) => (f.get(k) === "" ? undefined : Number(f.get(k)));
  const str = (k) => String(f.get(k) ?? "").trim() || undefined;
  const body = {
    name: str("name"),
    parentId: str("parentId"),
    manufacturer: str("manufacturer"),
    modelNumber: str("modelNumber"),
    serialNumber: str("serialNumber"),
    quantity: num("quantity"),
    purchasePrice: num("purchasePrice"),
    description: str("description"),
    notes: str("notes"),
    insured: f.get("insured") === "on",
    tags: String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    photos: state.photos.map(strip),
  };
  await busy("#add-status", "Saving…", async () => {
    const saved = await api("items", { method: "POST", body });
    if (body.parentId) safeSet(LAST_LOCATION, body.parentId);
    resetAdd();
    return `Saved “${saved.name}”. Ready for the next one.`;
  });
});

function resetAdd() {
  const keepLocation = $("#location-select").value;
  $("#item-form").reset();
  $("#location-select").value = keepLocation;
  $("#say").value = "";
  state.photos = [];
  renderPhotos();
}

// ---------- find ----------

$("#find-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#find-q").value.trim().replace(/^(where('s| is| are)?|find|have i got)\s+(the|my|a|an|some)?\s*/i, "").replace(/\?$/, "");
  if (!q) return;
  $("#results").replaceChildren();
  await busy("#find-status", "Searching…", async () => {
    const items = await api(`search?q=${encodeURIComponent(q)}`);
    $("#results").replaceChildren(...items.map(resultRow));
    return items.length ? `${items.length} found` : `Nothing matching “${q}”`;
  });
});

function resultRow(item) {
  const li = document.createElement("li");
  if (item.imageId) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = `api/items/${encodeURIComponent(item.id)}/photos/${encodeURIComponent(item.imageId)}`;
    li.append(img);
  }
  const text = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name;
  const where = document.createElement("span");
  where.className = "where";
  where.textContent = item.location ? `📍 ${item.location}` : "No location set";
  const move = document.createElement("select");
  move.setAttribute("aria-label", `Move ${item.name}`);
  move.add(new Option("Move to…", ""));
  for (const loc of state.locations) move.add(new Option(loc.path, loc.id));
  move.onchange = async () => {
    if (!move.value) return;
    try {
      await api(`items/${encodeURIComponent(item.id)}/location`, { method: "PATCH", body: { parentId: move.value } });
      where.textContent = `📍 ${move.selectedOptions[0].text}`;
    } catch (err) {
      setStatus("#find-status", err.message, true);
    }
    move.value = "";
  };
  text.append(name, where, move);
  li.append(text);
  return li;
}

// ---------- projects ----------

const STATUS_LABEL = { planning: "Planning", active: "In progress", done: "Done" };
let current = null; // the open project

async function loadProjects() {
  const list = await api("projects").catch((err) => (setStatus("#projects-status", err.message, true), []));
  $("#project-list").replaceChildren(
    ...list.map((p) => {
      const li = document.createElement("li");
      li.className = "tap";
      const div = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = p.name;
      const meta = document.createElement("span");
      meta.className = "where";
      meta.textContent = `${STATUS_LABEL[p.status]} · ${p.pulledCount}/${p.itemCount} gathered`;
      div.append(name, meta);
      li.append(div);
      li.tabIndex = 0;
      li.onclick = () => openProject(p.id);
      li.onkeydown = (e) => e.key === "Enter" && openProject(p.id);
      return li;
    }),
  );
  setStatus("#projects-status", list.length ? "" : "No projects yet.");
}

$("#new-project").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const p = await api("projects", { method: "POST", body: { name: f.get("name"), description: f.get("description") } }).catch((err) =>
    setStatus("#projects-status", err.message, true),
  );
  if (!p) return;
  e.target.reset();
  await openProject(p.id);
  if (state.aiEnabled && p.description) $("#suggest").click();
});

async function openProject(id) {
  current = await api(`projects/${encodeURIComponent(id)}`);
  show("project-view");
  $("#project-name").textContent = current.name;
  $("#project-desc").textContent = current.description;
  $("#project-status").value = current.status;
  $("#suggest").hidden = !state.aiEnabled;
  $("#suggestions").replaceChildren();
  $("#project-search-results").replaceChildren();
  setStatus("#project-status-msg", "");
  await renderPullList();
}

async function saveProject() {
  const { name, description, status, items } = current;
  current = await api(`projects/${encodeURIComponent(current.id)}`, { method: "PUT", body: { name, description, status, items } });
}

async function renderPullList() {
  const groups = await api(`projects/${encodeURIComponent(current.id)}/pull-list`);
  if (!groups.length) {
    $("#pull-list").replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "Nothing added yet." }));
    return;
  }
  $("#pull-list").replaceChildren(
    ...groups.map((g) => {
      const box = document.createElement("div");
      box.className = "group";
      const h = document.createElement("h4");
      h.textContent = `📍 ${g.location}`;
      const ul = document.createElement("ul");
      for (const item of g.items) {
        const li = document.createElement("li");
        const label = document.createElement("label");
        label.className = "check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = item.pulled;
        cb.onchange = async () => {
          current.items.find((i) => i.id === item.id).pulled = cb.checked;
          await saveProject().catch((err) => setStatus("#project-status-msg", err.message, true));
        };
        const text = document.createElement("span");
        text.textContent = item.quantity ? `${item.name} (${item.quantity})` : item.name;
        label.append(cb, text);
        const remove = document.createElement("button");
        remove.className = "link";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${item.name}`);
        remove.onclick = async () => {
          current.items = current.items.filter((i) => i.id !== item.id);
          await saveProject();
          await renderPullList();
        };
        li.append(label, remove);
        ul.append(li);
      }
      box.append(h, ul);
      return box;
    }),
  );
}

async function addToProject(items) {
  current.items.push(...items.map((i) => ({ kind: "tool", quantity: "", pulled: false, ...i })));
  await saveProject();
  await renderPullList();
}

$("#back-to-projects").addEventListener("click", () => {
  show("projects-view");
  loadProjects();
});

$("#project-status").addEventListener("change", async (e) => {
  current.status = e.target.value;
  await saveProject();
});

$("#reset-pulled").addEventListener("click", async () => {
  for (const i of current.items) i.pulled = false;
  await saveProject();
  await renderPullList();
  setStatus("#project-status-msg", "Everything marked as put back.");
});

$("#delete-project").addEventListener("click", async () => {
  if (!confirm(`Delete “${current.name}”? This can't be undone.`)) return;
  await api(`projects/${encodeURIComponent(current.id)}`, { method: "DELETE" });
  show("projects-view");
  loadProjects();
});

let searchTimer;
$("#project-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return $("#project-search-results").replaceChildren();
  searchTimer = setTimeout(async () => {
    const items = await api(`search?q=${encodeURIComponent(q)}`).catch(() => []);
    $("#project-search-results").replaceChildren(
      ...items.slice(0, 8).map((item) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.className = "button";
        b.textContent = `+ ${item.name}${item.location ? ` · ${item.location}` : ""}`;
        b.onclick = async () => {
          await addToProject([{ name: item.name, entityId: item.id }]);
          $("#project-search").value = "";
          $("#project-search-results").replaceChildren();
        };
        li.append(b);
        return li;
      }),
    );
  }, 250);
});

$("#project-add").addEventListener("click", async () => {
  const name = $("#project-search").value.trim();
  if (!name) return;
  await addToProject([{ name, entityId: null }]);
  $("#project-search").value = "";
  $("#project-search-results").replaceChildren();
});

$("#suggest").addEventListener("click", async () => {
  await busy("#project-status-msg", "Working out what you'll need…", async () => {
    const description = [current.name, current.description].filter(Boolean).join(". ");
    const suggestions = await api("ai/plan", { method: "POST", body: { description } });
    const have = new Set(current.items.map((i) => i.name.toLowerCase()));
    const fresh = suggestions.filter((s) => !have.has(s.name.toLowerCase()));
    renderSuggestions(fresh);
    return fresh.length ? "Pick what you need, matching each to your own kit where possible." : "Nothing new to suggest.";
  });
});

function renderSuggestions(list) {
  if (!list.length) return $("#suggestions").replaceChildren();
  const form = document.createElement("form");
  form.className = "stack suggestions";
  for (const [i, s] of list.entries()) {
    const row = document.createElement("div");
    row.className = "suggestion";
    const label = document.createElement("label");
    label.className = "check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = `use-${i}`;
    cb.checked = true;
    const text = document.createElement("span");
    text.textContent = s.quantity ? `${s.name} (${s.quantity})` : s.name;
    label.append(cb, text);
    const pick = document.createElement("select");
    pick.name = `match-${i}`;
    pick.setAttribute("aria-label", `Which ${s.name}`);
    for (const m of s.matches) pick.add(new Option(`Use my ${m.name}`, m.id));
    pick.add(new Option("Not in my inventory", ""));
    row.append(label, pick);
    form.append(row);
  }
  const add = document.createElement("button");
  add.className = "primary";
  add.textContent = "Add selected to project";
  form.append(add);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const chosen = list
      .map((s, i) => f.get(`use-${i}`) && { name: s.name, kind: s.kind, quantity: s.quantity, entityId: f.get(`match-${i}`) || null })
      .filter(Boolean);
    $("#suggestions").replaceChildren();
    await addToProject(chosen);
    setStatus("#project-status-msg", `Added ${chosen.length} item${chosen.length === 1 ? "" : "s"}.`);
  };
  $("#suggestions").replaceChildren(form);
}

// ---------- voice ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  for (const btn of document.querySelectorAll(".voice")) {
    btn.hidden = false;
    btn.addEventListener("click", () => {
      const rec = new Recognition();
      rec.lang = navigator.language || "en-GB";
      rec.interimResults = false;
      btn.classList.add("listening");
      rec.onresult = (ev) => {
        const input = document.getElementById(btn.dataset.target);
        input.value = ev.results[0][0].transcript;
        if (btn.dataset.target === "find-q") $("#find-form").requestSubmit();
        else $("#say-go").click();
      };
      rec.onend = () => btn.classList.remove("listening");
      rec.onerror = () => btn.classList.remove("listening");
      rec.start();
    });
  }
}

// ---------- helpers ----------

function strip({ mediaType, data }) {
  return { mediaType, data };
}

/** Fill form fields. Empty suggestions never wipe what is already typed; with onlyIfFound, empty values are skipped entirely. */
function fill(values, onlyIfFound = false) {
  const form = $("#item-form");
  for (const [k, v] of Object.entries(values)) {
    if (v == null || (onlyIfFound && v === "")) continue;
    if (v === "" && form.elements[k].value) continue;
    form.elements[k].value = v;
  }
}

function appendNote(text) {
  const notes = $("#item-form").elements.notes;
  notes.value = notes.value ? `${notes.value}\n${text}` : text;
}

function setStatus(sel, msg, isError = false) {
  const el = $(sel);
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

async function busy(sel, msg, fn) {
  setStatus(sel, msg);
  document.body.classList.add("busy");
  try {
    setStatus(sel, (await fn()) ?? "");
  } catch (err) {
    setStatus(sel, err.message, true);
  } finally {
    document.body.classList.remove("busy");
  }
}

function safeGet(key) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the location just won't be remembered.
  }
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start().catch((err) => {
  showLogin();
  $("#login-error").textContent = `Can't reach the server: ${err.message}`;
});
