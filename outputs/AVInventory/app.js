const code39 = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
  "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn", "A": "wnnnnwnnw", "B": "nnwnnwnnw",
  "C": "wnwnnwnnn", "D": "nnnnwwnnw", "E": "wnnnwwnnn", "F": "nnwnwwnnn",
  "G": "nnnnnwwnw", "H": "wnnnnwwnn", "I": "nnwnnwwnn", "J": "nnnnwwwnn",
  "K": "wnnnnnnww", "L": "nnwnnnnww", "M": "wnwnnnnwn", "N": "nnnnwnnww",
  "O": "wnnnwnnwn", "P": "nnwnwnnwn", "Q": "nnnnnnwww", "R": "wnnnnnwwn",
  "S": "nnwnnnwwn", "T": "nnnnwnwwn", "U": "wwnnnnnnw", "V": "nwwnnnnnw",
  "W": "wwwnnnnnn", "X": "nwnnwnnnw", "Y": "wwnnwnnnn", "Z": "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn"
};

let state = { locations: [], products: [], units: [], activity: [], users: [] };
let currentUser = null;
let currentView = "scan";
let authToken = localStorage.getItem("avinventory-token") || "";
let selectedCategory = "";
let selectedTag = "";
let theme = localStorage.getItem("avinventory-theme") || "light";

const els = {
  loginScreen: document.getElementById("loginScreen"),
  appShell: document.getElementById("appShell"),
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  logoutBtn: document.getElementById("logoutBtn"),
  currentUserName: document.getElementById("currentUserName"),
  currentUserRole: document.getElementById("currentUserRole"),
  navBtns: document.querySelectorAll(".nav-btn"),
  managerOnly: document.querySelectorAll(".manager-only"),
  viewTitle: document.getElementById("viewTitle"),
  views: document.querySelectorAll(".view"),
  scanInput: document.getElementById("scanInput"),
  scanBtn: document.getElementById("scanBtn"),
  scanResult: document.getElementById("scanResult"),
  itemForm: document.getElementById("itemForm"),
  itemName: document.getElementById("itemName"),
  itemLocation: document.getElementById("itemLocation"),
  itemQuantity: document.getElementById("itemQuantity"),
  itemCategory: document.getElementById("itemCategory"),
  itemTags: document.getElementById("itemTags"),
  itemNotes: document.getElementById("itemNotes"),
  categorySuggestions: document.getElementById("categorySuggestions"),
  inventorySearch: document.getElementById("inventorySearch"),
  inventoryTable: document.getElementById("inventoryTable"),
  tagFilter: document.getElementById("tagFilter"),
  locationForm: document.getElementById("locationForm"),
  locationName: document.getElementById("locationName"),
  locationArea: document.getElementById("locationArea"),
  locationParent: document.getElementById("locationParent"),
  locationList: document.getElementById("locationList"),
  userForm: document.getElementById("userForm"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  userRole: document.getElementById("userRole"),
  userPassword: document.getElementById("userPassword"),
  usersTable: document.getElementById("usersTable"),
  themeToggle: document.getElementById("themeToggle"),
  activityList: document.getElementById("activityList"),
  statTotal: document.getElementById("statTotal"),
  statOut: document.getElementById("statOut"),
  dialog: document.getElementById("itemDialog"),
  dialogTitle: document.getElementById("dialogTitle"),
  dialogBody: document.getElementById("dialogBody"),
  printLabelsBtn: document.getElementById("printLabelsBtn"),
  resetDemoBtn: document.getElementById("resetDemoBtn")
};

document.getElementById("dialogCloseBtn").addEventListener("click", () => els.dialog.close());
els.dialogBody.addEventListener("click", (event) => {
  const singleLabelButton = event.target.closest("[data-action='single-label']");
  if (singleLabelButton) {
    showSingleLabel(singleLabelButton.dataset.barcode);
    return;
  }
  const copyButton = event.target.closest("[data-action='copy-single-label']");
  if (copyButton) {
    copySingleLabelBarcode(copyButton.dataset.barcode, copyButton);
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function parseTags(value) {
  return [...new Set(String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean))];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function applyServerState(nextState) {
  state = {
    locations: nextState.locations || [],
    products: nextState.products || [],
    units: nextState.units || [],
    activity: nextState.activity || [],
    users: nextState.users || []
  };
  currentUser = nextState.user;
  renderAll();
}

function isManager() {
  return currentUser?.role === "manager";
}

function byId(collection, id) {
  return collection.find((entry) => entry.id === id);
}

function unitsForProduct(productId) {
  return state.units.filter((unit) => unit.productId === productId);
}

function productCounts(productId) {
  const units = unitsForProduct(productId);
  return {
    total: units.length,
    in: units.filter((unit) => unit.status === "in").length,
    out: units.filter((unit) => unit.status === "out").length
  };
}

function nowText(iso) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

function renderBarcode(value, height = 72) {
  const text = `*${String(value).toUpperCase()}*`;
  const narrow = 2;
  const wide = 5;
  let x = 10;
  const bars = [];
  for (const char of text) {
    const pattern = code39[char] || code39["-"];
    [...pattern].forEach((widthCode, index) => {
      const isBar = index % 2 === 0;
      const width = widthCode === "w" ? wide : narrow;
      if (isBar) bars.push(`<rect x="${x}" y="8" width="${width}" height="${height}" />`);
      x += width;
    });
    x += narrow;
  }
  const width = x + 10;
  return `<svg viewBox="0 0 ${width} ${height + 34}" role="img" aria-label="Barcode ${escapeHtml(value)}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height + 34}" fill="#fff"/>
    <g fill="#111">${bars.join("")}</g>
    <text x="${width / 2}" y="${height + 25}" text-anchor="middle" font-family="monospace" font-size="15" fill="#111">${escapeHtml(value)}</text>
  </svg>`;
}

function setView(view) {
  if (!isManager() && view !== "scan") view = "scan";
  currentView = view;
  els.views.forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  els.navBtns.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  els.viewTitle.textContent = view.charAt(0).toUpperCase() + view.slice(1);
  if (view === "scan") setTimeout(() => els.scanInput.focus(), 50);
}

function showLoggedIn() {
  els.loginScreen.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  els.managerOnly.forEach((el) => el.classList.toggle("hidden", !isManager()));
  els.currentUserName.textContent = currentUser?.name || currentUser?.email || "User";
  els.currentUserRole.textContent = isManager() ? "Manager" : "Associate";
  if (!isManager() && currentView !== "scan") setView("scan");
  setTimeout(() => els.scanInput.focus(), 50);
}

function showLoggedOut() {
  authToken = "";
  currentUser = null;
  localStorage.removeItem("avinventory-token");
  els.appShell.classList.add("hidden");
  els.loginScreen.classList.remove("hidden");
  els.loginPassword.value = "";
  setTimeout(() => els.loginEmail.focus(), 50);
}

function applyTheme() {
  document.body.classList.toggle("dark", theme === "dark");
  els.themeToggle.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
}

function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("avinventory-theme", theme);
  applyTheme();
}

function renderStats() {
  els.statTotal.textContent = state.units.length;
  els.statOut.textContent = state.units.filter((unit) => unit.status === "out").length;
}

function renderLocationOptions() {
  const sorted = sortedLocations();
  const options = sorted
    .map(({ location, depth }) => `<option value="${escapeHtml(location.id)}">${"&nbsp;&nbsp;".repeat(depth)}${escapeHtml(location.name)}</option>`)
    .join("");
  els.itemLocation.innerHTML = `<option value="">Unassigned</option>${options}`;
  els.locationParent.innerHTML = `<option value="">No parent</option>${options}`;
}

function locationChildren(parentId) {
  return state.locations
    .filter((location) => (location.parentId || "") === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function descendantLocationIds(locationId) {
  return locationChildren(locationId).flatMap((child) => [child.id, ...descendantLocationIds(child.id)]);
}

function locationTreeIds(locationId) {
  return [locationId, ...descendantLocationIds(locationId)];
}

function productsInLocationTree(locationId) {
  const ids = new Set(locationTreeIds(locationId));
  return state.products.filter((product) => ids.has(product.locationId));
}

function sortedLocations(parentId = "", depth = 0, visited = new Set()) {
  return locationChildren(parentId).flatMap((location) => {
    if (visited.has(location.id)) return [];
    const nextVisited = new Set(visited);
    nextVisited.add(location.id);
    return [
      { location, depth },
      ...sortedLocations(location.id, depth + 1, nextVisited)
    ];
  });
}

function locationPath(location) {
  if (!location) return "Unassigned";
  const names = [];
  let current = location;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = byId(state.locations, current.parentId);
  }
  return names.join(" / ");
}

function productCategory(product) {
  return product.category || "General";
}

function allCategories() {
  return [...new Set(state.products.map(productCategory))].sort((a, b) => a.localeCompare(b));
}

function tagsForCategory(category) {
  return [...new Set(state.products
    .filter((product) => productCategory(product) === category)
    .flatMap((product) => product.tags || []))]
    .sort((a, b) => a.localeCompare(b));
}

function renderCategorySuggestions() {
  els.categorySuggestions.innerHTML = allCategories()
    .map((category) => `<option value="${escapeHtml(category)}"></option>`)
    .join("");
}

function categoryChip(category) {
  return `<span class="tag-chip category-chip">${escapeHtml(category || "General")}</span>`;
}

function renderTagFilter() {
  const categories = allCategories();
  if (selectedCategory && !categories.includes(selectedCategory)) {
    selectedCategory = "";
    selectedTag = "";
  }
  const categoryButtons = [
    `<button type="button" class="${selectedCategory === "" ? "active" : ""}" data-filter-type="category" data-category="">All Categories</button>`,
    ...categories.map((category) => `<button type="button" class="${selectedCategory === category ? "active" : ""}" data-filter-type="category" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
  ].join("");
  const tags = selectedCategory ? tagsForCategory(selectedCategory) : [];
  if (selectedTag && !tags.includes(selectedTag)) selectedTag = "";
  const tagButtons = tags.length ? `<div class="filter-row tag-row">
    <span>Tags</span>
    <button type="button" class="${selectedTag === "" ? "active" : ""}" data-filter-type="tag" data-tag="">All ${escapeHtml(selectedCategory)}</button>
    ${tags.map((tag) => `<button type="button" class="${selectedTag === tag ? "active" : ""}" data-filter-type="tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
  </div>` : "";
  els.tagFilter.innerHTML = `<div class="filter-row"><span>Categories</span>${categoryButtons}</div>${tagButtons}`;
}

function renderInventory() {
  const query = els.inventorySearch.value.trim().toLowerCase();
  const rows = state.products
    .filter((product) => {
      const location = byId(state.locations, product.locationId);
      const unitText = unitsForProduct(product.id).map((unit) => unit.id).join(" ");
      const tags = (product.tags || []).join(" ");
      const category = productCategory(product);
      const matchesQuery = `${product.name} ${location?.name || ""} ${unitText} ${category} ${tags}`.toLowerCase().includes(query);
      const matchesCategory = !selectedCategory || category === selectedCategory;
      const matchesTag = !selectedTag || (product.tags || []).includes(selectedTag);
      return matchesQuery && matchesCategory && matchesTag;
    })
    .map((product) => {
      const location = byId(state.locations, product.locationId);
      const counts = productCounts(product.id);
      return `<tr>
        <td><div class="row-title">${escapeHtml(product.name)}</div><div class="row-sub">${escapeHtml(product.notes || "No notes")}</div></td>
        <td><div class="tag-list">${categoryChip(productCategory(product))}</div></td>
        <td>${escapeHtml(location?.name || "Unassigned")}</td>
        <td>${counts.in}</td>
        <td>${counts.out}</td>
        <td>${counts.total}</td>
        <td>
          <div class="action-row">
            <button type="button" data-action="view-product" data-id="${escapeHtml(product.id)}">Labels</button>
            <button type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}">Edit</button>
            <button type="button" data-action="adjust-product" data-id="${escapeHtml(product.id)}">Set Qty</button>
            <button class="danger" type="button" data-action="remove-product" data-id="${escapeHtml(product.id)}">Remove</button>
          </div>
        </td>
      </tr>`;
    });
  els.inventoryTable.innerHTML = rows.join("") || `<tr><td colspan="7">No inventory matches your filter.</td></tr>`;
}

function renderLocations() {
  els.locationList.innerHTML = sortedLocations().map(({ location, depth }) => {
    const locationProducts = productsInLocationTree(location.id);
    const locationProductIds = new Set(locationProducts.map((product) => product.id));
    const units = state.units.filter((unit) => locationProductIds.has(unit.productId));
    const out = units.filter((unit) => unit.status === "out").length;
    const childCount = locationChildren(location.id).length;
    return `<article class="location-card">
      <div>
        <h4>${"&nbsp;".repeat(depth * 4)}${escapeHtml(location.name)}</h4>
        <p class="row-sub">${escapeHtml(locationPath(location))} | ${escapeHtml(location.area || "No area set")} | ${units.length} units | ${out} out | ${childCount} sub-location${childCount === 1 ? "" : "s"}</p>
      </div>
      <div class="barcode">${renderBarcode(location.id, 54)}</div>
      <div class="action-row">
        <button type="button" data-action="scan-location" data-id="${escapeHtml(location.id)}">Open</button>
        <button type="button" data-action="print-location" data-id="${escapeHtml(location.id)}">Print</button>
        <button class="danger" type="button" data-action="remove-location" data-id="${escapeHtml(location.id)}">Remove</button>
      </div>
    </article>`;
  }).join("");
}

function renderUsers() {
  els.usersTable.innerHTML = state.users.map((user) => `<tr>
    <td><div class="row-title">${escapeHtml(user.name)}</div></td>
    <td>${escapeHtml(user.email)}</td>
    <td><span class="tag-chip">${escapeHtml(user.role)}</span></td>
    <td>${nowText(user.createdAt)}</td>
  </tr>`).join("") || `<tr><td colspan="4">No users found.</td></tr>`;
}

function renderActivity() {
  const combined = [
    ...state.activity,
    ...state.units.flatMap((unit) => unit.history.map((event) => ({ ...event, unitId: unit.id })))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 80);
  els.activityList.innerHTML = combined.map((event) => {
    const unit = event.unitId ? byId(state.units, event.unitId) : null;
    const product = unit ? byId(state.products, unit.productId) : byId(state.products, event.productId);
    const location = byId(state.locations, event.locationId || product?.locationId);
    return `<div class="activity-item">
      <div>
        <strong>${escapeHtml(String(event.action || "").replace("-", " "))}</strong>
        <p>${escapeHtml(product?.name || event.label || "Inventory")} ${unit ? `| ${escapeHtml(unit.id)}` : ""} ${location ? `| ${escapeHtml(location.name)}` : ""} ${event.userEmail ? `| ${escapeHtml(event.userEmail)}` : ""}</p>
      </div>
      <span class="time">${nowText(event.at)}</span>
    </div>`;
  }).join("") || `<div class="empty-state"><p>No activity yet.</p></div>`;
}

function renderAll() {
  if (!currentUser) return;
  showLoggedIn();
  applyTheme();
  renderStats();
  renderLocationOptions();
  renderCategorySuggestions();
  renderTagFilter();
  renderInventory();
  renderLocations();
  renderUsers();
  renderActivity();
}

function renderScanUnit(unit, product, location, action) {
  const chipClass = unit.status === "in" ? "in" : "out";
  const chipText = unit.status === "in" ? "Checked in" : "Checked out";
  els.scanResult.innerHTML = `<div class="scan-card">
    <span class="status-chip ${chipClass}">${chipText}</span>
    <div class="scan-title">
      <h3>${escapeHtml(product.name)}</h3>
      <span class="time">${nowText(unit.lastActionAt)}</span>
    </div>
    <div class="meta-grid">
      <div><span>Unit barcode</span><strong>${escapeHtml(unit.id)}</strong></div>
      <div><span>Location</span><strong>${escapeHtml(location?.name || "Unassigned")}</strong></div>
      <div><span>Action</span><strong>${escapeHtml(action.replace("-", " "))}</strong></div>
      <div><span>User</span><strong>${escapeHtml(currentUser.email)}</strong></div>
    </div>
    <div class="barcode">${renderBarcode(unit.id, 68)}</div>
  </div>`;
}

function showLocationScan(location) {
  const treeIds = new Set(locationTreeIds(location.id));
  const locationProducts = state.products.filter((product) => treeIds.has(product.locationId));
  const locationProductIds = new Set(locationProducts.map((product) => product.id));
  const units = state.units.filter((unit) => locationProductIds.has(unit.productId));
  const children = locationChildren(location.id);
  const rows = units.map((unit) => {
    const product = byId(state.products, unit.productId);
    const productLocation = byId(state.locations, product?.locationId);
    return `<div class="activity-item">
      <div>
        <strong>${escapeHtml(product?.name || "Unknown item")}</strong>
        <p>${escapeHtml(unit.id)} | ${unit.status === "in" ? "stored in" : "checked out from"} ${escapeHtml(locationPath(productLocation))}</p>
      </div>
      <span class="small-chip ${unit.status}">${unit.status === "in" ? "In" : "Out"}</span>
    </div>`;
  }).join("");
  const recent = units.flatMap((unit) => unit.history.map((event) => ({ ...event, unit })))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 12)
    .map((event) => `<div class="activity-item">
      <div><strong>${escapeHtml(event.action.replace("-", " "))}</strong><p>${escapeHtml(byId(state.products, event.unit.productId)?.name || "Unknown item")} | ${escapeHtml(event.unit.id)} | ${escapeHtml(event.userEmail || "")}</p></div>
      <span class="time">${nowText(event.at)}</span>
    </div>`).join("");
  els.scanResult.innerHTML = `<div class="scan-card">
    <span class="status-chip location">Location</span>
    <div class="scan-title"><h3>${escapeHtml(locationPath(location))}</h3><span class="time">${escapeHtml(location.area || "")}</span></div>
    <div class="meta-grid">
      <div><span>Total units</span><strong>${units.length}</strong></div>
      <div><span>Checked out</span><strong>${units.filter((unit) => unit.status === "out").length}</strong></div>
    </div>
    <h4>Sub-locations</h4>
    <div class="history-list">${children.map((child) => `<div class="activity-item">
      <div><strong>${escapeHtml(child.name)}</strong><p>${escapeHtml(child.area || "No area set")} | ${productsInLocationTree(child.id).length} product type${productsInLocationTree(child.id).length === 1 ? "" : "s"}</p></div>
      <button type="button" data-action="scan-location" data-id="${escapeHtml(child.id)}">Open</button>
    </div>`).join("") || "<p>No sub-locations.</p>"}</div>
    <h4>Current items</h4>
    <div class="history-list">${rows || "<p>No items assigned to this location.</p>"}</div>
    <h4>Recent location history</h4>
    <div class="history-list">${recent || "<p>No location history yet.</p>"}</div>
  </div>`;
}

async function scanValue(rawValue) {
  const barcode = rawValue.trim().toUpperCase();
  if (!barcode) return;
  try {
    const result = await api("/api/scan", {
      method: "POST",
      body: JSON.stringify({ barcode })
    });
    applyServerState(result.state);
    if (result.type === "unit") renderScanUnit(result.unit, result.product, result.location, result.action);
    if (result.type === "location") showLocationScan(result.location);
  } catch (error) {
    els.scanResult.innerHTML = `<div class="scan-card">
      <span class="status-chip out">Not found</span>
      <div class="scan-title"><h3>No match for ${escapeHtml(barcode)}</h3></div>
      <p class="row-sub">${escapeHtml(error.message)}</p>
    </div>`;
  }
}

async function createItem(event) {
  event.preventDefault();
  const result = await api("/api/products", {
    method: "POST",
    body: JSON.stringify({
      name: els.itemName.value,
      locationId: els.itemLocation.value,
      quantity: Number(els.itemQuantity.value),
      category: els.itemCategory.value,
      tags: parseTags(els.itemTags.value),
      notes: els.itemNotes.value
    })
  });
  applyServerState(result.state);
  els.itemForm.reset();
  els.itemQuantity.value = 1;
  showProductDialog(result.product.id);
}

function locationOptionMarkup(selectedId) {
  return [`<option value="" ${!selectedId ? "selected" : ""}>Unassigned</option>`]
    .concat(state.locations.map((location) => `<option value="${escapeHtml(location.id)}" ${location.id === selectedId ? "selected" : ""}>${escapeHtml(location.name)}</option>`))
    .join("");
}

function showEditProductDialog(productId) {
  const product = byId(state.products, productId);
  if (!product) return;
  els.dialogTitle.textContent = `Edit ${product.name}`;
  els.dialogBody.innerHTML = `<form class="dialog-form" id="editProductForm">
    <label>
      Item name
      <input id="editProductName" required value="${escapeHtml(product.name)}" />
    </label>
    <label>
      Category
      <input id="editProductCategory" list="categorySuggestions" value="${escapeHtml(productCategory(product))}" />
    </label>
    <label>
      Tags
      <input id="editProductTags" value="${escapeHtml((product.tags || []).join(", "))}" />
    </label>
    <label>
      Storage location
      <select id="editProductLocation">${locationOptionMarkup(product.locationId)}</select>
    </label>
    <button class="primary-btn" type="submit">Save changes</button>
  </form>`;
  els.dialog.showModal();
  document.getElementById("editProductForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api(`/api/products/${encodeURIComponent(productId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: document.getElementById("editProductName").value,
          locationId: document.getElementById("editProductLocation").value,
          category: document.getElementById("editProductCategory").value,
          tags: parseTags(document.getElementById("editProductTags").value)
        })
      });
      applyServerState(result.state);
      els.dialog.close();
    } catch (error) {
      alert(error.message);
    }
  });
}

async function setQuantity(productId) {
  const product = byId(state.products, productId);
  const current = unitsForProduct(productId).length;
  const next = Number(prompt(`Set quantity for ${product.name}`, current));
  if (!Number.isFinite(next) || next < 0) return;
  try {
    const result = await api(`/api/products/${encodeURIComponent(productId)}/quantity`, {
      method: "PATCH",
      body: JSON.stringify({ quantity: next })
    });
    applyServerState(result.state);
  } catch (error) {
    alert(error.message);
  }
}

async function removeProduct(productId) {
  const product = byId(state.products, productId);
  if (!confirm(`Remove ${product.name} and all of its unit barcodes?`)) return;
  const result = await api(`/api/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
  applyServerState(result.state);
}

async function createLocation(event) {
  event.preventDefault();
  const result = await api("/api/locations", {
    method: "POST",
    body: JSON.stringify({ name: els.locationName.value, area: els.locationArea.value, parentId: els.locationParent.value })
  });
  applyServerState(result.state);
  els.locationForm.reset();
  showLocationLabel(result.location.id);
}

async function removeLocation(locationId) {
  const location = byId(state.locations, locationId);
  const assigned = state.products.filter((product) => product.locationId === locationId).length;
  const detail = assigned ? ` ${assigned} product type${assigned === 1 ? "" : "s"} will become Unassigned.` : "";
  if (!confirm(`Remove ${location.name}?${detail}`)) return;
  const result = await api(`/api/locations/${encodeURIComponent(locationId)}`, { method: "DELETE" });
  applyServerState(result.state);
}

async function createUser(event) {
  event.preventDefault();
  try {
    const result = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name: els.userName.value,
        email: els.userEmail.value,
        role: els.userRole.value,
        password: els.userPassword.value
      })
    });
    applyServerState(result.state);
    els.userForm.reset();
  } catch (error) {
    alert(error.message);
  }
}

function showProductDialog(productId) {
  const product = byId(state.products, productId);
  const location = byId(state.locations, product.locationId);
  const subtitle = `${location?.name || "Unassigned"} | ${productCategory(product)} | ${(product.tags || []).join(", ")}`;
  const labels = unitsForProduct(productId).map((unit) => labelCard({
    title: product.name,
    subtitle,
    barcode: unit.id,
    height: 58
  })).join("");
  els.dialogTitle.textContent = `${product.name} labels`;
  els.dialogBody.innerHTML = `<div class="label-grid">${labels}</div><p class="row-sub">Click a barcode to open a full-size single-label print view.</p>`;
  els.dialog.showModal();
}

function showLocationLabel(locationId) {
  const location = byId(state.locations, locationId);
  els.dialogTitle.textContent = `${location.name} location label`;
  els.dialogBody.innerHTML = `<div class="label-grid">${labelCard({
    title: location.name,
    subtitle: `${locationPath(location)} | ${location.area || "Storage location"}`,
    barcode: location.id,
    height: 68
  })}</div><p class="row-sub">Click the barcode to open a full-size single-label print view.</p>`;
  els.dialog.showModal();
}

function showAllLabels() {
  const itemLabels = state.products.flatMap((product) => unitsForProduct(product.id).map((unit) => {
    const location = byId(state.locations, product.locationId);
    return labelCard({
      title: product.name,
      subtitle: `${location?.name || "Unassigned"} | ${productCategory(product)} | ${(product.tags || []).join(", ")}`,
      barcode: unit.id,
      height: 58
    });
  })).join("");
  const locationLabels = state.locations.map((location) => labelCard({
    title: location.name,
    subtitle: `${locationPath(location)} | ${location.area || "Storage location"}`,
    barcode: location.id,
    height: 58
  })).join("");
  els.dialogTitle.textContent = "All printable labels";
  els.dialogBody.innerHTML = `<div class="label-grid">${locationLabels}${itemLabels}</div><p class="row-sub">Click a barcode to open a full-size single-label print view.</p>`;
  els.dialog.showModal();
}

function labelCard({ title, subtitle, barcode, height }) {
  return `<button class="print-label" type="button" data-action="single-label" data-barcode="${escapeHtml(barcode)}">
    <h4>${escapeHtml(title)}</h4>
    <p>${escapeHtml(subtitle || "")}</p>
    <div class="barcode">${renderBarcode(barcode, height)}</div>
  </button>`;
}

function showSingleLabel(barcode) {
  els.dialogTitle.textContent = barcode;
  els.dialogBody.innerHTML = `<div class="single-label-wrap">
    <div class="single-label">
      ${renderBarcode(barcode, 150)}
    </div>
  </div>
  <div class="single-label-actions">
    <button class="primary-btn" type="button" onclick="window.print()">Print This Barcode</button>
    <button class="ghost-btn" type="button" data-action="copy-single-label" data-barcode="${escapeHtml(barcode)}">Copy Barcode Text</button>
    <span class="copy-status" id="copyStatus" role="status"></span>
  </div>`;
  els.dialog.showModal();
}

async function copySingleLabelBarcode(barcode, button) {
  const status = document.getElementById("copyStatus");
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };
  try {
    await navigator.clipboard.writeText(barcode);
    setStatus("Copied barcode text");
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy Barcode Text";
      setStatus("");
    }, 1800);
  } catch (error) {
    setStatus(friendlyClipboardError(error));
  }
}

function friendlyClipboardError(error) {
  const message = String(error?.message || "");
  if (message.toLowerCase().includes("not focused") || message.toLowerCase().includes("not allowed")) {
    return "Clipboard blocked; click the app and try again";
  }
  return message || "Copy failed";
}

async function login(event) {
  event.preventDefault();
  els.loginError.textContent = "";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: els.loginEmail.value, password: els.loginPassword.value })
    });
    authToken = result.token;
    localStorage.setItem("avinventory-token", authToken);
    applyServerState(result.state);
    setView("scan");
  } catch (error) {
    els.loginError.textContent = error.message;
  }
}

async function restoreSession() {
  if (!authToken) {
    showLoggedOut();
    return;
  }
  try {
    const result = await api("/api/state");
    applyServerState(result);
    setView("scan");
  } catch {
    showLoggedOut();
  }
}

els.loginForm.addEventListener("submit", login);
els.logoutBtn.addEventListener("click", showLoggedOut);
els.themeToggle.addEventListener("click", toggleTheme);
els.navBtns.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
els.scanBtn.addEventListener("click", async () => {
  await scanValue(els.scanInput.value);
  els.scanInput.value = "";
  els.scanInput.focus();
});
els.scanInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.scanBtn.click();
  }
});
els.scanResult.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='scan-location']");
  if (!button) return;
  const location = byId(state.locations, button.dataset.id);
  if (location) showLocationScan(location);
});
document.addEventListener("click", () => {
  if (currentView === "scan" && currentUser) els.scanInput.focus();
});
els.itemForm.addEventListener("submit", createItem);
els.locationForm.addEventListener("submit", createLocation);
els.userForm.addEventListener("submit", createUser);
els.inventorySearch.addEventListener("input", renderInventory);
els.tagFilter.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.filterType === "category") {
    selectedCategory = button.dataset.category || "";
    selectedTag = "";
  }
  if (button.dataset.filterType === "tag") {
    selectedTag = button.dataset.tag || "";
  }
  renderTagFilter();
  renderInventory();
});
els.inventoryTable.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "view-product") showProductDialog(button.dataset.id);
  if (button.dataset.action === "edit-product") showEditProductDialog(button.dataset.id);
  if (button.dataset.action === "adjust-product") setQuantity(button.dataset.id);
  if (button.dataset.action === "remove-product") removeProduct(button.dataset.id);
});
els.locationList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "scan-location") {
    setView("scan");
    showLocationScan(byId(state.locations, button.dataset.id));
  }
  if (button.dataset.action === "print-location") showLocationLabel(button.dataset.id);
  if (button.dataset.action === "remove-location") removeLocation(button.dataset.id);
});
els.printLabelsBtn.addEventListener("click", showAllLabels);
els.resetDemoBtn.addEventListener("click", async () => {
  if (!confirm("Reset inventory demo data? Users will be kept.")) return;
  const result = await api("/api/reset-demo", { method: "POST", body: "{}" });
  applyServerState(result.state);
});

applyTheme();
restoreSession();
