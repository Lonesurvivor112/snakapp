/* ============ SnakApp recipe importer ============
 * Extraction pipeline for a URL:
 *   1. Fetch the page HTML — direct first, then through several CORS proxies.
 *      A response only "wins" if it contains JSON-LD Recipe schema; bot-wall
 *      pages (e.g. "Simple Page" from protected sites) are rejected.
 *   2. If no source yields schema, fall back to the r.jina.ai reader service,
 *      which renders the page like a browser and returns markdown we parse
 *      heuristically (works on bot-protected sites like AllRecipes).
 *   3. Last resort: OpenGraph metadata from the best HTML we got, then the
 *      caller's manual editor.
 */
const Importer = (() => {

  const FETCH_TIMEOUT_MS = 10000;
  const READER_TIMEOUT_MS = 30000;
  const JUNK_TITLE = /simple page|just a moment|access denied|attention required|robot check|captcha|are you human|pardon our interruption/i;

  /* ---- Fetching ---- */
  async function fetchText(url, ms = FETCH_TIMEOUT_MS, headers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- Cleanup for scraped text: checkbox glyphs, markdown bold markers,
   *      and missing spaces left by concatenated page elements ---- */
  function cleanupLine(s) {
    return String(s)
      .replace(/[▢☐□◻✓]+\s*/g, " ")
      .replace(/\*\*|__/g, "")
      .replace(/(\d)\(/g, "$1 (")            // "1(4 ounce)" → "1 (4 ounce)"
      .replace(/\)(?=[A-Za-z])/g, ") ")      // ")onion" → ") onion"
      .replace(/\b(teaspoons?|tablespoons?|tsps?|tbsps?|cups?|grams?|ounces?|pounds?|litres?|liters?)(?=[A-Za-z])/gi, "$1 ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /* ---- ISO 8601 duration (PT1H30M) → minutes ---- */
  function durationToMinutes(iso) {
    if (!iso || typeof iso !== "string") return null;
    const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
    if (!m) return null;
    const mins = (parseInt(m[1] || 0) * 1440) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
    return mins || null;
  }

  /* ---- "1 hr 30 mins" / "45 mins" → minutes ---- */
  function humanDurationToMinutes(str) {
    if (!str) return null;
    let mins = 0;
    const h = str.match(/(\d+)\s*(?:hrs?|hours?|h\b)/i);
    if (h) mins += parseInt(h[1]) * 60;
    const m = str.match(/(\d+)\s*(?:mins?|minutes?|m\b)/i);
    if (m) mins += parseInt(m[1]);
    return mins || null;
  }

  function textOf(v) {
    if (v == null) return "";
    if (typeof v === "string") return decodeEntities(v.trim());
    if (Array.isArray(v)) return textOf(v[0]);
    if (typeof v === "object") return textOf(v.text || v.name || v["@value"] || "");
    return String(v);
  }

  function decodeEntities(str) {
    const el = document.createElement("textarea");
    el.innerHTML = str;
    return el.value;
  }

  function imageUrlOf(img) {
    if (!img) return "";
    if (typeof img === "string") return img;
    if (Array.isArray(img)) return imageUrlOf(img[0]);
    if (typeof img === "object") return img.url || img.contentUrl || "";
    return "";
  }

  /* ---- Find a typed object inside JSON-LD (handles arrays and @graph) ---- */
  function findNodeOfType(node, typeName) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findNodeOfType(item, typeName);
        if (found) return found;
      }
      return null;
    }
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some(t => typeof t === "string" && t.toLowerCase() === typeName)) return node;
    if (node["@graph"]) return findNodeOfType(node["@graph"], typeName);
    return null;
  }
  const findRecipeNode = (node) => findNodeOfType(node, "recipe");

  /* ---- Instructions: string | string[] | HowToStep[] | HowToSection[] ---- */
  function extractInstructions(raw) {
    if (!raw) return [];
    if (typeof raw === "string") {
      return raw.split(/\.\s+(?=[A-Z])|\n+/).map(s => decodeEntities(s.trim())).filter(Boolean);
    }
    if (!Array.isArray(raw)) raw = [raw];
    const steps = [];
    for (const item of raw) {
      if (typeof item === "string") {
        steps.push(decodeEntities(item.trim()));
      } else if (item && typeof item === "object") {
        const type = String(item["@type"] || "");
        if (type.toLowerCase() === "howtosection" && item.itemListElement) {
          const sub = extractInstructions(item.itemListElement);
          if (item.name) steps.push("— " + textOf(item.name) + " —");
          steps.push(...sub);
        } else {
          const t = textOf(item.text || item.name);
          if (t) steps.push(t);
        }
      }
    }
    return steps.filter(Boolean);
  }

  /* ---- JSON-LD extraction from parsed document ---- */
  function extractFromJsonLd(doc, sourceUrl) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let parsed;
      try { parsed = JSON.parse(script.textContent); } catch (e) { continue; }
      const node = findRecipeNode(parsed);
      if (!node) continue;

      const ingredients = (node.recipeIngredient || node.ingredients || [])
        .map(i => cleanupLine(textOf(i))).filter(Boolean);

      return {
        name: textOf(node.name) || "Untitled recipe",
        ingredients,
        instructions: extractInstructions(node.recipeInstructions).map(cleanupLine),
        prepTime: durationToMinutes(node.prepTime),
        cookTime: durationToMinutes(node.cookTime),
        totalTime: durationToMinutes(node.totalTime),
        servings: textOf(node.recipeYield),
        nutrition: node.nutrition ? textOf(node.nutrition.calories) : "",
        image: imageUrlOf(node.image),
        sourceUrl,
        rawSchema: node,       // keep original JSON-LD for provenance
        importMethod: "json-ld",
      };
    }
    return null;
  }

  /* ---- OpenGraph / meta fallback (partial data → user completes manually) ---- */
  function extractFromMeta(doc, sourceUrl) {
    const meta = (prop) =>
      doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.getAttribute("content") || "";
    const title = (meta("og:title") || doc.querySelector("title")?.textContent || "").trim();
    // Bot-protection interstitials have a title but no real content — reject them
    if (!title || JUNK_TITLE.test(title)) return null;
    return {
      name: title,
      ingredients: [],
      instructions: [],
      prepTime: null,
      cookTime: null,
      totalTime: null,
      servings: "",
      nutrition: "",
      image: meta("og:image"),
      notes: meta("og:description"),
      sourceUrl,
      rawSchema: null,
      importMethod: "opengraph",
    };
  }

  /* ---- Reader-service markdown → recipe (heuristic) ---- */
  function parseReaderMarkdown(md, sourceUrl) {
    const lines = md.split(/\r?\n/);

    const titleMatch = md.match(/^Title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // "Prep Time:\n\n30 mins" style label/value pairs
    const labelValue = (label) => {
      const re = new RegExp(label + ":?\\s*\\n+\\s*([^\\n]+)", "i");
      const m = md.match(re);
      return m ? m[1].trim() : "";
    };

    // Blog posts often discuss "Ingredients" in prose before the actual recipe
    // card, and recipe cards are followed by Notes/Nutrition we must not absorb.
    const STOP_HEADING = /^#{1,6}\s*(recipe\s+)?(notes?|nutrition|video|faq|related|comments|reviews)\b/i;

    const sectionAfter = (startIdx) => {
      const out = [];
      for (let i = startIdx + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^##\s/.test(t) || STOP_HEADING.test(t)) break;
        out.push(t);
      }
      return out;
    };

    // Of all sections under a matching heading, keep the one that looks most
    // like real recipe data (quantity-led lines score double); ties go to the
    // later section since recipe cards sit at the bottom of blog posts.
    const bestSection = (headingRe, itemRe) => {
      let best = [], bestScore = 0;
      lines.forEach((l, idx) => {
        if (!headingRe.test(l.trim())) return;
        const items = sectionAfter(idx)
          .filter(t => itemRe.test(t))
          .map(t => cleanupLine(t.replace(itemRe, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")))
          .filter(t => /[a-z0-9]/i.test(t) && !/^\d+(\/\d+)?x$/i.test(t));
        const score = items.length + items.filter(t => /^[\d½¼¾⅓⅔⅕⅙⅛⅜⅝⅞]/.test(t)).length * 2;
        if (items.length && score >= bestScore) { best = items; bestScore = score; }
      });
      return best;
    };

    const ingredients = bestSection(/^#{1,4}\s*Ingredients\b/i, /^[*+-]\s+/);
    const instructions = bestSection(/^#{1,4}\s*(Directions|Instructions|Method|Steps|Preparation)\b/i, /^\d+\.\s+/);

    // Without at least ingredients or steps this isn't a usable extraction
    if (!ingredients.length && !instructions.length) return null;

    const img = md.match(/!\[[^\]]*\]\((https?:[^)\s]+)\)/);

    return {
      name: title || "Imported recipe",
      ingredients,
      instructions,
      prepTime: humanDurationToMinutes(labelValue("Prep Time")),
      cookTime: humanDurationToMinutes(labelValue("Cook Time")),
      totalTime: humanDurationToMinutes(labelValue("Total Time")),
      servings: labelValue("Servings").replace(/[^0-9a-z ]/gi, "").trim(),
      nutrition: "",
      image: img ? img[1] : "",
      sourceUrl,
      rawSchema: null,
      importMethod: "reader",
    };
  }

  /* ---- Public: parse an HTML string (also used by the Paste HTML flow) ---- */
  function parseHtml(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return extractFromJsonLd(doc, sourceUrl) || extractFromMeta(doc, sourceUrl);
  }

  /* ---- Public: full URL import pipeline ---- */
  async function importFromUrl(url) {
    const enc = encodeURIComponent(url);
    const htmlSources = [
      url, // direct — works when the site sends CORS headers
      "https://api.allorigins.win/raw?url=" + enc,
      "https://corsproxy.io/?url=" + enc,
      "https://api.codetabs.com/v1/proxy?quest=" + enc,
    ];

    let fallback = null;
    for (const src of htmlSources) {
      let html;
      try { html = await fetchText(src); } catch (e) { continue; }
      const parsed = parseHtml(html, url);
      if (parsed && parsed.importMethod === "json-ld") return parsed; // real schema — done
      if (parsed && !fallback) fallback = parsed;                     // remember best OG result
    }

    // Bot-protected site: the reader service renders it like a real browser.
    // Ask for the rendered HTML first — it still contains the JSON-LD schema,
    // which beats any heuristic parsing.
    try {
      const html = await fetchText("https://r.jina.ai/" + url, READER_TIMEOUT_MS, { "X-Return-Format": "html" });
      const parsed = parseHtml(html, url);
      if (parsed && parsed.importMethod === "json-ld") {
        parsed.importMethod = "json-ld-rendered";
        return parsed;
      }
      if (parsed && !fallback) fallback = parsed;
    } catch (e) { /* reader unavailable — fall through */ }

    // No schema even in the rendered page → parse the reader's markdown heuristically
    try {
      const md = await fetchText("https://r.jina.ai/" + url, READER_TIMEOUT_MS);
      const parsed = parseReaderMarkdown(md, url);
      if (parsed) return parsed;
    } catch (e) { /* reader unavailable — fall through */ }

    if (fallback) return fallback;
    throw new Error("No recipe data found on that page.");
  }

  /* ================= Product (snack) import ================= */
  /* Store sites like kroger.com block all fetching, but their product URLs
   * contain the UPC barcode — Open Food Facts can look that up directly.
   * Pipeline: barcode → page scrape (Product schema / OpenGraph) → URL slug. */

  function titleCaseSlug(slug) {
    return slug.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
  }

  function guessCategory(tags) {
    const t = (tags || []).join(" ").toLowerCase();
    if (/beverage|drink|soda|juice|water|coffee|tea/.test(t)) return "drink";
    if (/chocolate|cand(y|ie)|sweet|cookie|biscuit|dessert|ice-cream|pastr/.test(t)) return "sweet";
    if (/chip|crisp|salt|popcorn|pretzel|cracker|nut/.test(t)) return "salty";
    if (/fruit|vegetable|yogurt|granola|cereal/.test(t)) return "healthy";
    return "other";
  }

  async function offLookup(code) {
    const raw = await fetchText(
      "https://world.openfoodfacts.org/api/v2/product/" + code +
      ".json?fields=product_name,brands,image_front_url,quantity,categories_tags_en", 12000);
    const json = JSON.parse(raw);
    return json.status === 1 ? json.product : null;
  }

  function extractProductFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try { parsed = JSON.parse(script.textContent); } catch (e) { continue; }
      const node = findNodeOfType(parsed, "product");
      if (node && node.name) {
        return {
          name: textOf(node.name),
          image: imageUrlOf(node.image),
          notes: textOf(node.description).slice(0, 200),
          method: "product-schema",
        };
      }
    }
    const meta = (p) =>
      doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
    const title = (meta("og:title") || "").trim();
    if (title && !JUNK_TITLE.test(title)) {
      return { name: title, image: meta("og:image"), notes: meta("og:description").slice(0, 200), method: "opengraph" };
    }
    return null;
  }

  async function importProduct(url) {
    const path = decodeURIComponent(new URL(url).pathname);
    const segs = path.split("/").filter(Boolean);
    const slug = segs.filter(s => /[a-z]/i.test(s) && s.includes("-"))
      .sort((a, b) => b.length - a.length)[0] || "";

    // Barcode variants: as-is, zero-stripped, GTIN-13 ↔ UPC-A
    const codeMatch = path.match(/(\d{10,14})(?:\/|$)/);
    const variants = [];
    if (codeMatch) {
      const c = codeMatch[1];
      variants.push(c);
      if (c.length === 13 && c.startsWith("0")) variants.push(c.slice(1));
      if (c.length === 12) variants.push("0" + c);
      const stripped = c.replace(/^0+/, "");
      if (!variants.includes(stripped)) variants.push(stripped);
    }
    let product = null;
    for (const code of variants) {
      try { product = await offLookup(code); } catch (e) { /* next variant */ }
      if (product) break;
    }
    if (product) {
      return {
        name: cleanupLine(product.product_name || titleCaseSlug(slug)) || titleCaseSlug(slug),
        category: guessCategory(product.categories_tags_en),
        image: product.image_front_url || "",
        notes: [product.brands, product.quantity].filter(Boolean).join(" · "),
        purchaseUrl: url,
        importMethod: "barcode",
      };
    }

    // No barcode hit — try scraping the page itself (works on unprotected shops)
    const enc = encodeURIComponent(url);
    const htmlSources = [
      url,
      "https://api.allorigins.win/raw?url=" + enc,
      "https://corsproxy.io/?url=" + enc,
    ];
    for (const src of htmlSources) {
      let html;
      try { html = await fetchText(src); } catch (e) { continue; }
      const p = extractProductFromHtml(html);
      if (p) {
        return {
          name: cleanupLine(p.name), category: "other", image: p.image,
          notes: cleanupLine(p.notes || ""), purchaseUrl: url, importMethod: p.method,
        };
      }
    }

    // Last resort: derive a name from the URL slug
    if (slug) {
      return {
        name: titleCaseSlug(slug), category: "other", image: "",
        notes: "", purchaseUrl: url, importMethod: "slug",
      };
    }
    throw new Error("Couldn't extract product info from that URL.");
  }

  return { importFromUrl, importProduct, parseHtml, durationToMinutes };
})();
