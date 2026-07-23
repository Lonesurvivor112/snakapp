/* ============ SnakApp UI ============ */
(() => {

  /* User-editable (Settings tab); union with in-use values so nothing vanishes */
  function allCategories() {
    return [...new Set([...Storage.categories, ...Storage.snacks.map(s => s.category).filter(Boolean)])];
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function stars(rating) {
    const r = rating || 0;
    return "★".repeat(r) + "☆".repeat(5 - r);
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add("hidden"), 2500);
  }

  /* ================= Tabs ================= */
  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
      $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
    });
  });

  /* ================= Modal ================= */
  function openModal(html) {
    $("#modal-content").innerHTML = html;
    $("#modal-overlay").classList.remove("hidden");
  }
  function closeModal() {
    $("#modal-overlay").classList.add("hidden");
    $("#modal-content").innerHTML = "";
  }
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target === $("#modal-overlay")) closeModal();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  /* ================= Picture field (URL or upload) ================= */

  /* Downscale + compress an uploaded picture so it stores compactly as a data URL */
  function fileToDataUrl(file, maxDim = 640) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("unreadable image")); };
      img.src = URL.createObjectURL(file);
    });
  }

  function imageFieldHtml(value) {
    const isData = (value || "").startsWith("data:");
    return `
      <div class="form-field full">
        <label>Picture (link or upload)</label>
        <div class="img-input-row">
          <input name="image" type="url" value="${isData ? "" : esc(value)}" placeholder="https://… or use Upload">
          <button type="button" class="btn btn-ghost img-upload-btn">📷 Upload</button>
          <input type="file" class="img-file" accept="image/*" hidden>
          <input type="hidden" name="imageData" value="${isData ? esc(value) : ""}">
        </div>
        <img class="img-preview ${value ? "" : "hidden"}" src="${esc(value || "")}" alt="">
      </div>`;
  }

  function wireImageField(form) {
    const urlInput = form.querySelector('input[name="image"]');
    const fileInput = form.querySelector(".img-file");
    const hidden = form.querySelector('input[name="imageData"]');
    const preview = form.querySelector(".img-preview");
    const btn = form.querySelector(".img-upload-btn");
    if (!btn) return;
    const setPreview = (src) => {
      if (src) { preview.src = src; preview.classList.remove("hidden"); }
      else { preview.classList.add("hidden"); }
    };
    btn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        hidden.value = dataUrl;
        urlInput.value = "";
        setPreview(dataUrl);
      } catch (e) {
        toast("Could not read that image file");
      }
    });
    urlInput.addEventListener("input", () => {
      hidden.value = "";
      setPreview(urlInput.value.trim());
    });
  }

  /* Uploaded picture wins over a typed URL (typing clears the upload) */
  function formImage(fd) {
    return String(fd.get("imageData") || fd.get("image") || "").trim();
  }

  /* ================= Snacks ================= */

  function snackFormHtml(snack = {}) {
    const recipes = Storage.recipes;
    return `
      <h2>${snack.id ? "Edit Snack" : "Add Snack"}</h2>
      <form id="snack-form" class="form-grid">
        <div class="form-field full">
          <label>Name *</label>
          <input name="name" required value="${esc(snack.name)}">
        </div>
        <div class="form-field">
          <label>Category</label>
          <select name="category">
            ${allCategories().map(c => `<option value="${esc(c)}" ${snack.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label>Rating</label>
          <select name="rating">
            ${[0,1,2,3,4,5].map(r => `<option value="${r}" ${(snack.rating ?? 3) === r ? "selected" : ""}>${r ? "★".repeat(r) : "unrated"}</option>`).join("")}
          </select>
        </div>
        <div class="form-field full">
          <label>Tags (comma-separated)</label>
          <input name="tags" value="${esc((snack.tags || []).join(", "))}" placeholder="crunchy, chocolate, gluten-free">
        </div>
        ${imageFieldHtml(snack.image)}
        <div class="form-field full">
          <label>Purchase link</label>
          <input name="purchaseUrl" type="url" value="${esc(snack.purchaseUrl)}">
        </div>
        <div class="form-field">
          <label>Linked recipe</label>
          <select name="recipeId">
            <option value="">— none —</option>
            ${recipes.map(r => `<option value="${r.id}" ${snack.recipeId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label>Homemade</label>
          <label class="check-label" style="margin-top:0.4rem"><input type="checkbox" name="homemade" ${snack.homemade ? "checked" : ""}> Made at home</label>
        </div>
        <div class="form-field full">
          <label>Notes</label>
          <textarea name="notes">${esc(snack.notes)}</textarea>
        </div>
        <div class="form-actions full">
          <button type="button" class="btn btn-ghost" id="snack-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${snack.id ? "Save" : "Add Snack"}</button>
        </div>
      </form>`;
  }

  function openSnackForm(snack, importedDraft) {
    openModal(snackFormHtml(snack || importedDraft || {}));
    $("#snack-cancel").addEventListener("click", closeModal);
    wireImageField($("#snack-form"));
    $("#snack-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const values = {
        name: fd.get("name").trim(),
        category: fd.get("category"),
        rating: parseInt(fd.get("rating")),
        tags: fd.get("tags").split(",").map(t => t.trim().toLowerCase()).filter(Boolean),
        image: formImage(fd),
        purchaseUrl: fd.get("purchaseUrl").trim(),
        recipeId: fd.get("recipeId") || null,
        homemade: fd.get("homemade") === "on",
        notes: fd.get("notes").trim(),
      };
      if (snack && snack.id) {
        Storage.updateSnack(snack.id, values);
        toast("Snack updated");
      } else {
        values.favorite = false;
        Storage.addSnack(values);
        toast("Snack added");
      }
      // Any newly typed tags join the managed list (Settings → Tags)
      const newTags = values.tags.filter(t => !Storage.tags.includes(t));
      if (newTags.length) {
        Storage.setTags([...Storage.tags, ...newTags]);
        renderTagsEditor();
      }
      closeModal();
      renderSnacks();
      renderFilterOptions();
    });
  }

  function snackCardHtml(snack) {
    const homemade = Planner.isHomemade(snack);
    return `
      <div class="card" data-id="${snack.id}">
        ${snack.image ? `<img class="card-img" src="${esc(snack.image)}" alt="" onerror="this.remove()">` : ""}
        <div class="card-body">
          <div class="card-title-row">
            <h3 class="card-title">${esc(snack.name)}</h3>
            <button class="fav-btn" data-action="fav" title="Toggle favorite">${snack.favorite ? "❤️" : "🤍"}</button>
          </div>
          <div class="card-meta">${esc(snack.category)} · <span class="stars">${stars(snack.rating)}</span></div>
          <div class="tag-row">
            ${homemade ? `<span class="tag homemade">homemade</span>` : ""}
            ${(snack.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
          </div>
          ${snack.notes ? `<p class="card-notes">${esc(snack.notes)}</p>` : ""}
          ${snack.purchaseUrl ? `<a class="source-link" href="${esc(snack.purchaseUrl)}" target="_blank" rel="noopener">Buy ↗</a>` : ""}
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-small" data-action="edit">Edit</button>
          <button class="btn btn-ghost btn-small" data-action="collect">Add to Collection</button>
          ${snack.recipeId
            ? `<button class="btn btn-ghost btn-small" data-action="view-recipe">Recipe</button>`
            : `<button class="btn btn-ghost btn-small" data-action="make-recipe" title="Create a linked recipe from this snack">+ Recipe</button>`}
          <button class="btn btn-danger btn-small" data-action="delete">Delete</button>
        </div>
      </div>`;
  }

  function getSnackFilters() {
    return {
      search: $("#snack-search").value.trim().toLowerCase(),
      category: $("#snack-filter-category").value,
      tag: $("#snack-filter-tag").value,
      minRating: parseInt($("#snack-filter-rating").value),
      favOnly: $("#snack-filter-fav").checked,
    };
  }

  function renderSnacks() {
    const f = getSnackFilters();
    const filtered = Storage.snacks.filter(s =>
      (!f.search || s.name.toLowerCase().includes(f.search) || (s.tags || []).some(t => t.includes(f.search))) &&
      (!f.category || s.category === f.category) &&
      (!f.tag || (s.tags || []).includes(f.tag)) &&
      ((s.rating || 0) >= f.minRating) &&
      (!f.favOnly || s.favorite)
    );
    $("#snack-grid").innerHTML = filtered.map(snackCardHtml).join("");
    $("#snack-empty").classList.toggle("hidden", Storage.snacks.length > 0);
  }

  function renderFilterOptions() {
    const catSel = $("#snack-filter-category");
    const current = catSel.value;
    catSel.innerHTML = `<option value="">All categories</option>` +
      allCategories().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    catSel.value = current;

    const tagSel = $("#snack-filter-tag");
    const currentTag = tagSel.value;
    const tags = [...new Set([...Storage.tags, ...Storage.snacks.flatMap(s => s.tags || [])])].sort();
    tagSel.innerHTML = `<option value="">All tags</option>` +
      tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    tagSel.value = currentTag;
  }

  $("#add-snack-btn").addEventListener("click", () => openSnackForm(null));

  function setSnackImportStatus(msg, isError) {
    const el = $("#snack-import-status");
    if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
  }

  function openProductPicker(results, query) {
    openModal(`
      <h2>Results for “${esc(query)}”</h2>
      <p class="card-meta">Tap the right product — then review and save.</p>
      <div class="product-pick-grid">
        ${results.map((p, i) => `
          <button class="product-pick" data-i="${i}">
            ${p.image ? `<img src="${esc(p.image)}" alt="" onerror="this.remove()">` : `<div class="product-pick-noimg">🛍️</div>`}
            <span>${esc(p.name)}</span>
            <span class="card-meta">${esc([p.brand, p.quantity].filter(Boolean).join(" · "))}</span>
          </button>`).join("")}
      </div>`);
    $(".product-pick-grid").addEventListener("click", (e) => {
      const btn = e.target.closest(".product-pick");
      if (!btn) return;
      const p = results[+btn.dataset.i];
      setSnackImportStatus("Review and save.");
      openSnackForm(null, {
        name: p.name,
        category: p.category,
        image: p.image,
        notes: [p.brand, p.quantity].filter(Boolean).join(" · "),
        purchaseUrl: "",
        tags: [],
      });
    });
  }

  $("#snack-import-btn").addEventListener("click", async () => {
    const url = $("#snack-import-url").value.trim();
    if (!url) { setSnackImportStatus("Paste a product URL or type a snack name first.", true); return; }

    // Plain text (not a URL) → search the food database by name
    if (!/^https?:\/\//i.test(url)) {
      setSnackImportStatus("Searching for “" + url + "”…");
      try {
        const results = await Importer.searchProducts(url);
        if (!results.length) {
          setSnackImportStatus("No matches for that name — try adding the brand, or paste a product URL.", true);
          return;
        }
        setSnackImportStatus(`Found ${results.length} match(es) — pick the right one.`);
        openProductPicker(results, url);
        $("#snack-import-url").value = "";
      } catch (err) {
        setSnackImportStatus("Search failed: " + err.message, true);
      }
      return;
    }

    setSnackImportStatus("Looking up product…");
    try {
      const draft = await Importer.importProduct(url);
      const statusByMethod = {
        "barcode": "Product found via barcode lookup — review and save.",
        "name-search": "Barcode wasn't in the databases; matched by product name instead — double-check it's the right item.",
        "product-schema": "Product info found on the page — review and save.",
        "opengraph": "Got basic info from the page — review and save.",
        "slug": "Store blocks lookups and the barcode wasn't in the product database — name guessed from the URL. Add details and a picture.",
      };
      setSnackImportStatus(statusByMethod[draft.importMethod] || "Imported — review and save.");
      openSnackForm(null, draft);
      $("#snack-import-url").value = "";
    } catch (err) {
      setSnackImportStatus("Import failed: " + err.message, true);
    }
  });
  ["snack-search", "snack-filter-category", "snack-filter-tag", "snack-filter-rating", "snack-filter-fav"]
    .forEach(id => $("#" + id).addEventListener("input", renderSnacks));

  $("#snack-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const card = btn.closest(".card");
    const snack = Storage.snacks.find(s => s.id === card.dataset.id);
    if (!snack) return;

    switch (btn.dataset.action) {
      case "fav":
        Storage.updateSnack(snack.id, { favorite: !snack.favorite });
        renderSnacks();
        break;
      case "edit":
        openSnackForm(snack);
        break;
      case "delete":
        if (confirm(`Delete "${snack.name}"?`)) {
          Storage.deleteSnack(snack.id);
          renderSnacks();
          renderCollections();
        }
        break;
      case "view-recipe": {
        const recipe = Storage.recipes.find(r => r.id === snack.recipeId);
        if (recipe) openRecipeDetail(recipe);
        break;
      }
      case "make-recipe":
        openRecipeForm(null, { name: snack.name, image: snack.image || "" }, (created) => {
          Storage.updateSnack(snack.id, { recipeId: created.id, homemade: true });
          renderSnacks();
          toast("Recipe created and linked to this snack");
        });
        break;
      case "collect":
        openAddToCollection(snack);
        break;
    }
  });

  /* ================= Recipes ================= */

  function minutesLabel(mins) {
    if (!mins) return "";
    if (mins < 60) return mins + " min";
    const h = Math.floor(mins / 60), m = mins % 60;
    return h + " h" + (m ? " " + m + " min" : "");
  }

  function recipeCardHtml(recipe) {
    return `
      <div class="card" data-id="${recipe.id}">
        ${recipe.image ? `<img class="card-img" src="${esc(recipe.image)}" alt="" onerror="this.remove()">` : ""}
        <div class="card-body">
          <h3 class="card-title">${esc(recipe.name)}</h3>
          <div class="card-meta">
            ${recipe.totalTime ? "⏱ " + minutesLabel(recipe.totalTime) + " · " : ""}
            ${recipe.servings ? esc(recipe.servings) + " · " : ""}
            ${(recipe.ingredients || []).length} ingredients
          </div>
          ${recipe.sourceUrl ? `<a class="source-link" href="${esc(recipe.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ""}
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-small" data-action="cook">🍳 Cook</button>
          <button class="btn btn-ghost btn-small" data-action="view">View</button>
          <button class="btn btn-ghost btn-small" data-action="edit">Edit</button>
          <button class="btn btn-ghost btn-small" data-action="copy">Copy</button>
          <button class="btn btn-ghost btn-small" data-action="to-catalog" title="Add this recipe to your snack catalog">+ Snacks</button>
          <button class="btn btn-danger btn-small" data-action="delete">Delete</button>
        </div>
      </div>`;
  }

  function renderRecipes() {
    const q = $("#recipe-search").value.trim().toLowerCase();
    const filtered = Storage.recipes.filter(r =>
      !q || r.name.toLowerCase().includes(q) ||
      (r.ingredients || []).some(i => i.toLowerCase().includes(q))
    );
    $("#recipe-grid").innerHTML = filtered.map(recipeCardHtml).join("");
    $("#recipe-empty").classList.toggle("hidden", Storage.recipes.length > 0);
  }

  function openRecipeDetail(recipe) {
    openModal(`
      <div class="recipe-detail">
        <h2>${esc(recipe.name)}</h2>
        <button class="btn btn-primary btn-small" id="detail-cook-btn">🍳 Cook this</button>
        ${recipe.image ? `<img src="${esc(recipe.image)}" alt="" onerror="this.remove()">` : ""}
        <div class="times">
          ${recipe.prepTime ? `<span>Prep: ${minutesLabel(recipe.prepTime)}</span>` : ""}
          ${recipe.cookTime ? `<span>Cook: ${minutesLabel(recipe.cookTime)}</span>` : ""}
          ${recipe.totalTime ? `<span>Total: ${minutesLabel(recipe.totalTime)}</span>` : ""}
          ${recipe.servings ? `<span>Serves: ${esc(recipe.servings)}</span>` : ""}
          ${recipe.nutrition ? `<span>${esc(recipe.nutrition)}</span>` : ""}
        </div>
        <h3>Ingredients</h3>
        <ul>${(recipe.ingredients || []).map(i => `<li>${esc(i)}</li>`).join("") || "<li><em>none listed</em></li>"}</ul>
        <h3>Instructions</h3>
        <ol>${(recipe.instructions || []).map(s => `<li>${esc(s)}</li>`).join("") || "<li><em>none listed</em></li>"}</ol>
        ${recipe.sourceUrl ? `<a class="source-link" href="${esc(recipe.sourceUrl)}" target="_blank" rel="noopener">Original source ↗</a>` : ""}
      </div>`);
    $("#detail-cook-btn").addEventListener("click", () => openCookMode(recipe));
  }

  /* ---- Cook mode: tick off ingredients and steps; progress persists ---- */
  function openCookMode(recipe) {
    const prog = recipe.cookProgress || { ing: [], steps: [] };
    const item = (text, kind, i, checked) =>
      `<li class="${checked ? "done" : ""}"><label><input type="checkbox" data-kind="${kind}" data-idx="${i}" ${checked ? "checked" : ""}> <span>${esc(text)}</span></label></li>`;

    openModal(`
      <div class="cook-mode">
        <h2>🍳 ${esc(recipe.name)}</h2>
        <p class="card-meta" id="cook-progress-text"></p>
        <h3>Ingredients</h3>
        <ul class="checklist">
          ${(recipe.ingredients || []).map((t, i) => item(t, "ing", i, !!prog.ing[i])).join("") || "<li><em>No ingredients listed</em></li>"}
        </ul>
        <h3>Steps</h3>
        <ol class="checklist">
          ${(recipe.instructions || []).map((t, i) => item(t, "steps", i, !!prog.steps[i])).join("") || "<li><em>No steps listed</em></li>"}
        </ol>
        <div class="form-actions">
          <button class="btn btn-ghost" id="cook-reset">Reset checklist</button>
          <button class="btn btn-primary" id="cook-close">Close</button>
        </div>
      </div>`);

    const updateProgressText = () => {
      const p = recipe.cookProgress || { ing: [], steps: [] };
      const ingDone = (p.ing || []).filter(Boolean).length;
      const stepDone = (p.steps || []).filter(Boolean).length;
      const ingTotal = (recipe.ingredients || []).length;
      const stepTotal = (recipe.instructions || []).length;
      $("#cook-progress-text").textContent =
        `${ingDone}/${ingTotal} ingredients gathered · ${stepDone}/${stepTotal} steps done` +
        (ingTotal && stepDone === stepTotal && stepTotal ? " — enjoy! 🎉" : "");
    };
    updateProgressText();

    $(".cook-mode").addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-kind]');
      if (!cb) return;
      const p = recipe.cookProgress || (recipe.cookProgress = { ing: [], steps: [] });
      p[cb.dataset.kind][cb.dataset.idx] = cb.checked;
      Storage.updateRecipe(recipe.id, { cookProgress: p });
      cb.closest("li").classList.toggle("done", cb.checked);
      updateProgressText();
    });

    $("#cook-reset").addEventListener("click", () => {
      Storage.updateRecipe(recipe.id, { cookProgress: { ing: [], steps: [] } });
      openCookMode(recipe);
    });
    $("#cook-close").addEventListener("click", closeModal);
  }

  function recipeFormHtml(recipe = {}) {
    return `
      <h2>${recipe.id ? "Edit Recipe" : "New Recipe"}</h2>
      <form id="recipe-form" class="form-grid">
        <div class="form-field full">
          <label>Title *</label>
          <input name="name" required value="${esc(recipe.name)}">
        </div>
        <div class="form-field">
          <label>Prep time (min)</label>
          <input name="prepTime" type="number" min="0" value="${recipe.prepTime ?? ""}">
        </div>
        <div class="form-field">
          <label>Cook time (min)</label>
          <input name="cookTime" type="number" min="0" value="${recipe.cookTime ?? ""}">
        </div>
        <div class="form-field">
          <label>Servings</label>
          <input name="servings" value="${esc(recipe.servings)}">
        </div>
        ${imageFieldHtml(recipe.image)}
        <div class="form-field full">
          <label>Ingredients (one per line)</label>
          <textarea name="ingredients" rows="6">${esc((recipe.ingredients || []).join("\n"))}</textarea>
        </div>
        <div class="form-field full">
          <label>Instructions (one step per line)</label>
          <textarea name="instructions" rows="6">${esc((recipe.instructions || []).join("\n"))}</textarea>
        </div>
        <div class="form-field full">
          <label>Source URL</label>
          <input name="sourceUrl" type="url" value="${esc(recipe.sourceUrl)}">
        </div>
        <div class="form-actions full">
          <button type="button" class="btn btn-ghost" id="recipe-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${recipe.id ? "Save" : "Add Recipe"}</button>
        </div>
      </form>`;
  }

  function openRecipeForm(recipe, importedDraft, onSaved) {
    const source = recipe || importedDraft || {};
    openModal(recipeFormHtml(source));
    $("#recipe-cancel").addEventListener("click", closeModal);
    wireImageField($("#recipe-form"));
    $("#recipe-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const prep = parseInt(fd.get("prepTime")) || null;
      const cook = parseInt(fd.get("cookTime")) || null;
      const values = {
        name: fd.get("name").trim(),
        prepTime: prep,
        cookTime: cook,
        totalTime: (prep || cook) ? (prep || 0) + (cook || 0) : (source.totalTime || null),
        servings: fd.get("servings").trim(),
        image: formImage(fd),
        ingredients: fd.get("ingredients").split("\n").map(s => s.trim()).filter(Boolean),
        instructions: fd.get("instructions").split("\n").map(s => s.trim()).filter(Boolean),
        sourceUrl: fd.get("sourceUrl").trim(),
      };
      if (recipe && recipe.id) {
        Storage.updateRecipe(recipe.id, values);
        toast("Recipe updated");
      } else {
        values.nutrition = source.nutrition || "";
        values.rawSchema = source.rawSchema || null;
        values.importMethod = source.importMethod || "manual";
        const created = Storage.addRecipe(values);
        toast("Recipe saved");
        if (onSaved) onSaved(created);
      }
      closeModal();
      renderRecipes();
    });
  }

  function setImportStatus(msg, isError) {
    const el = $("#import-status");
    if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
  }

  $("#import-url-btn").addEventListener("click", async () => {
    const url = $("#import-url").value.trim();
    if (!url) { setImportStatus("Paste a recipe URL first.", true); return; }
    setImportStatus("Fetching page… (protected sites can take ~20–30 seconds)");
    try {
      const draft = await Importer.importFromUrl(url);
      const statusByMethod = {
        "json-ld": "Recipe schema found — review and save.",
        "json-ld-rendered": "Recipe schema found (page rendered via reader service) — review and save.",
        "reader": "Site blocks direct fetching — recipe extracted via reader service. Double-check the fields, then save.",
        "opengraph": "No structured recipe data; got basic info from page metadata. Fill in the rest.",
      };
      setImportStatus(statusByMethod[draft.importMethod] || "Imported — review and save.");
      openRecipeForm(null, draft);
      $("#import-url").value = "";
    } catch (err) {
      setImportStatus(
        "Import failed (" + err.message + "). The site may block fetching — try \"Paste HTML\": open the page, view source (Ctrl+U), copy all, and paste it.",
        true
      );
    }
  });

  $("#paste-html-btn").addEventListener("click", () => {
    openModal(`
      <h2>Paste Page HTML</h2>
      <p class="card-meta">Open the recipe page in your browser, press <strong>Ctrl+U</strong> (view source), select all, copy, and paste below.</p>
      <form id="paste-html-form">
        <div class="form-field">
          <label>Source URL (optional)</label>
          <input name="url" type="url" placeholder="https://…">
        </div>
        <div class="form-field" style="margin-top:0.5rem">
          <label>Page HTML *</label>
          <textarea name="html" rows="10" required></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="paste-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Extract Recipe</button>
        </div>
      </form>`);
    $("#paste-cancel").addEventListener("click", closeModal);
    $("#paste-html-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const draft = Importer.parseHtml(fd.get("html"), fd.get("url").trim());
      if (!draft) {
        setImportStatus("No recipe data found in that HTML. Use manual entry instead.", true);
        closeModal();
        return;
      }
      setImportStatus(draft.importMethod === "json-ld"
        ? "Recipe schema found — review and save."
        : "Only basic metadata found. Fill in the rest.");
      openRecipeForm(null, draft);
    });
  });

  $("#add-recipe-btn").addEventListener("click", () => openRecipeForm(null, null));
  $("#recipe-search").addEventListener("input", renderRecipes);

  function recipeToText(r) {
    const lines = [r.name, ""];
    if (r.totalTime) lines.push("Total time: " + minutesLabel(r.totalTime));
    if (r.servings) lines.push("Servings: " + r.servings);
    lines.push("", "INGREDIENTS:");
    (r.ingredients || []).forEach(i => lines.push("- " + i));
    lines.push("", "INSTRUCTIONS:");
    (r.instructions || []).forEach((s, idx) => lines.push((idx + 1) + ". " + s));
    if (r.sourceUrl) lines.push("", "Source: " + r.sourceUrl);
    return lines.join("\n");
  }

  $("#recipe-grid").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const recipe = Storage.recipes.find(r => r.id === btn.closest(".card").dataset.id);
    if (!recipe) return;

    switch (btn.dataset.action) {
      case "cook":
        openCookMode(recipe);
        break;
      case "view":
        openRecipeDetail(recipe);
        break;
      case "edit":
        openRecipeForm(recipe, null);
        break;
      case "copy":
        try {
          await navigator.clipboard.writeText(recipeToText(recipe));
          toast("Recipe copied to clipboard");
        } catch (err) {
          toast("Copy failed — clipboard blocked");
        }
        break;
      case "to-catalog": {
        const existing = Storage.snacks.find(s => s.recipeId === recipe.id);
        if (existing) { toast(`Already in catalog as "${existing.name}"`); break; }
        Storage.addSnack({
          name: recipe.name,
          category: "other",
          tags: ["homemade"],
          rating: 3,
          image: recipe.image || "",
          notes: "",
          purchaseUrl: "",
          recipeId: recipe.id,
          homemade: true,
          favorite: false,
        });
        toast("Added to snack catalog");
        renderSnacks();
        renderFilterOptions();
        break;
      }
      case "delete":
        if (confirm(`Delete recipe "${recipe.name}"?`)) {
          Storage.deleteRecipe(recipe.id);
          renderRecipes();
          renderSnacks();
        }
        break;
    }
  });

  /* ================= Ideas (recipe suggestions) ================= */

  let ideaItems = []; // the batch currently on screen; cards reference it by index
  let ideasLoading = false;
  let ideasPref = (Suggest.get() || {}).pref || "all"; // remember the last-used type across visits

  function ideaPrefLabel(id) {
    return (Suggest.PREFS.find(p => p.id === id) || Suggest.PREFS[0]).label;
  }

  function renderIdeaPrefs() {
    $("#ideas-prefs").innerHTML = Suggest.PREFS.map(p =>
      `<button class="pref-chip ${p.id === ideasPref ? "active" : ""}" data-pref="${p.id}">${p.label}</button>`
    ).join("");
  }

  $("#ideas-prefs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pref]");
    if (!btn || ideasLoading || btn.dataset.pref === ideasPref) return;
    ideasPref = btn.dataset.pref;
    renderIdeaPrefs();
    loadIdeas("pref");
  });

  function setIdeasStatus(msg, isError) {
    const el = $("#ideas-status");
    if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
  }

  function ideasAgeLabel(fetchedAt) {
    const days = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 86400000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
  }

  function renderIdeas(freshBatch) {
    // While a refresh is in flight, keep showing the partial batch instead of the stale cache
    const batch = freshBatch || (ideasLoading ? { items: ideaItems } : Suggest.get());
    ideaItems = (batch && batch.items) || [];
    $("#ideas-updated").textContent = batch && batch.fetchedAt
      ? `${ideaPrefLabel(batch.pref || "all")} · batch from ${ideasAgeLabel(batch.fetchedAt)} · auto-refreshes weekly` : "";
    $("#ideas-grid").innerHTML = ideaItems.map((it, i) => {
      const already = Storage.recipes.some(r => r.sourceUrl === it.url);
      return `
        <div class="card">
          ${it.image ? `<img class="card-img" src="${esc(it.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
          <div class="card-body">
            <h3 class="card-title">${esc(it.title)}</h3>
            <div class="card-meta">${esc(it.source)}</div>
            <a class="source-link" href="${esc(it.url)}" target="_blank" rel="noopener">View on site ↗</a>
          </div>
          <div class="card-actions">
            ${already
              ? `<button class="btn btn-ghost btn-small" disabled>✓ In your recipes</button>`
              : `<button class="btn btn-primary btn-small" data-add-idea="${i}">+ Add</button>`}
          </div>
        </div>`;
    }).join("");
    $("#ideas-empty").classList.toggle("hidden", ideasLoading || ideaItems.length > 0);
  }

  async function loadIdeas(reason) { // "weekly" | "manual" | "pref"
    if (ideasLoading) return;
    const firstTime = !Suggest.get();
    const label = ideaPrefLabel(ideasPref);
    const slowNote = " (some sites take ~30 seconds; results appear as they land)";
    ideasLoading = true;
    $("#ideas-refresh-btn").disabled = true;
    setIdeasStatus(
      reason === "manual"
        ? (ideasPref === "all" ? "Finding a fresh batch of ideas…" : `Finding a fresh batch for ${label}…`) + slowNote
        : reason === "pref"
          ? `Finding ideas for ${label}…` + slowNote
          : firstTime
            ? "Loading recipe suggestions…" + slowNote
            : "It's been a week — refreshing your suggestions…");
    renderIdeas();
    try {
      await Suggest.refresh({ manual: reason === "manual", pref: ideasPref }, (partial) => renderIdeas(partial));
      setIdeasStatus("");
    } catch (err) {
      setIdeasStatus("Couldn't fetch suggestions: " + err.message, true);
    }
    ideasLoading = false;
    $("#ideas-refresh-btn").disabled = false;
    renderIdeas();
  }

  $("#ideas-refresh-btn").addEventListener("click", () => loadIdeas("manual"));
  renderIdeaPrefs();

  $("#ideas-grid").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-add-idea]");
    if (!btn) return;
    const item = ideaItems[+btn.dataset.addIdea];
    if (!item) return;
    btn.disabled = true;
    btn.textContent = "Adding…";
    setIdeasStatus(`Importing “${item.title}”… (protected sites can take ~20–30 seconds)`);
    try {
      const draft = await Importer.importFromUrl(item.url);
      const values = {
        name: draft.name || item.title,
        prepTime: draft.prepTime || null,
        cookTime: draft.cookTime || null,
        totalTime: draft.totalTime || null,
        servings: draft.servings || "",
        image: draft.image || item.image || "",
        ingredients: draft.ingredients || [],
        instructions: draft.instructions || [],
        sourceUrl: item.url,
        nutrition: draft.nutrition || "",
        rawSchema: draft.rawSchema || null,
        importMethod: draft.importMethod || "suggestion",
      };
      if (!values.ingredients.length) {
        // Only page metadata came through — let the user fill in the rest
        setIdeasStatus("Got the basics but not the full recipe — review, fill in, and save.");
        openRecipeForm(null, values, () => renderIdeas());
      } else {
        Storage.addRecipe(values);
        setIdeasStatus("");
        toast(`“${values.name}” added to your recipes 🎉`);
        renderRecipes();
        renderGroceryPicker();
        renderIdeas();
      }
    } catch (err) {
      setIdeasStatus("Auto-import didn't work (" + err.message + ") — you can save it by hand.", true);
      openRecipeForm(null, { name: item.title, image: item.image || "", sourceUrl: item.url }, () => renderIdeas());
      if (btn.isConnected) { btn.disabled = false; btn.textContent = "+ Add"; }
    }
  });

  /* ================= Weekly plan ================= */

  function renderPlan() {
    const snackPlan = Storage.lastPlan;
    const dinnerPlan = Storage.lastDinnerPlan;
    const hasAny = !!((snackPlan && snackPlan.days.length) || (dinnerPlan && dinnerPlan.days.length));
    $("#plan-empty").classList.toggle("hidden", hasAny);
    $$(".plan-section-head").forEach(h => h.classList.remove("hidden"));

    $("#plan-grid").innerHTML = ((snackPlan && snackPlan.days) || []).map((d, i) => {
      const snack = d.snackId ? Storage.snacks.find(s => s.id === d.snackId) : null;
      const dayButtons = `
        <span class="day-actions">
          <button class="day-btn" data-action="edit-day" title="Set this day's snack">✎</button>
          <button class="day-btn" data-action="clear-day" title="Clear this day">✕</button>
        </span>`;
      let body;
      if (d.customText) {
        body = `<span class="plan-snack">${esc(d.customText)}</span><span class="card-meta">custom</span>`;
      } else if (snack) {
        body = `
          ${snack.image ? `<img src="${esc(snack.image)}" alt="" onerror="this.remove()">` : ""}
          <span class="plan-snack">${esc(snack.name)}</span>
          <span class="card-meta">${esc(snack.category)}${Planner.isHomemade(snack) ? " · homemade" : ""}</span>`;
      } else {
        body = `<span class="card-meta plan-empty-day">— empty —</span>`;
      }
      return `
        <div class="plan-day" data-day-idx="${i}">
          <h3>${d.day}${dayButtons}</h3>
          ${body}
        </div>`;
    }).join("");

    $("#dinner-grid").innerHTML = ((dinnerPlan && dinnerPlan.days) || []).map((d, i) => {
      const recipe = d.recipeId ? Storage.recipes.find(r => r.id === d.recipeId) : null;
      const dayButtons = `
        <span class="day-actions">
          <button class="day-btn" data-action="edit-day" title="Set this day's dinner">✎</button>
          <button class="day-btn" data-action="clear-day" title="Clear this day">✕</button>
        </span>`;
      let body;
      if (d.customText) {
        body = `<span class="plan-snack">${esc(d.customText)}</span><span class="card-meta">custom</span>`;
      } else if (recipe) {
        body = `
          ${recipe.image ? `<img src="${esc(recipe.image)}" alt="" onerror="this.remove()">` : ""}
          <span class="plan-snack">${esc(recipe.name)}</span>
          <span class="card-meta">${recipe.totalTime ? "⏱ " + minutesLabel(recipe.totalTime) : (recipe.ingredients || []).length + " ingredients"}</span>`;
      } else {
        body = `<span class="card-meta plan-empty-day">— empty —</span>`;
      }
      return `
        <div class="plan-day ${recipe ? "plan-day-clickable" : ""}" data-day-idx="${i}"
             ${recipe ? `data-recipe="${recipe.id}" title="Open recipe"` : ""}>
          <h3>${d.day}${dayButtons}</h3>
          ${body}
        </div>`;
    }).join("");

    renderSavedWeeks();
  }

  function renderSavedWeeks() {
    $("#saved-weeks-row").innerHTML = Storage.savedDinnerPlans.map(p => `
      <span class="collection-chip">
        <button class="chip-load" data-load-week="${p.id}" title="Load this week">↺ ${esc(p.name)}</button>
        <button data-del-week="${p.id}" title="Delete saved week">✕</button>
      </span>`).join("");
  }

  /* Blank 7-day scaffolds for building a week by hand */
  function blankDinnerPlan() {
    return { seed: 0, days: Planner.DAYS.map(day => ({ day, recipeId: null, customText: null })), notes: [] };
  }
  function blankSnackPlan() {
    return { seed: 0, days: Planner.DAYS.map(day => ({ day, snackId: null, customText: null })), notes: [] };
  }

  function openEditSnackDay(plan, i) {
    const d = plan.days[i];
    openModal(`
      <h2>${d.day} snack</h2>
      <div class="form-field">
        <label>Pick a snack</label>
        <select id="day-snack">
          <option value="">— none —</option>
          ${Storage.snacks.map(s => `<option value="${s.id}" ${d.snackId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select>
      </div>
      <div class="form-field" style="margin-top: 0.6rem">
        <label>…or type a custom snack (overrides the pick)</label>
        <input id="day-snack-custom" value="${esc(d.customText || "")}" placeholder="e.g. Whatever's in the pantry">
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="day-snack-cancel">Cancel</button>
        <button class="btn btn-primary" id="day-snack-save">Save</button>
      </div>`);
    $("#day-snack-cancel").addEventListener("click", closeModal);
    $("#day-snack-save").addEventListener("click", () => {
      const custom = $("#day-snack-custom").value.trim();
      const sid = $("#day-snack").value;
      plan.days[i] = { day: d.day, snackId: custom ? null : (sid || null), customText: custom || null };
      Storage.updatePlan(plan);
      closeModal();
      renderPlan();
    });
  }

  $("#plan-grid").addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    const dayCard = e.target.closest("[data-day-idx]");
    const plan = Storage.lastPlan;
    if (!actionBtn || !dayCard || !plan) return;
    const i = +dayCard.dataset.dayIdx;
    if (actionBtn.dataset.action === "clear-day") {
      plan.days[i] = { day: plan.days[i].day, snackId: null, customText: null };
      Storage.updatePlan(plan);
      renderPlan();
    } else if (actionBtn.dataset.action === "edit-day") {
      openEditSnackDay(plan, i);
    }
  });

  $("#clear-snackdays-btn").addEventListener("click", () => {
    const plan = Storage.lastPlan;
    if (plan && plan.days.some(d => d.snackId || d.customText)) {
      if (!confirm("Empty all 7 snack days?")) return;
    }
    Storage.updatePlan(blankSnackPlan());
    renderPlan();
  });

  function openEditDinnerDay(plan, i) {
    const d = plan.days[i];
    openModal(`
      <h2>${d.day} dinner</h2>
      <div class="form-field">
        <label>Pick a recipe</label>
        <select id="day-recipe">
          <option value="">— none —</option>
          ${Storage.recipes.map(r => `<option value="${r.id}" ${d.recipeId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
        </select>
      </div>
      <div class="form-field" style="margin-top: 0.6rem">
        <label>…or type a custom dinner (overrides the recipe pick)</label>
        <input id="day-custom" value="${esc(d.customText || "")}" placeholder="e.g. Leftovers, Pizza night, Eating out">
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="day-cancel">Cancel</button>
        <button class="btn btn-primary" id="day-save">Save</button>
      </div>`);
    $("#day-cancel").addEventListener("click", closeModal);
    $("#day-save").addEventListener("click", () => {
      const custom = $("#day-custom").value.trim();
      const rid = $("#day-recipe").value;
      plan.days[i] = { day: d.day, recipeId: custom ? null : (rid || null), customText: custom || null };
      Storage.updateDinnerPlan(plan);
      closeModal();
      renderPlan();
    });
  }

  $("#dinner-grid").addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    const dayCard = e.target.closest("[data-day-idx]");
    const plan = Storage.lastDinnerPlan;
    if (actionBtn && dayCard && plan) {
      const i = +dayCard.dataset.dayIdx;
      if (actionBtn.dataset.action === "clear-day") {
        plan.days[i] = { day: plan.days[i].day, recipeId: null, customText: null };
        Storage.updateDinnerPlan(plan);
        renderPlan();
      } else if (actionBtn.dataset.action === "edit-day") {
        openEditDinnerDay(plan, i);
      }
      return;
    }
    const card = e.target.closest("[data-recipe]");
    if (!card) return;
    const recipe = Storage.recipes.find(r => r.id === card.dataset.recipe);
    if (recipe) openRecipeDetail(recipe);
  });

  $("#clear-dinners-btn").addEventListener("click", () => {
    const plan = Storage.lastDinnerPlan;
    if (plan && plan.days.some(d => d.recipeId || d.customText)) {
      if (!confirm("Empty all 7 dinner days?")) return;
    }
    Storage.updateDinnerPlan(blankDinnerPlan());
    renderPlan();
  });

  $("#save-week-btn").addEventListener("click", () => {
    const plan = Storage.lastDinnerPlan;
    if (!plan || !plan.days.some(d => d.recipeId || d.customText)) { toast("Nothing to save — the week is empty"); return; }
    const name = prompt("Name this week:", "Week of " + new Date().toLocaleDateString());
    if (!name || !name.trim()) return;
    Storage.saveDinnerPlanAs(name.trim());
    renderSavedWeeks();
    toast("Week saved");
  });

  $("#saved-weeks-row").addEventListener("click", (e) => {
    const load = e.target.closest("[data-load-week]");
    const del = e.target.closest("[data-del-week]");
    if (load) {
      const current = Storage.lastDinnerPlan;
      if (current && current.days.some(d => d.recipeId || d.customText) &&
          !confirm("Replace the current week's dinners with this saved week?")) return;
      Storage.loadSavedDinnerPlan(load.dataset.loadWeek);
      renderPlan();
      toast("Saved week loaded");
    } else if (del) {
      const p = Storage.savedDinnerPlans.find(p => p.id === del.dataset.delWeek);
      if (p && confirm(`Delete saved week "${p.name}"?`)) {
        Storage.deleteSavedDinnerPlan(p.id);
        renderSavedWeeks();
      }
    }
  });

  function generateSnackPlan() {
    if (Storage.snacks.length === 0) return ["Add some snacks to the catalog to plan snacks."];
    const plan = Planner.generate(Storage.snacks, {
      seed: Math.floor(Math.random() * 2 ** 31),
      maxPerCategory: parseInt($("#plan-max-category").value),
      minHomemade: parseInt($("#plan-min-homemade").value),
      excludeIds: $("#plan-no-repeats").checked ? Storage.prevPlanSnackIds : [],
    });
    Storage.setPlan(plan);
    return plan.notes;
  }

  function generateDinnerPlan() {
    if (Storage.recipes.length === 0) return ["Import or add recipes to plan dinners."];
    const plan = Planner.generateDinners(Storage.recipes, Storage.snacks, {
      seed: Math.floor(Math.random() * 2 ** 31),
      excludeIds: $("#plan-no-repeats").checked ? Storage.prevDinnerRecipeIds : [],
    });
    Storage.setDinnerPlan(plan);
    return plan.notes;
  }

  function showPlanNotes(notes) {
    const note = $("#plan-note");
    note.textContent = notes.join(" ");
    note.classList.toggle("hidden", notes.length === 0);
  }

  $("#generate-plan-btn").addEventListener("click", () => {
    const notes = [...generateSnackPlan(), ...generateDinnerPlan()];
    renderPlan();
    showPlanNotes(notes);
  });
  $("#reroll-snacks-btn").addEventListener("click", () => {
    showPlanNotes(generateSnackPlan());
    renderPlan();
  });
  $("#reroll-dinners-btn").addEventListener("click", () => {
    showPlanNotes(generateDinnerPlan());
    renderPlan();
  });

  /* ================= Grocery list ================= */

  const grocerySelected = new Set(); // recipe ids picked for the next list (not persisted)

  function renderGroceryPicker() {
    grocerySelected.forEach(id => { if (!Storage.recipes.some(r => r.id === id)) grocerySelected.delete(id); });
    $("#grocery-recipe-picker").innerHTML = Storage.recipes.map(r => `
      <label class="grocery-pick">
        <input type="checkbox" value="${r.id}" ${grocerySelected.has(r.id) ? "checked" : ""}>
        ${esc(r.name)}
      </label>`).join("") ||
      `<p class="card-meta">No recipes yet — import some on the Recipes tab first.</p>`;
  }

  $("#grocery-recipe-picker").addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) grocerySelected.add(cb.value);
    else grocerySelected.delete(cb.value);
  });

  function renderGroceryList() {
    const list = Storage.groceryList;
    const hasList = !!(list && list.items && list.items.length);
    $("#grocery-empty").classList.toggle("hidden", hasList);
    if (!hasList) {
      $("#grocery-list").innerHTML = "";
      $("#grocery-progress").textContent = "";
      return;
    }
    $("#grocery-list").innerHTML = list.items.map((item, i) => {
      const amounts = item.est || Grocery.formatAmounts(item.amounts);
      const fromLabel = item.from && item.from.length
        ? (item.from.length === 1 ? item.from[0] : item.from.length + " recipes") : "";
      const details = (item.details && item.details.length)
        ? `<div class="grocery-detail">as written: ${esc(item.details.join(" · "))}</div>` : "";
      return `
        <li class="${item.checked ? "done" : ""}">
          <label>
            <input type="checkbox" data-idx="${i}" ${item.checked ? "checked" : ""}>
            <span>${esc(item.name.charAt(0).toUpperCase() + item.name.slice(1))}
              ${amounts ? `<strong class="grocery-amt">— ${esc(amounts)}</strong>` : ""}
              ${fromLabel && !details ? `<span class="card-meta grocery-from" title="${esc((item.from || []).join(", "))}">(${esc(fromLabel)})</span>` : ""}
              ${details}
            </span>
          </label>
        </li>`;
    }).join("");
    const done = list.items.filter(i => i.checked).length;
    $("#grocery-progress").textContent = `${done} of ${list.items.length} in the cart` +
      (list.recipeNames && list.recipeNames.length ? ` · for ${list.recipeNames.length} recipe(s)` : "");
  }

  $("#grocery-list").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-idx]");
    if (!cb) return;
    const list = Storage.groceryList;
    if (!list) return;
    list.items[cb.dataset.idx].checked = cb.checked;
    Storage.setGroceryList(list);
    renderGroceryList();
  });

  $("#grocery-generate-btn").addEventListener("click", () => {
    const recipes = Storage.recipes.filter(r => grocerySelected.has(r.id));
    if (!recipes.length) { toast("Tick at least one recipe first"); return; }
    Storage.setGroceryList(Grocery.build(recipes));
    renderGroceryList();
    toast(`List built from ${recipes.length} recipe(s)`);
  });

  $("#grocery-from-plan-btn").addEventListener("click", () => {
    const plan = Storage.lastDinnerPlan;
    if (!plan || !plan.days.length) { toast("Generate a dinner plan first (Weekly Plan tab)"); return; }
    grocerySelected.clear();
    plan.days.forEach(d => {
      if (Storage.recipes.some(r => r.id === d.recipeId)) grocerySelected.add(d.recipeId);
    });
    renderGroceryPicker();
    toast(`Selected ${grocerySelected.size} recipe(s) from the dinner plan`);
  });

  $("#grocery-clear-sel-btn").addEventListener("click", () => {
    grocerySelected.clear();
    renderGroceryPicker();
  });

  $("#grocery-add-btn").addEventListener("click", () => {
    const input = $("#grocery-add-input");
    const name = input.value.trim();
    if (!name) return;
    const list = Storage.groceryList || { items: [], recipeNames: [], createdAt: new Date().toISOString() };
    list.items.push({ name, amounts: {}, from: [], checked: false });
    Storage.setGroceryList(list);
    input.value = "";
    renderGroceryList();
  });
  $("#grocery-add-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#grocery-add-btn").click();
  });

  $("#grocery-copy-btn").addEventListener("click", async () => {
    const list = Storage.groceryList;
    if (!list || !list.items.length) { toast("Nothing to copy yet"); return; }
    const text = ["Grocery list" + (list.recipeNames.length ? " — " + list.recipeNames.join(", ") : "") + ":"]
      .concat(list.items.map(i => {
        const amt = i.est || Grocery.formatAmounts(i.amounts);
        return (i.checked ? "[x] " : "[ ] ") + i.name + (amt ? " — " + amt : "") +
          (i.details && i.details.length ? "  (as written: " + i.details.join("; ") + ")" : "");
      })).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Grocery list copied");
    } catch (err) {
      toast("Copy failed — clipboard blocked");
    }
  });

  $("#grocery-clear-btn").addEventListener("click", () => {
    if (!Storage.groceryList) return;
    if (confirm("Clear the grocery list?")) {
      Storage.setGroceryList(null);
      renderGroceryList();
    }
  });

  /* ---- Saved grocery lists ---- */

  function renderSavedGroceryLists() {
    $("#saved-grocery-row").innerHTML = Storage.savedGroceryLists.map(l => `
      <span class="collection-chip">
        <button class="chip-load" data-load-list="${l.id}" title="Load this list">↺ ${esc(l.name)}</button>
        <button data-del-list="${l.id}" title="Delete saved list">✕</button>
      </span>`).join("");
  }

  $("#grocery-save-btn").addEventListener("click", () => {
    const list = Storage.groceryList;
    if (!list || !list.items.length) { toast("Nothing to save yet"); return; }
    const suggestion = list.recipeNames && list.recipeNames.length
      ? list.recipeNames.slice(0, 2).join(", ") : new Date().toLocaleDateString();
    const name = prompt("Name this grocery list:", suggestion);
    if (!name || !name.trim()) return;
    Storage.saveGroceryListAs(name.trim());
    renderSavedGroceryLists();
    toast("List saved for later");
  });

  $("#saved-grocery-row").addEventListener("click", (e) => {
    const load = e.target.closest("[data-load-list]");
    const del = e.target.closest("[data-del-list]");
    if (load) {
      if (Storage.groceryList && Storage.groceryList.items.length &&
          !confirm("Replace the current grocery list with this saved one?")) return;
      Storage.loadSavedGroceryList(load.dataset.loadList);
      renderGroceryList();
      toast("Saved list loaded");
    } else if (del) {
      const l = Storage.savedGroceryLists.find(l => l.id === del.dataset.delList);
      if (l && confirm(`Delete saved list "${l.name}"?`)) {
        Storage.deleteSavedGroceryList(l.id);
        renderSavedGroceryLists();
      }
    }
  });

  /* ================= Lunches ================= */

  function lunchComponents(lunch) {
    return [
      ...(lunch.snackIds || []).map(id => (Storage.snacks.find(s => s.id === id) || {}).name).filter(Boolean),
      ...(lunch.recipeIds || []).map(id => (Storage.recipes.find(r => r.id === id) || {}).name).filter(Boolean),
      ...(lunch.extras || []),
    ];
  }

  function renderLunches() {
    $("#lunch-grid").innerHTML = Storage.lunches.map(l => {
      const parts = lunchComponents(l);
      return `
        <div class="card" data-id="${l.id}">
          <div class="card-body">
            <h3 class="card-title">🥪 ${esc(l.name)}</h3>
            <div class="card-meta">${parts.length} item(s)</div>
            ${parts.length ? `<p class="card-notes">${esc(parts.join(" · "))}</p>` : ""}
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost btn-small" data-action="today">→ Today's lunch</button>
            <button class="btn btn-ghost btn-small" data-action="edit">Edit</button>
            <button class="btn btn-danger btn-small" data-action="delete">Delete</button>
          </div>
        </div>`;
    }).join("");
    $("#lunch-empty").classList.toggle("hidden", Storage.lunches.length > 0);
  }

  function openLunchForm(lunch) {
    const src = lunch || {};
    const pickChips = (items, name, selected) => items.map(it => `
      <label class="grocery-pick">
        <input type="checkbox" name="${name}" value="${it.id}" ${(selected || []).includes(it.id) ? "checked" : ""}>
        ${esc(it.name)}
      </label>`).join("") || `<span class="card-meta">none available</span>`;
    openModal(`
      <h2>${src.id ? "Edit Lunch" : "Build a Lunch"}</h2>
      <form id="lunch-form">
        <div class="form-field">
          <label>Name *</label>
          <input name="name" required value="${esc(src.name)}" placeholder="e.g. Office Lunch, Light Friday">
        </div>
        <div class="form-field" style="margin-top: 0.7rem">
          <label>Snacks in this lunch</label>
          <div class="grocery-picker">${pickChips(Storage.snacks, "snack", src.snackIds)}</div>
        </div>
        <div class="form-field" style="margin-top: 0.7rem">
          <label>Recipes in this lunch</label>
          <div class="grocery-picker">${pickChips(Storage.recipes, "recipe", src.recipeIds)}</div>
        </div>
        <div class="form-field" style="margin-top: 0.7rem">
          <label>Extras (one per line — anything not in the app)</label>
          <textarea name="extras" rows="3" placeholder="PB&J sandwich&#10;Apple">${esc((src.extras || []).join("\n"))}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="lunch-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${src.id ? "Save" : "Add Lunch"}</button>
        </div>
      </form>`);
    $("#lunch-cancel").addEventListener("click", closeModal);
    $("#lunch-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const values = {
        name: fd.get("name").trim(),
        snackIds: fd.getAll("snack"),
        recipeIds: fd.getAll("recipe"),
        extras: fd.get("extras").split("\n").map(s => s.trim()).filter(Boolean),
      };
      if (src.id) { Storage.updateLunch(src.id, values); toast("Lunch updated"); }
      else { Storage.addLunch(values); toast("Lunch added"); }
      closeModal();
      renderLunches();
    });
  }

  $("#add-lunch-btn").addEventListener("click", () => openLunchForm(null));

  $("#lunch-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const lunch = Storage.lunches.find(l => l.id === btn.closest(".card").dataset.id);
    if (!lunch) return;
    switch (btn.dataset.action) {
      case "edit":
        openLunchForm(lunch);
        break;
      case "delete":
        if (confirm(`Delete lunch "${lunch.name}"?`)) {
          Storage.deleteLunch(lunch.id);
          renderLunches();
          renderDaily();
        }
        break;
      case "today": {
        const date = todayStr();
        const plan = Storage.getDailyPlan(date) || { morning: [], lunch: [], afternoon: [] };
        plan.lunch.push({ type: "lunch", id: lunch.id });
        Storage.setDailyPlan(date, plan);
        $("#daily-date").value = date;
        renderDaily();
        toast(`Added to today's lunch (${lunch.name})`);
        break;
      }
    }
  });

  /* ================= Daily plan ================= */

  const DAILY_SLOTS = [["morning", "🌅 Morning"], ["lunch", "🥪 Lunch"], ["afternoon", "☀️ Afternoon"]];

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function dailyItemLabel(it) {
    if (it.type === "custom") return it.text || "?";
    if (it.type === "snack") return (Storage.snacks.find(s => s.id === it.id) || {}).name || "(removed)";
    if (it.type === "lunch") return "🥪 " + ((Storage.lunches.find(l => l.id === it.id) || {}).name || "(removed)");
    if (it.type === "recipe") return "📖 " + ((Storage.recipes.find(r => r.id === it.id) || {}).name || "(removed)");
    return "?";
  }

  function renderDaily() {
    const date = $("#daily-date").value || todayStr();
    const plan = Storage.getDailyPlan(date) || { morning: [], lunch: [], afternoon: [] };
    $("#daily-slots").innerHTML = DAILY_SLOTS.map(([key, label]) => `
      <div class="daily-slot" data-slot="${key}">
        <h3>${label}</h3>
        <div class="collection-items">
          ${(plan[key] || []).map((it, i) =>
            `<span class="collection-chip">${esc(dailyItemLabel(it))} <button data-rm-item="${i}" title="Remove">✕</button></span>`
          ).join("") || `<span class="card-meta">nothing planned</span>`}
        </div>
        <button class="btn btn-ghost btn-small" data-add-item style="margin-top: 0.5rem">+ Add</button>
      </div>`).join("");
  }

  function openAddDailyItem(slotKey) {
    const date = $("#daily-date").value || todayStr();
    openModal(`
      <h2>Add to ${slotKey}</h2>
      <div class="form-field">
        <label>What kind of item?</label>
        <select id="di-type">
          <option value="snack" ${slotKey !== "lunch" ? "selected" : ""}>Snack</option>
          <option value="lunch" ${slotKey === "lunch" ? "selected" : ""}>Lunch (built)</option>
          <option value="recipe">Recipe</option>
          <option value="custom">Custom (type anything)</option>
        </select>
      </div>
      <div class="form-field" id="di-pick-wrap" style="margin-top: 0.6rem"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="di-cancel">Cancel</button>
        <button class="btn btn-primary" id="di-add">Add</button>
      </div>`);
    const renderPicker = () => {
      const t = $("#di-type").value;
      if (t === "custom") {
        $("#di-pick-wrap").innerHTML = `<label>Custom item</label><input id="di-custom" placeholder="e.g. Apple slices & peanut butter">`;
        return;
      }
      const opts = t === "snack" ? Storage.snacks : t === "lunch" ? Storage.lunches : Storage.recipes;
      $("#di-pick-wrap").innerHTML = `<label>Pick one</label>
        <select id="di-pick">${opts.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("") || `<option value="">— none available —</option>`}</select>`;
    };
    renderPicker();
    $("#di-type").addEventListener("change", renderPicker);
    $("#di-cancel").addEventListener("click", closeModal);
    $("#di-add").addEventListener("click", () => {
      const t = $("#di-type").value;
      let entry;
      if (t === "custom") {
        const text = $("#di-custom").value.trim();
        if (!text) return;
        entry = { type: "custom", text };
      } else {
        const id = $("#di-pick").value;
        if (!id) { toast("Nothing to pick from — add some first"); return; }
        entry = { type: t, id };
      }
      const plan = Storage.getDailyPlan(date) || { morning: [], lunch: [], afternoon: [] };
      plan[slotKey].push(entry);
      Storage.setDailyPlan(date, plan);
      closeModal();
      renderDaily();
    });
  }

  $("#daily-slots").addEventListener("click", (e) => {
    const slotEl = e.target.closest("[data-slot]");
    if (!slotEl) return;
    const slotKey = slotEl.dataset.slot;
    const rm = e.target.closest("[data-rm-item]");
    if (rm) {
      const date = $("#daily-date").value || todayStr();
      const plan = Storage.getDailyPlan(date);
      if (!plan) return;
      plan[slotKey].splice(+rm.dataset.rmItem, 1);
      Storage.setDailyPlan(date, plan);
      renderDaily();
      return;
    }
    if (e.target.closest("[data-add-item]")) openAddDailyItem(slotKey);
  });

  /* Weighted snack pick for suggestions: rating + freshness + randomness,
   * avoiding repeats and (when possible) avoiding an already-used category */
  function suggestSnack(excludeIds, excludeCategories) {
    let pool = Storage.snacks.filter(s => !excludeIds.includes(s.id));
    const varied = pool.filter(s => !excludeCategories.includes(s.category));
    if (varied.length) pool = varied;
    if (!pool.length) return null;
    return pool.map(s => {
      let freshness = 1;
      if (s.lastPlannedAt) freshness = Math.min((Date.now() - new Date(s.lastPlannedAt).getTime()) / 86400000 / 28, 1);
      return { s, score: 0.6 * ((s.rating || 3) / 5) + 0.3 * freshness + 0.4 * Math.random() };
    }).sort((a, b) => b.score - a.score)[0].s;
  }

  $("#daily-suggest-btn").addEventListener("click", () => {
    const date = $("#daily-date").value || todayStr();
    const existing = Storage.getDailyPlan(date);
    if (existing && (existing.morning.length || existing.lunch.length || existing.afternoon.length)) {
      if (!confirm("Replace this day's plan with a fresh suggestion?")) return;
    }
    const plan = { morning: [], lunch: [], afternoon: [] };
    const usedIds = [], usedCats = [];

    const m = suggestSnack(usedIds, usedCats);
    if (m) { plan.morning.push({ type: "snack", id: m.id }); usedIds.push(m.id); usedCats.push(m.category); }

    if (Storage.lunches.length) {
      const l = Storage.lunches[Math.floor(Math.random() * Storage.lunches.length)];
      plan.lunch.push({ type: "lunch", id: l.id });
    } else if (Storage.recipes.length) {
      const quick = Storage.recipes.filter(r => !r.totalTime || r.totalTime <= 45);
      const pool = quick.length ? quick : Storage.recipes;
      plan.lunch.push({ type: "recipe", id: pool[Math.floor(Math.random() * pool.length)].id });
    }

    const a = suggestSnack(usedIds, usedCats);
    if (a) plan.afternoon.push({ type: "snack", id: a.id });

    if (!plan.morning.length && !plan.lunch.length && !plan.afternoon.length) {
      toast("Add some snacks, lunches, or recipes first");
      return;
    }
    Storage.setDailyPlan(date, plan);
    renderDaily();
    toast("Day suggested — tweak anything you like");
  });

  $("#daily-clear-btn").addEventListener("click", () => {
    const date = $("#daily-date").value || todayStr();
    if (!Storage.getDailyPlan(date)) return;
    if (!confirm("Clear this day's plan?")) return;
    Storage.setDailyPlan(date, { morning: [], lunch: [], afternoon: [] });
    renderDaily();
  });

  $("#daily-today-btn").addEventListener("click", () => {
    $("#daily-date").value = todayStr();
    renderDaily();
  });
  $("#daily-date").addEventListener("change", renderDaily);

  /* ================= Collections ================= */

  function renderCollections() {
    const list = $("#collections-list");
    list.innerHTML = Storage.collections.map(c => `
      <div class="collection-block" data-id="${c.id}">
        <div class="collection-header">
          <h3>${esc(c.name)}</h3>
          <button class="btn btn-danger btn-small" data-action="delete-collection">Delete</button>
        </div>
        <div class="collection-items">
          ${c.snackIds.map(sid => {
            const s = Storage.snacks.find(s => s.id === sid);
            return s ? `<span class="collection-chip">${esc(s.name)} <button data-action="remove-item" data-snack="${sid}" title="Remove">✕</button></span>` : "";
          }).join("") || `<span class="card-meta">Empty — add snacks via "+ Collection" on a snack card.</span>`}
        </div>
      </div>`).join("");
    $("#collections-empty").classList.toggle("hidden", Storage.collections.length > 0);
  }

  $("#add-collection-btn").addEventListener("click", () => {
    const input = $("#new-collection-name");
    const name = input.value.trim();
    if (!name) return;
    Storage.addCollection(name);
    input.value = "";
    renderCollections();
  });

  $("#collections-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const collectionId = btn.closest(".collection-block").dataset.id;
    if (btn.dataset.action === "delete-collection") {
      const c = Storage.collections.find(c => c.id === collectionId);
      if (confirm(`Delete collection "${c.name}"? (Snacks are kept.)`)) {
        Storage.deleteCollection(collectionId);
        renderCollections();
      }
    } else if (btn.dataset.action === "remove-item") {
      Storage.removeFromCollection(collectionId, btn.dataset.snack);
      renderCollections();
    }
  });

  function openAddToCollection(snack) {
    if (Storage.collections.length === 0) {
      toast("Create a collection first (Collections tab)");
      return;
    }
    openModal(`
      <h2>Add "${esc(snack.name)}" to…</h2>
      <div class="collection-items" id="collection-pick">
        ${Storage.collections.map(c =>
          `<button class="btn btn-ghost" data-id="${c.id}">${esc(c.name)}${c.snackIds.includes(snack.id) ? " ✓" : ""}</button>`
        ).join("")}
      </div>`);
    $("#collection-pick").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-id]");
      if (!btn) return;
      Storage.addToCollection(btn.dataset.id, snack.id);
      toast("Added to collection");
      closeModal();
      renderCollections();
    });
  }

  /* ================= Export / import ================= */

  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([Storage.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "snakapp-export-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("Importing replaces ALL current data. Continue?")) { e.target.value = ""; return; }
    try {
      Storage.importJSON(await file.text());
      renderAll();
      toast("Data imported");
    } catch (err) {
      toast("Import failed: " + err.message);
    }
    e.target.value = "";
  });

  /* ================= Settings / live database ================= */

  const DB_STATUS_TEXT = {
    disconnected: "Not connected — using browser storage only",
    connected: "Connected — saving live",
    "needs-permission": "Reconnect required — click Reconnect to re-grant file access",
    unsupported: "Live file access not supported in this browser",
    error: "File write failed — check the file and reconnect",
  };

  /* Header dot reflects both connections: green if either is live */
  let fileInfoCache = { status: "disconnected" };
  let cloudInfoCache = { status: "disconnected" };
  function updateHeaderDot() {
    const connected = fileInfoCache.status === "connected" || cloudInfoCache.status === "connected";
    const trouble = fileInfoCache.status === "needs-permission" || fileInfoCache.status === "error" ||
      cloudInfoCache.status === "error";
    $("#header-db-dot").className = "status-dot" +
      (connected ? " connected" : trouble ? " needs-permission" : "");
  }

  function renderDbStatus(info) {
    fileInfoCache = info;
    const dotClass = "status-dot" +
      (info.status === "connected" ? " connected"
        : info.status === "needs-permission" ? " needs-permission"
        : info.status === "error" ? " error" : "");
    $("#db-dot").className = dotClass;
    updateHeaderDot();
    $("#db-status-text").textContent = DB_STATUS_TEXT[info.status] || info.status;
    $("#db-file-name").textContent = info.fileName ? "Database file: " + info.fileName : "";
    $("#db-last-saved").textContent = info.lastSavedAt
      ? "Last saved: " + info.lastSavedAt.toLocaleTimeString() : "";
    $("#db-reconnect-btn").classList.toggle("hidden", info.status !== "needs-permission");
    $("#db-disconnect-btn").classList.toggle("hidden", !info.fileName);
    $("#db-connect-btn").classList.toggle("hidden", !info.supported);
    $("#db-create-btn").classList.toggle("hidden", !info.supported);
    $("#db-unsupported-msg").classList.toggle("hidden", info.supported);
  }

  $("#db-connect-btn").addEventListener("click", async () => {
    try {
      await Storage.connectFile();
      renderAll();
      toast("Database connected — saving live");
    } catch (err) {
      if (err.name !== "AbortError") toast("Connect failed: " + err.message);
    }
  });

  $("#db-create-btn").addEventListener("click", async () => {
    try {
      await Storage.createFile();
      toast("Database file created — saving live");
    } catch (err) {
      if (err.name !== "AbortError") toast("Create failed: " + err.message);
    }
  });

  $("#db-reconnect-btn").addEventListener("click", async () => {
    try {
      const ok = await Storage.reconnect();
      if (ok) { renderAll(); toast("Database reconnected"); }
      else toast("Permission was not granted");
    } catch (err) {
      toast("Reconnect failed: " + err.message);
    }
  });

  $("#db-disconnect-btn").addEventListener("click", async () => {
    if (!confirm("Disconnect the database file? Data stays in browser storage and in the file; they just stop syncing.")) return;
    await Storage.disconnectFile();
    toast("Database disconnected");
  });

  $("#header-db-indicator").addEventListener("click", () => {
    document.querySelector('.tab-btn[data-tab="settings"]').click();
  });

  $("#cloud-sync-now-btn").addEventListener("click", async () => {
    try {
      await Storage.syncNow();
      renderAll();
      toast("Fully synced ✓ — safe to close");
    } catch (err) {
      toast("Sync failed: " + err.message);
    }
  });

  /* ---- Snack categories editor ---- */

  function renderCategoriesEditor() {
    $("#category-chips").innerHTML = Storage.categories.map(c => `
      <span class="collection-chip">${esc(c)}
        <button data-ren-cat="${esc(c)}" title="Rename category (updates all snacks)">✎</button>
        <button data-del-cat="${esc(c)}" title="Remove category from this list">✕</button>
      </span>`).join("") ||
      `<span class="card-meta">No categories yet — add some below.</span>`;
  }

  $("#category-add-btn").addEventListener("click", () => {
    const input = $("#category-add-input");
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    if (Storage.categories.includes(val)) { toast("That category already exists"); return; }
    Storage.setCategories([...Storage.categories, val]);
    input.value = "";
    renderCategoriesEditor();
    renderFilterOptions();
  });
  $("#category-add-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#category-add-btn").click();
  });

  $("#category-chips").addEventListener("click", (e) => {
    const ren = e.target.closest("[data-ren-cat]");
    const del = e.target.closest("[data-del-cat]");
    if (ren) {
      const oldC = ren.dataset.renCat;
      const newC = prompt(`Rename category "${oldC}" to:`, oldC);
      if (!newC || !newC.trim() || newC.trim().toLowerCase() === oldC) return;
      Storage.renameCategoryEverywhere(oldC, newC.trim().toLowerCase());
      renderCategoriesEditor();
      renderFilterOptions();
      renderSnacks();
    } else if (del) {
      Storage.setCategories(Storage.categories.filter(c => c !== del.dataset.delCat));
      renderCategoriesEditor();
      renderFilterOptions();
    }
  });

  /* ---- Tags editor ---- */

  function renderTagsEditor() {
    $("#tag-chips").innerHTML = Storage.tags.map(t => `
      <span class="collection-chip">${esc(t)}
        <button data-ren-tag="${esc(t)}" title="Rename tag (updates all snacks)">✎</button>
        <button data-del-tag="${esc(t)}" title="Remove tag from every snack">✕</button>
      </span>`).join("") ||
      `<span class="card-meta">No tags yet — add one below, or tag a snack and it appears here.</span>`;
  }

  $("#tag-add-btn").addEventListener("click", () => {
    const input = $("#tag-add-input");
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    if (Storage.tags.includes(val)) { toast("That tag already exists"); return; }
    Storage.setTags([...Storage.tags, val]);
    input.value = "";
    renderTagsEditor();
    renderFilterOptions();
  });
  $("#tag-add-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#tag-add-btn").click();
  });

  $("#tag-chips").addEventListener("click", (e) => {
    const ren = e.target.closest("[data-ren-tag]");
    const del = e.target.closest("[data-del-tag]");
    if (ren) {
      const oldT = ren.dataset.renTag;
      const newT = prompt(`Rename tag "${oldT}" to:`, oldT);
      if (!newT || !newT.trim() || newT.trim().toLowerCase() === oldT) return;
      Storage.renameTagEverywhere(oldT, newT.trim().toLowerCase());
      renderTagsEditor();
      renderFilterOptions();
      renderSnacks();
    } else if (del) {
      const t = del.dataset.delTag;
      if (!confirm(`Remove tag "${t}" from the list AND from every snack using it?`)) return;
      Storage.removeTagEverywhere(t);
      renderTagsEditor();
      renderFilterOptions();
      renderSnacks();
    }
  });

  /* ---- Cloud database (GitHub) ---- */

  const CLOUD_STATUS_TEXT = {
    disconnected: "Not connected",
    syncing: "Connecting…",
    connected: "Connected — syncing automatically",
    error: "Sync error — reconnect with a valid token",
  };

  function renderCloudStatus(info) {
    cloudInfoCache = info;
    $("#cloud-dot").className = "status-dot" +
      (info.status === "connected" ? " connected"
        : info.status === "syncing" ? " needs-permission"
        : info.status === "error" ? " error" : "");
    updateHeaderDot();
    $("#cloud-status-text").textContent = CLOUD_STATUS_TEXT[info.status] || info.status;
    $("#cloud-repo-name").textContent = info.repo ? `Repo: ${info.repo} / ${info.path}` : "";
    $("#cloud-last-synced").textContent = info.lastSyncedAt
      ? "Last synced: " + info.lastSyncedAt.toLocaleTimeString() : "";
    const active = info.status === "connected" || info.status === "syncing";
    $("#cloud-form").classList.toggle("hidden", active);
    $("#cloud-connect-btn").classList.toggle("hidden", active);
    $("#cloud-sync-now-btn").classList.toggle("hidden", info.status !== "connected");
    $("#cloud-disconnect-btn").classList.toggle("hidden", !active && info.status !== "error");
  }

  $("#cloud-connect-btn").addEventListener("click", async () => {
    const token = $("#cloud-token").value.trim();
    const repoStr = $("#cloud-repo").value.trim();
    const path = $("#cloud-path").value.trim() || "snakapp-db.json";
    const m = repoStr.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!token) { toast("Paste your GitHub token first"); return; }
    if (!m) { toast("Repository must look like owner/name"); return; }
    try {
      await Storage.connectCloud({ token, owner: m[1], repo: m[2], path });
      renderAll();
      toast("Cloud database connected");
      $("#cloud-token").value = "";
    } catch (err) {
      toast("Connect failed: " + err.message);
    }
  });

  $("#cloud-disconnect-btn").addEventListener("click", () => {
    if (!confirm("Disconnect the cloud database? Data stays on this device and in the repo; they just stop syncing.")) return;
    Storage.disconnectCloud();
    toast("Cloud database disconnected");
  });

  Storage.onCloudStatus(renderCloudStatus);
  Storage.onFileStatus(renderDbStatus);
  Storage.onDataReloaded(() => {
    renderAll();
    toast("Database updated from sync");
  });

  /* ================= Init ================= */
  function renderAll() {
    renderFilterOptions();
    renderSnacks();
    renderRecipes();
    renderPlan();
    renderGroceryPicker();
    renderGroceryList();
    renderSavedGroceryLists();
    renderIdeas();
    renderLunches();
    renderDaily();
    renderCollections();
    renderCategoriesEditor();
    renderTagsEditor();
  }
  $("#daily-date").value = todayStr();
  renderAll();
  renderDbStatus(Storage.fileInfo());
  renderCloudStatus(Storage.cloudInfo());
  // Restore previous connections; re-render once their data is loaded
  Storage.initFileSync().then(renderAll);
  Storage.initCloudSync().then(renderAll);
  // Recipe suggestions refresh themselves once a week
  if (Suggest.isStale()) loadIdeas("weekly");

})();
