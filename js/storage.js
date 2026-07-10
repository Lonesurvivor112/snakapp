/* ============ SnakApp storage ============
 * Data lives in memory and is mirrored two places on every change:
 *   1. localStorage (instant, always available — offline cache/fallback)
 *   2. A user-connected "live" JSON file on disk via the File System Access
 *      API (Chrome/Edge). The file handle persists in IndexedDB so the app
 *      reconnects across sessions. The file is also polled for external
 *      edits and reloaded when it changes.
 * Shape: { snacks: [], recipes: [], collections: [], lastPlan: null, prevPlanSnackIds: [] }
 */
const Storage = (() => {
  const KEY = "snakapp-data";
  const IDB_NAME = "snakapp-fs";
  const IDB_STORE = "handles";
  const HANDLE_KEY = "dbfile";
  const WRITE_DEBOUNCE_MS = 400;
  const POLL_MS = 3000;

  const defaults = () => ({
    snacks: [],
    recipes: [],
    collections: [],
    lastPlan: null,          // { seed, days: [{ day, snackId }] }
    prevPlanSnackIds: [],    // snack ids used in the plan before the current one
    lastDinnerPlan: null,    // { seed, days: [{ day, recipeId, customText }] }
    prevDinnerRecipeIds: [],
    groceryList: null,       // { items: [{name, amounts, from, checked}], recipeNames, createdAt }
    savedGroceryLists: [],   // [{ id, name, savedAt, list }]
    savedDinnerPlans: [],    // [{ id, name, savedAt, days }]
    categories: ["sweet", "savory", "salty", "healthy", "drink", "other"],
    tags: [],                // managed tag list (snacks can also carry ad-hoc tags)
  });

  /* Heal text damaged by an earlier import bug that split words after units
   * ("2 teaspoon s garlic", "pound ed thin"). Idempotent; runs on every load. */
  function repairSplitUnits(d) {
    const fix = (s) => typeof s === "string"
      ? s.replace(/\b(teaspoon|tablespoon|tsp|tbsp|cup|gram|kilogram|ounce|pound|liter|litre)\s+(s|ed)\b/gi, "$1$2")
      : s;
    (d.recipes || []).forEach(r => {
      r.ingredients = (r.ingredients || []).map(fix);
      r.instructions = (r.instructions || []).map(fix);
    });
    return d;
  }

  let data = loadLocal();

  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      return repairSplitUnits(Object.assign(defaults(), JSON.parse(raw)));
    } catch (e) {
      console.warn("SnakApp: could not parse saved data, starting fresh.", e);
      return defaults();
    }
  }

  function save() {
    data.updatedAt = new Date().toISOString(); // lets devices decide whose copy is newer
    localStorage.setItem(KEY, JSON.stringify(data));
    scheduleFileWrite();
    scheduleCloudWrite();
  }

  function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* ================= Live JSON file sync ================= */

  let fileHandle = null;
  let fileStatus = "disconnected"; // disconnected | connected | needs-permission | unsupported | error
  let lastSavedAt = null;
  let lastFileModified = 0;
  let writeTimer = null;
  let pollTimer = null;
  let writing = false;

  const statusListeners = [];
  const reloadListeners = [];

  const fsSupported = () => typeof window.showOpenFilePicker === "function";

  function fileInfo() {
    return {
      status: fileStatus,
      fileName: fileHandle ? fileHandle.name : null,
      lastSavedAt,
      supported: fsSupported(),
    };
  }
  function notifyStatus() { statusListeners.forEach(fn => fn(fileInfo())); }
  function onFileStatus(fn) { statusListeners.push(fn); }
  function onDataReloaded(fn) { reloadListeners.push(fn); }

  /* ---- tiny IndexedDB key-value store (file handles can't go in localStorage) ---- */
  function idbOpen() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbDel(key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  /* ---- writing ---- */
  function scheduleFileWrite() {
    if (!fileHandle || fileStatus !== "connected") return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(writeFile, WRITE_DEBOUNCE_MS);
  }

  async function writeFile() {
    if (!fileHandle) return;
    writing = true;
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      const f = await fileHandle.getFile();
      lastFileModified = f.lastModified;
      lastSavedAt = new Date();
      fileStatus = "connected";
    } catch (e) {
      fileStatus = (e && e.name === "NotAllowedError") ? "needs-permission" : "error";
      console.warn("SnakApp: live file write failed.", e);
    } finally {
      writing = false;
    }
    notifyStatus();
  }

  /* ---- reading ---- */
  async function readFileIntoData() {
    const f = await fileHandle.getFile();
    lastFileModified = f.lastModified;
    const text = await f.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      data = repairSplitUnits(Object.assign(defaults(), parsed));
      localStorage.setItem(KEY, JSON.stringify(data));
    } else {
      // brand-new empty file → seed it with whatever we have locally
      await writeFile();
    }
  }

  /* ---- watch for external edits to the file ---- */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!fileHandle || fileStatus !== "connected" || writing) return;
      try {
        const f = await fileHandle.getFile();
        if (f.lastModified > lastFileModified) {
          lastFileModified = f.lastModified;
          const text = await f.text();
          if (!text.trim()) return;
          data = Object.assign(defaults(), JSON.parse(text));
          localStorage.setItem(KEY, JSON.stringify(data));
          reloadListeners.forEach(fn => fn());
          notifyStatus();
        }
      } catch (e) { /* transient read errors (e.g. file mid-write) — skip this tick */ }
    }, POLL_MS);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ---- public file actions (must be called from a user gesture) ---- */
  const PICKER_TYPES = [{ description: "SnakApp database", accept: { "application/json": [".json"] } }];

  async function connectFile() {
    if (!fsSupported()) throw new Error("This browser doesn't support live file access. Use Chrome or Edge.");
    const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
    fileHandle = handle;
    await readFileIntoData();
    fileStatus = "connected";
    lastSavedAt = new Date();
    await idbSet(HANDLE_KEY, fileHandle);
    startPolling();
    notifyStatus();
  }

  async function createFile() {
    if (!fsSupported()) throw new Error("This browser doesn't support live file access. Use Chrome or Edge.");
    fileHandle = await window.showSaveFilePicker({ suggestedName: "snakapp-db.json", types: PICKER_TYPES });
    fileStatus = "connected";
    await writeFile();
    await idbSet(HANDLE_KEY, fileHandle);
    startPolling();
    notifyStatus();
  }

  async function reconnect() {
    if (!fileHandle) return false;
    const perm = await fileHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return false;
    await readFileIntoData();
    fileStatus = "connected";
    lastSavedAt = new Date();
    startPolling();
    notifyStatus();
    return true;
  }

  async function disconnectFile() {
    stopPolling();
    clearTimeout(writeTimer);
    fileHandle = null;
    fileStatus = "disconnected";
    lastSavedAt = null;
    await idbDel(HANDLE_KEY);
    notifyStatus();
  }

  /* ---- startup: restore the handle saved in a previous session ---- */
  async function initFileSync() {
    if (!fsSupported()) {
      fileStatus = "unsupported";
      notifyStatus();
      return;
    }
    try {
      fileHandle = await idbGet(HANDLE_KEY);
    } catch (e) { fileHandle = null; }
    if (!fileHandle) { notifyStatus(); return; }

    const perm = await fileHandle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      try {
        await readFileIntoData();
        fileStatus = "connected";
        lastSavedAt = new Date();
        startPolling();
      } catch (e) {
        fileStatus = "error";
      }
    } else {
      // Browser requires a click before re-granting access to the file
      fileStatus = "needs-permission";
    }
    notifyStatus();
  }

  /* ================= GitHub cloud sync ================= */
  /* Syncs the whole database to a JSON file in a PRIVATE GitHub repo via the
   * Contents API. Works on any device (including iOS, which lacks the File
   * System Access API). Config {token, owner, repo, path} lives in this
   * device's localStorage only — the token is never written into the database.
   * Newer copy wins, decided by the updatedAt stamp inside the data. */

  const CLOUD_KEY = "snakapp-cloud";
  const CLOUD_WRITE_DEBOUNCE_MS = 1500;
  const CLOUD_POLL_MS = 60000;

  let cloudCfg = null;
  let cloudStatus = "disconnected"; // disconnected | syncing | connected | error
  let cloudLastSyncedAt = null;
  let cloudSha = null;              // git blob sha of the remote file (needed to update it)
  let cloudWriteTimer = null;
  let cloudPollTimer = null;
  let cloudWriting = false;
  const cloudListeners = [];

  function cloudInfo() {
    return {
      status: cloudStatus,
      repo: cloudCfg ? cloudCfg.owner + "/" + cloudCfg.repo : null,
      path: cloudCfg ? cloudCfg.path : null,
      lastSyncedAt: cloudLastSyncedAt,
    };
  }
  function notifyCloud() { cloudListeners.forEach(fn => fn(cloudInfo())); }
  function onCloudStatus(fn) { cloudListeners.push(fn); }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function ghHeaders(extra) {
    return Object.assign({
      "Authorization": "Bearer " + cloudCfg.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }, extra);
  }
  function ghUrl(path) {
    return "https://api.github.com/repos/" + cloudCfg.owner + "/" + cloudCfg.repo + "/contents/" + path;
  }
  function ghError(res) {
    const map = {
      401: "token invalid or expired",
      403: "token lacks access to this repo (needs Contents read & write)",
      404: "repo or file not found — check the owner/name and that the token can see the private repo",
    };
    return new Error(map[res.status] || "GitHub error " + res.status);
  }

  /* sha comes from the directory listing — avoids the API's 1 MB content cap */
  async function ghGetSha() {
    const dir = cloudCfg.path.includes("/") ? cloudCfg.path.slice(0, cloudCfg.path.lastIndexOf("/")) : "";
    const res = await fetch(ghUrl(dir), { headers: ghHeaders() });
    if (!res.ok) throw ghError(res);
    const list = await res.json();
    const name = cloudCfg.path.split("/").pop();
    const entry = Array.isArray(list) ? list.find(f => f.name === name) : null;
    return entry ? entry.sha : null; // null → file doesn't exist yet
  }

  async function ghGetRaw() {
    const res = await fetch(ghUrl(cloudCfg.path), { headers: ghHeaders({ "Accept": "application/vnd.github.raw+json" }) });
    if (res.status === 404) return null;
    if (!res.ok) throw ghError(res);
    return await res.text();
  }

  async function ghPut(text, sha) {
    const body = { message: "SnakApp autosave", content: b64encode(text) };
    if (sha) body.sha = sha;
    const res = await fetch(ghUrl(cloudCfg.path), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw ghError(res);
    return (await res.json()).content.sha;
  }

  function scheduleCloudWrite() {
    if (!cloudCfg || cloudStatus === "disconnected") return;
    clearTimeout(cloudWriteTimer);
    cloudWriteTimer = setTimeout(writeCloud, CLOUD_WRITE_DEBOUNCE_MS);
  }

  async function writeCloud() {
    if (!cloudCfg) return;
    cloudWriting = true;
    try {
      const text = JSON.stringify(data, null, 2);
      try {
        cloudSha = await ghPut(text, cloudSha);
      } catch (e) {
        // sha went stale (edited elsewhere) — refresh and retry once, newest write wins
        cloudSha = await ghGetSha();
        cloudSha = await ghPut(text, cloudSha);
      }
      cloudLastSyncedAt = new Date();
      cloudStatus = "connected";
    } catch (e) {
      console.warn("SnakApp: cloud write failed.", e);
      cloudStatus = "error";
    } finally {
      cloudWriting = false;
    }
    notifyCloud();
  }

  function applyRemote(remoteText) {
    const remote = JSON.parse(remoteText);
    data = repairSplitUnits(Object.assign(defaults(), remote));
    localStorage.setItem(KEY, JSON.stringify(data));
    reloadListeners.forEach(fn => fn());
  }
  const stamp = (obj) => Date.parse((obj && obj.updatedAt) || 0) || 0;

  async function syncFromCloud({ preferRemoteWhenEqual }) {
    const remoteText = await ghGetRaw();
    cloudSha = await ghGetSha();
    if (remoteText && remoteText.trim()) {
      const remote = JSON.parse(remoteText);
      const remoteNewer = preferRemoteWhenEqual ? stamp(remote) >= stamp(data) : stamp(remote) > stamp(data);
      const remoteHasData = (remote.snacks || []).length || (remote.recipes || []).length;
      if (remoteNewer && remoteHasData) {
        applyRemote(remoteText);
        return;
      }
    }
    // Remote missing, empty, or older → push this device's data up
    if (stamp(data) || (data.snacks.length + data.recipes.length)) await writeCloud();
  }

  async function connectCloud(cfg) {
    cloudCfg = cfg;
    cloudStatus = "syncing";
    notifyCloud();
    try {
      await syncFromCloud({ preferRemoteWhenEqual: true });
      localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudCfg));
      cloudStatus = "connected";
      cloudLastSyncedAt = new Date();
      startCloudPolling();
      notifyCloud();
    } catch (e) {
      cloudCfg = null;
      cloudStatus = "disconnected";
      notifyCloud();
      throw e;
    }
  }

  function disconnectCloud() {
    clearInterval(cloudPollTimer);
    clearTimeout(cloudWriteTimer);
    cloudCfg = null;
    cloudSha = null;
    cloudStatus = "disconnected";
    cloudLastSyncedAt = null;
    localStorage.removeItem(CLOUD_KEY);
    notifyCloud();
  }

  function startCloudPolling() {
    clearInterval(cloudPollTimer);
    cloudPollTimer = setInterval(async () => {
      if (!cloudCfg || cloudWriting || cloudStatus !== "connected") return;
      try {
        const sha = await ghGetSha();
        if (sha && sha !== cloudSha) {
          const text = await ghGetRaw();
          cloudSha = sha;
          if (text && stamp(JSON.parse(text)) > stamp(data)) {
            applyRemote(text);
            cloudLastSyncedAt = new Date();
            notifyCloud();
          }
        }
      } catch (e) { /* transient network error — try again next tick */ }
    }, CLOUD_POLL_MS);
  }

  /* Manual "Sync Now": pull if the cloud is newer, otherwise push — then the
   * user can safely close knowing everything is up to date */
  async function syncNow() {
    if (!cloudCfg) throw new Error("No cloud database connected.");
    clearTimeout(cloudWriteTimer);
    cloudStatus = "syncing";
    notifyCloud();
    try {
      await syncFromCloud({ preferRemoteWhenEqual: false });
      cloudStatus = "connected";
      cloudLastSyncedAt = new Date();
      notifyCloud();
    } catch (e) {
      cloudStatus = "error";
      notifyCloud();
      throw e;
    }
  }

  async function initCloudSync() {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) { notifyCloud(); return; }
    try { cloudCfg = JSON.parse(raw); } catch (e) { return; }
    cloudStatus = "syncing";
    notifyCloud();
    try {
      await syncFromCloud({ preferRemoteWhenEqual: false });
      cloudStatus = "connected";
      cloudLastSyncedAt = new Date();
      startCloudPolling();
    } catch (e) {
      console.warn("SnakApp: cloud sync init failed.", e);
      cloudStatus = "error";
    }
    notifyCloud();
  }

  /* ================= Snacks ================= */
  function addSnack(snack) {
    snack.id = uid();
    snack.createdAt = new Date().toISOString();
    data.snacks.push(snack);
    save();
    return snack;
  }
  function updateSnack(id, patch) {
    const s = data.snacks.find(s => s.id === id);
    if (s) { Object.assign(s, patch); save(); }
    return s;
  }
  function deleteSnack(id) {
    data.snacks = data.snacks.filter(s => s.id !== id);
    data.collections.forEach(c => { c.snackIds = c.snackIds.filter(sid => sid !== id); });
    save();
  }

  /* ================= Recipes ================= */
  function addRecipe(recipe) {
    recipe.id = uid();
    recipe.createdAt = new Date().toISOString();
    data.recipes.push(recipe);
    save();
    return recipe;
  }
  function updateRecipe(id, patch) {
    const r = data.recipes.find(r => r.id === id);
    if (r) { Object.assign(r, patch); save(); }
    return r;
  }
  function deleteRecipe(id) {
    data.recipes = data.recipes.filter(r => r.id !== id);
    // Unlink any snacks that referenced this recipe (they stay, just no longer recipe-linked)
    data.snacks.forEach(s => { if (s.recipeId === id) { s.recipeId = null; } });
    save();
  }

  /* ================= Collections ================= */
  function addCollection(name) {
    const c = { id: uid(), name, snackIds: [] };
    data.collections.push(c);
    save();
    return c;
  }
  function deleteCollection(id) {
    data.collections = data.collections.filter(c => c.id !== id);
    save();
  }
  function addToCollection(collectionId, snackId) {
    const c = data.collections.find(c => c.id === collectionId);
    if (c && !c.snackIds.includes(snackId)) { c.snackIds.push(snackId); save(); }
  }
  function removeFromCollection(collectionId, snackId) {
    const c = data.collections.find(c => c.id === collectionId);
    if (c) { c.snackIds = c.snackIds.filter(id => id !== snackId); save(); }
  }

  /* ================= Plan ================= */
  function setPlan(plan) {
    if (data.lastPlan) {
      data.prevPlanSnackIds = data.lastPlan.days.map(d => d.snackId).filter(Boolean);
    }
    data.lastPlan = plan;
    const now = new Date().toISOString();
    plan.days.forEach(d => {
      const s = data.snacks.find(s => s.id === d.snackId);
      if (s) s.lastPlannedAt = now;
    });
    save();
  }

  function setDinnerPlan(plan) {
    if (data.lastDinnerPlan) {
      data.prevDinnerRecipeIds = [...new Set(data.lastDinnerPlan.days.map(d => d.recipeId).filter(Boolean))];
    }
    data.lastDinnerPlan = plan;
    const now = new Date().toISOString();
    plan.days.forEach(d => {
      const r = data.recipes.find(r => r.id === d.recipeId);
      if (r) r.lastPlannedAt = now;
    });
    save();
  }

  /* Replace the dinner plan without touching lastPlannedAt / previous-week
   * tracking — used for manual day edits and loading saved weeks */
  function updateDinnerPlan(plan) {
    data.lastDinnerPlan = plan;
    save();
  }

  function saveDinnerPlanAs(name) {
    if (!data.lastDinnerPlan) return null;
    const entry = {
      id: uid(), name, savedAt: new Date().toISOString(),
      days: JSON.parse(JSON.stringify(data.lastDinnerPlan.days)),
    };
    data.savedDinnerPlans.push(entry);
    save();
    return entry;
  }
  function loadSavedDinnerPlan(id) {
    const e = data.savedDinnerPlans.find(p => p.id === id);
    if (e) {
      data.lastDinnerPlan = { seed: 0, days: JSON.parse(JSON.stringify(e.days)), notes: [] };
      save();
    }
    return e;
  }
  function deleteSavedDinnerPlan(id) {
    data.savedDinnerPlans = data.savedDinnerPlans.filter(p => p.id !== id);
    save();
  }

  /* ================= Grocery list ================= */
  function setGroceryList(list) {
    data.groceryList = list;
    save();
  }

  function saveGroceryListAs(name) {
    if (!data.groceryList) return null;
    const entry = {
      id: uid(), name, savedAt: new Date().toISOString(),
      list: JSON.parse(JSON.stringify(data.groceryList)),
    };
    data.savedGroceryLists.push(entry);
    save();
    return entry;
  }
  function loadSavedGroceryList(id) {
    const e = data.savedGroceryLists.find(l => l.id === id);
    if (e) {
      data.groceryList = JSON.parse(JSON.stringify(e.list));
      save();
    }
    return e;
  }
  function deleteSavedGroceryList(id) {
    data.savedGroceryLists = data.savedGroceryLists.filter(l => l.id !== id);
    save();
  }

  /* ================= Categories & tags ================= */
  function setCategories(arr) {
    data.categories = arr;
    save();
  }
  function renameCategoryEverywhere(oldC, newC) {
    data.categories = [...new Set(data.categories.map(c => (c === oldC ? newC : c)))];
    data.snacks.forEach(s => { if (s.category === oldC) s.category = newC; });
    save();
  }

  function setTags(arr) {
    data.tags = arr;
    save();
  }
  function renameTagEverywhere(oldT, newT) {
    data.tags = [...new Set(data.tags.map(t => (t === oldT ? newT : t)))];
    data.snacks.forEach(s => {
      if (s.tags) s.tags = [...new Set(s.tags.map(t => (t === oldT ? newT : t)))];
    });
    save();
  }
  function removeTagEverywhere(t) {
    data.tags = data.tags.filter(x => x !== t);
    data.snacks.forEach(s => { if (s.tags) s.tags = s.tags.filter(x => x !== t); });
    save();
  }

  /* Plain snack-plan setter for manual day edits (doesn't touch
   * prevPlanSnackIds / lastPlannedAt bookkeeping like setPlan does) */
  function updatePlan(plan) {
    data.lastPlan = plan;
    save();
  }

  /* ================= Export / import ================= */
  function exportJSON() {
    return JSON.stringify(data, null, 2);
  }
  function importJSON(json) {
    const parsed = JSON.parse(json); // throws on invalid JSON
    if (!parsed || !Array.isArray(parsed.snacks) || !Array.isArray(parsed.recipes)) {
      throw new Error("File doesn't look like a SnakApp export.");
    }
    data = repairSplitUnits(Object.assign(defaults(), parsed));
    save();
  }

  return {
    get snacks() { return data.snacks; },
    get recipes() { return data.recipes; },
    get collections() { return data.collections; },
    get lastPlan() { return data.lastPlan; },
    get prevPlanSnackIds() { return data.prevPlanSnackIds; },
    get lastDinnerPlan() { return data.lastDinnerPlan; },
    get prevDinnerRecipeIds() { return data.prevDinnerRecipeIds; },
    get groceryList() { return data.groceryList; },
    get savedGroceryLists() { return data.savedGroceryLists; },
    get savedDinnerPlans() { return data.savedDinnerPlans; },
    get categories() { return data.categories; },
    get tags() { return data.tags; },
    setGroceryList, saveGroceryListAs, loadSavedGroceryList, deleteSavedGroceryList,
    updateDinnerPlan, saveDinnerPlanAs, loadSavedDinnerPlan, deleteSavedDinnerPlan, updatePlan,
    setCategories, renameCategoryEverywhere, setTags, renameTagEverywhere, removeTagEverywhere,
    addSnack, updateSnack, deleteSnack,
    addRecipe, updateRecipe, deleteRecipe,
    addCollection, deleteCollection, addToCollection, removeFromCollection,
    setPlan, setDinnerPlan, exportJSON, importJSON,
    // live file sync
    initFileSync, connectFile, createFile, reconnect, disconnectFile,
    onFileStatus, onDataReloaded, fileInfo,
    // GitHub cloud sync
    initCloudSync, connectCloud, disconnectCloud, onCloudStatus, cloudInfo, syncNow,
  };
})();
