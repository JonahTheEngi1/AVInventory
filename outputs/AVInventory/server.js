const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8001);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "avinventory.json");
const PUBLIC_DIR = __dirname;
const INIT_MANAGER_EMAIL = (process.env.INIT_MANAGER_EMAIL || "manager@avinventory.local").toLowerCase();
const INIT_MANAGER_PASSWORD = process.env.INIT_MANAGER_PASSWORD || "AVInventory123!";

const sessions = new Map();

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function slug(value, fallback = "ITEM") {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28) || fallback;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const hash = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expected, "hex"));
}

function compactBarcodeId(prefix, exists) {
  let id;
  do {
    id = `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  } while (exists(id));
  return id;
}

function makeInitialData() {
  const now = new Date().toISOString();
  const usedLocationIds = new Set();
  const usedUnitIds = new Set();
  const bin4Id = compactBarcodeId("AVL", (id) => usedLocationIds.has(id));
  usedLocationIds.add(bin4Id);
  const rackAId = compactBarcodeId("AVL", (id) => usedLocationIds.has(id));
  usedLocationIds.add(rackAId);
  const locations = [
    { id: bin4Id, name: "Bin 4", area: "AV Closet" },
    { id: rackAId, name: "Rack A", area: "Stage Storage" }
  ];
  const products = [
    { id: "ITEM-8FT-CABLE", name: "8FT Extension Cable", locationId: bin4Id, notes: "Black Edison cable", category: "Power", tags: ["Cable", "Extension"] },
    { id: "ITEM-HDMI-15", name: "15FT HDMI Cable", locationId: bin4Id, notes: "Labeled AV", category: "Video", tags: ["Cable", "HDMI"] },
    { id: "ITEM-DI-BOX", name: "Passive DI Box", locationId: rackAId, notes: "Audio kit", category: "Audio", tags: ["DI", "Stage"] }
  ];
  const units = [];
  products.forEach((product, productIndex) => {
    const count = productIndex === 2 ? 2 : 4;
    for (let i = 1; i <= count; i += 1) {
      const unitId = compactBarcodeId("AVU", (id) => usedUnitIds.has(id));
      usedUnitIds.add(unitId);
      units.push({
        id: unitId,
        productId: product.id,
        status: "in",
        lastActionAt: now,
        history: [{ action: "created", at: now, role: "Manager", locationId: product.locationId, userEmail: INIT_MANAGER_EMAIL }]
      });
    }
  });
  return {
    locations,
    products,
    units,
    activity: [],
    users: [{
      id: "USER-INITIAL-MANAGER",
      name: "Initial Manager",
      email: INIT_MANAGER_EMAIL,
      role: "manager",
      passwordHash: hashPassword(INIT_MANAGER_PASSWORD),
      createdAt: now
    }]
  };
}

function loadData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const initial = makeInitialData();
    saveData(initial);
    return initial;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  data.locations ||= [];
  data.products ||= [];
  data.units ||= [];
  data.activity ||= [];
  data.users ||= [];
  let migrated = false;
  data.products.forEach((product) => {
    if (!product.category) {
      product.category = "General";
      migrated = true;
    }
    if (!Array.isArray(product.tags)) {
      product.tags = [];
      migrated = true;
    }
  });
  if (!data.users.some((user) => user.role === "manager")) {
    data.users.push(makeInitialData().users[0]);
    migrated = true;
  }
  if (migrated) saveData(data);
  return data;
}

function saveData(data) {
  ensureDataDir();
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

let data = loadData();

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function stateFor(user) {
  return {
    user: publicUser(user),
    locations: data.locations,
    products: data.products,
    units: data.units,
    activity: data.activity,
    users: user.role === "manager" ? data.users.map(publicUser) : []
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7);
}

function getUser(req) {
  const token = getBearer(req);
  const userId = sessions.get(token);
  if (!userId) return null;
  return data.users.find((user) => user.id === userId) || null;
}

function requireUser(req, res) {
  const user = getUser(req);
  if (!user) sendError(res, 401, "Please sign in.");
  return user;
}

function requireManager(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "manager") {
    sendError(res, 403, "Manager access required.");
    return null;
  }
  return user;
}

function productById(id) {
  return data.products.find((product) => product.id === id);
}

function locationById(id) {
  return data.locations.find((location) => location.id === id);
}

function unitById(id) {
  return data.units.find((unit) => unit.id === id);
}

function unitsForProduct(productId) {
  return data.units.filter((unit) => unit.productId === productId);
}

function uniqueProductId(name) {
  const base = `ITEM-${slug(name)}`;
  let id = base;
  let index = 2;
  while (productById(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function uniqueLocationId(name) {
  return compactBarcodeId("AVL", locationById);
}

function uniqueUnitId() {
  return compactBarcodeId("AVU", unitById);
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return [...new Set(list.map((tag) => String(tag).trim()).filter(Boolean))]
    .map((tag) => tag.slice(0, 32));
}

function normalizeCategory(category) {
  return String(category || "General").trim().slice(0, 32) || "General";
}

function addUnits(productId, count, user) {
  const product = productById(productId);
  for (let i = 1; i <= count; i += 1) {
    const at = new Date().toISOString();
    data.units.push({
      id: uniqueUnitId(),
      productId,
      status: "in",
      lastActionAt: at,
      history: [{ action: "created", at, role: user.role, locationId: product.locationId, userEmail: user.email }]
    });
  }
}

function logActivity(action, user, details = {}) {
  data.activity.unshift({
    id: crypto.randomUUID(),
    action,
    at: new Date().toISOString(),
    userEmail: user.email,
    role: user.role,
    ...details
  });
  data.activity = data.activity.slice(0, 200);
}

function handleScan(req, res, user, body) {
  const barcode = String(body.barcode || "").trim().toUpperCase();
  if (!barcode) return sendError(res, 400, "Barcode is required.");
  const unit = unitById(barcode);
  const location = locationById(barcode);

  if (unit) {
    const product = productById(unit.productId);
    const location = locationById(product.locationId);
    const nextStatus = unit.status === "in" ? "out" : "in";
    const action = nextStatus === "out" ? "checked-out" : "checked-in";
    const at = new Date().toISOString();
    unit.status = nextStatus;
    unit.lastActionAt = at;
    unit.history.unshift({ action, at, role: user.role, locationId: location?.id || "", userEmail: user.email });
    logActivity(action, user, { unitId: unit.id, productId: product.id, locationId: location?.id || "" });
    saveData(data);
    return sendJson(res, 200, { type: "unit", action, unit, product, location, state: stateFor(user) });
  }

  if (location) {
    logActivity("location-scan", user, { locationId: location.id, label: location.name });
    saveData(data);
    return sendJson(res, 200, { type: "location", location, state: stateFor(user) });
  }

  return sendError(res, 404, "No item or location matched that barcode.");
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = data.users.find((entry) => entry.email === email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendError(res, 401, "Invalid email or password.");
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, user.id);
      return sendJson(res, 200, { token, state: stateFor(user) });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, stateFor(user));
    }

    if (req.method === "POST" && url.pathname === "/api/scan") {
      const user = requireUser(req, res);
      if (!user) return;
      return handleScan(req, res, user, await readBody(req));
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const user = requireManager(req, res);
      if (!user) return;
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const locationId = String(body.locationId || "").trim();
      const quantity = Math.max(1, Number(body.quantity) || 1);
      const category = normalizeCategory(body.category);
      if (!name) return sendError(res, 400, "Item name is required.");
      if (locationId && !locationById(locationId)) return sendError(res, 400, "Valid location is required.");
      const product = {
        id: uniqueProductId(name),
        name,
        locationId,
        notes: String(body.notes || "").trim(),
        category,
        tags: normalizeTags(body.tags)
      };
      data.products.push(product);
      addUnits(product.id, quantity, user);
      logActivity("created-item", user, { productId: product.id, label: product.name, locationId });
      saveData(data);
      return sendJson(res, 201, { product, state: stateFor(user) });
    }

    const productPatchMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (req.method === "PATCH" && productPatchMatch) {
      const user = requireManager(req, res);
      if (!user) return;
      const product = productById(decodeURIComponent(productPatchMatch[1]));
      if (!product) return sendError(res, 404, "Product not found.");
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const locationId = String(body.locationId || "").trim();
      const category = normalizeCategory(body.category);
      if (!name) return sendError(res, 400, "Item name is required.");
      if (locationId && !locationById(locationId)) return sendError(res, 400, "Valid location is required.");
      product.name = name;
      product.locationId = locationId;
      product.category = category;
      product.tags = normalizeTags(body.tags);
      logActivity("edited-item", user, { productId: product.id, label: product.name, locationId });
      saveData(data);
      return sendJson(res, 200, { product, state: stateFor(user) });
    }

    const quantityMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/quantity$/);
    if (req.method === "PATCH" && quantityMatch) {
      const user = requireManager(req, res);
      if (!user) return;
      const product = productById(decodeURIComponent(quantityMatch[1]));
      if (!product) return sendError(res, 404, "Product not found.");
      const body = await readBody(req);
      const next = Math.max(0, Number(body.quantity));
      if (!Number.isFinite(next)) return sendError(res, 400, "Quantity must be a number.");
      const current = unitsForProduct(product.id).length;
      if (next > current) addUnits(product.id, next - current, user);
      if (next < current) {
        const removable = unitsForProduct(product.id).filter((unit) => unit.status === "in").slice(0, current - next);
        if (removable.length < current - next) {
          return sendError(res, 409, "Some units are checked out. Check them in before reducing quantity that far.");
        }
        data.units = data.units.filter((unit) => !removable.some((remove) => remove.id === unit.id));
      }
      logActivity("set-quantity", user, { productId: product.id, label: `${product.name} to ${next}`, locationId: product.locationId });
      saveData(data);
      return sendJson(res, 200, { state: stateFor(user) });
    }

    const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (req.method === "DELETE" && productMatch) {
      const user = requireManager(req, res);
      if (!user) return;
      const productId = decodeURIComponent(productMatch[1]);
      const product = productById(productId);
      if (!product) return sendError(res, 404, "Product not found.");
      data.products = data.products.filter((entry) => entry.id !== productId);
      data.units = data.units.filter((unit) => unit.productId !== productId);
      logActivity("removed-item", user, { productId, label: product.name, locationId: product.locationId });
      saveData(data);
      return sendJson(res, 200, { state: stateFor(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/locations") {
      const user = requireManager(req, res);
      if (!user) return;
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      if (!name) return sendError(res, 400, "Location name is required.");
      const location = { id: uniqueLocationId(name), name, area: String(body.area || "").trim() };
      data.locations.push(location);
      logActivity("created-location", user, { locationId: location.id, label: location.name });
      saveData(data);
      return sendJson(res, 201, { location, state: stateFor(user) });
    }

    const locationMatch = url.pathname.match(/^\/api\/locations\/([^/]+)$/);
    if (req.method === "DELETE" && locationMatch) {
      const user = requireManager(req, res);
      if (!user) return;
      const locationId = decodeURIComponent(locationMatch[1]);
      const location = locationById(locationId);
      if (!location) return sendError(res, 404, "Location not found.");
      data.locations = data.locations.filter((entry) => entry.id !== locationId);
      data.products.forEach((product) => {
        if (product.locationId === locationId) product.locationId = "";
      });
      logActivity("removed-location", user, { locationId, label: location.name });
      saveData(data);
      return sendJson(res, 200, { state: stateFor(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      const user = requireManager(req, res);
      if (!user) return;
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = body.role === "manager" ? "manager" : "associate";
      const name = String(body.name || "").trim();
      if (!email || !password || !name) return sendError(res, 400, "Name, email, and password are required.");
      if (password.length < 8) return sendError(res, 400, "Password must be at least 8 characters.");
      if (data.users.some((entry) => entry.email === email)) return sendError(res, 409, "A user with that email already exists.");
      const newUser = {
        id: `USER-${crypto.randomUUID()}`,
        name,
        email,
        role,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };
      data.users.push(newUser);
      logActivity("created-user", user, { label: `${name} (${role})` });
      saveData(data);
      return sendJson(res, 201, { user: publicUser(newUser), state: stateFor(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/reset-demo") {
      const user = requireManager(req, res);
      if (!user) return;
      const users = data.users;
      data = makeInitialData();
      data.users = users;
      logActivity("reset-demo", user, { label: "Demo inventory reset" });
      saveData(data);
      return sendJson(res, 200, { state: stateFor(user) });
    }

    return sendError(res, 404, "API route not found.");
  } catch (error) {
    return sendError(res, 500, error.message || "Server error.");
  }
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, "Forbidden.");
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`AVInventory listening on port ${PORT}`);
  console.log(`Initial manager: ${INIT_MANAGER_EMAIL}`);
});
