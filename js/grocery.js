/* ============ SnakApp grocery list builder ============
 * Parses ingredient lines like "2 tablespoons vegetable oil, or more as needed"
 * into {qty, unit, name}, then merges the same ingredient across recipes,
 * summing quantities per unit ("1 cup + 2 tbsp" when units differ).
 */
const Grocery = (() => {

  const FRAC = {
    "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75,
    "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅚": 5 / 6,
    "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
  };
  const FRAC_CLASS = "[" + Object.keys(FRAC).join("") + "]";

  const UNITS = [
    "cups", "cup", "tablespoons", "tablespoon", "tbsps", "tbsp",
    "teaspoons", "teaspoon", "tsps", "tsp", "ounces", "ounce", "oz",
    "pounds", "pound", "lbs", "lb", "grams", "gram", "g", "kilograms", "kg",
    "milliliters", "millilitres", "ml", "liters", "litres", "liter", "litre", "l",
    "cans", "can", "packages", "package", "pkg", "packets", "packet",
    "cloves", "clove", "slices", "slice", "pinches", "pinch", "dashes", "dash",
    "sticks", "stick", "bunches", "bunch", "heads", "head", "bags", "bag",
    "bottles", "bottle", "jars", "jar", "pieces", "piece", "inches", "inch",
    "sprigs", "sprig", "stalks", "stalk", "ears", "ear",
  ];
  const UNIT_CANON = {
    cups: "cup", tablespoons: "tbsp", tablespoon: "tbsp", tbsps: "tbsp",
    teaspoons: "tsp", teaspoon: "tsp", tsps: "tsp",
    ounces: "oz", ounce: "oz", pounds: "lb", lbs: "lb", pound: "lb",
    grams: "g", gram: "g", kilograms: "kg",
    milliliters: "ml", millilitres: "ml", liters: "l", litres: "l", liter: "l", litre: "l",
    cans: "can", packages: "pkg", package: "pkg", packets: "pkg", packet: "pkg",
    cloves: "clove", slices: "slice", pinches: "pinch", dashes: "dash",
    sticks: "stick", bunches: "bunch", heads: "head", bags: "bag",
    bottles: "bottle", jars: "jar", pieces: "piece", inches: "inch",
    sprigs: "sprig", stalks: "stalk", ears: "ear",
  };

  /* Leading number token: "1 1/2" | "1/2" | "1½" | "½" | "1.5" | "1" */
  function parseNumberToken(s) {
    let m = s.match(/^(\d+)\s+(\d+)\/(\d+)/);
    if (m) return { value: +m[1] + (+m[2] / +m[3]), len: m[0].length };
    m = s.match(/^(\d+)\/(\d+)/);
    if (m) return { value: +m[1] / +m[2], len: m[0].length };
    m = s.match(new RegExp("^(\\d+(?:\\.\\d+)?)\\s?(" + FRAC_CLASS + ")"));
    if (m) return { value: +m[1] + FRAC[m[2]], len: m[0].length };
    m = s.match(new RegExp("^(" + FRAC_CLASS + ")"));
    if (m) return { value: FRAC[m[1]], len: m[0].length };
    m = s.match(/^(\d+(?:\.\d+)?)/);
    if (m) return { value: +m[1], len: m[0].length };
    return null;
  }

  /* Strip prep words so "shredded Monterey Jack cheese, divided" and
   * "Monterey Jack cheese" merge into one grocery item. Descriptors are removed
   * BEFORE splitting on commas so "skinless, boneless chicken breast halves"
   * resolves to "chicken breast halves", not "skinless". */
  const ADJ = /\b(chopped|minced|sliced|diced|shredded|grated|melted|softened|cooked|beaten|peeled|crushed|cubed|trimmed|halved|quartered|pounded|skinless|boneless|seedless|lean|ripe|thin|thinly|fresh|freshly|finely|coarsely|roughly|lightly|divided|drained|rinsed|packed|heaping|level|optional|large|medium|small|extra)\b/g;

  function normalizeName(name) {
    let n = name.toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/,?\s*\b(plus more.*|or more.*|or to taste|to taste|or as needed|as needed|for garnish|for serving)\b/g, " ")
      .replace(ADJ, " ")
      .replace(/\bs\b/g, " ") // orphan "s" left behind by older imports
      .replace(/\s{2,}/g, " ");
    const seg = n.split(",")
      .map(s => s.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim())
      .filter(Boolean)[0] || "";
    return seg.replace(/\s{2,}/g, " ").trim();
  }

  /* ---- Core shopping items ----
   * You don't buy "4 skinless boneless chicken breast halves" — you buy
   * Chicken. These rules collapse variants onto one buyable item, estimate a
   * purchase weight for meats, and keep the recipes' exact wording as detail.
   * The exclusion regex keeps derived products (chicken broth, garlic powder,
   * tomato paste) as their own separate items. */
  const EXCLUDE_CORE = /\b(broth|stock|bouillon|powder|powdered|seasoning|salt|sauce|soup|base|gravy|flavored|extract|paste|noodles?|pasta|juice|syrup)\b/;

  const CORE_RULES = [
    { label: "Green onions", re: /\b(green onions?|scallions?|spring onions?)\b/ },
    { label: "Chicken", re: /\bchicken\b/, defaultPerPiece: 0.5,
      perLb: [[/breast hal(f|ves)/, 0.5], [/breasts?/, 0.65], [/thighs?/, 0.35], [/drumsticks?|legs?/, 0.3], [/wings?/, 0.25], [/whole/, 4]] },
    { label: "Ground beef", re: /\b(ground beef|beef mince|minced beef)\b/, weight: true },
    { label: "Beef", re: /\b(beef|steaks?|sirloin|chuck|brisket)\b/, defaultPerPiece: 0.75, perLb: [[/steaks?/, 0.75]] },
    { label: "Pork", re: /\bpork\b/, defaultPerPiece: 0.5, perLb: [[/chops?/, 0.5]] },
    { label: "Turkey", re: /\bturkey\b/, weight: true },
    { label: "Bacon", re: /\bbacon\b/, defaultPerPiece: 0.06, perLb: [[/slices?|strips?/, 0.06]] },
    { label: "Salmon", re: /\bsalmon\b/, defaultPerPiece: 0.4, perLb: [[/fillets?/, 0.4]] },
    { label: "Shrimp", re: /\b(shrimp|prawns?)\b/, weight: true },
    { label: "Eggs", re: /\beggs?\b/ },
    { label: "Garlic", re: /\bgarlic\b/, cloves: true },
    { label: "Onions", re: /\bonions?\b/ },
    { label: "Tomatoes", re: /\btomato(es)?\b/ },
    { label: "Potatoes", re: /\bpotato(es)?\b/ },
    { label: "Carrots", re: /\bcarrots?\b/ },
  ];

  /* Sum a meat's entries into pounds: real weights convert directly, piece
   * counts use the per-piece weights above. "+" marks a partial estimate. */
  function estimatePounds(rule, entries) {
    let lb = 0, partial = false;
    for (const e of entries) {
      const q = e.qty != null ? e.qty : 1;
      if (e.unit === "lb") lb += q;
      else if (e.unit === "oz") lb += q / 16;
      else if (e.unit === "kg") lb += q * 2.20462;
      else if (e.unit === "g") lb += q / 453.6;
      else if (!e.unit) {
        let per = rule.defaultPerPiece || 0;
        for (const [re, w] of rule.perLb || []) { if (re.test(e.name)) { per = w; break; } }
        if (per) lb += q * per; else partial = true;
      } else partial = true; // "2 cups shredded chicken" — can't convert
    }
    if (!lb) return null;
    const rounded = Math.max(0.25, Math.round(lb * 4) / 4);
    return "≈ " + formatQty(rounded) + " lb" + (partial ? "+" : "");
  }

  function parseIngredient(raw) {
    // heal "teaspoon s" / "pound ed" damage from older imports before parsing
    let s = String(raw).trim()
      .replace(/\b(teaspoon|tablespoon|tsp|tbsp|cup|gram|kilogram|ounce|pound|liter|litre)\s+(s|ed)\b/gi, "$1$2");
    let qty = null;

    const tok = parseNumberToken(s);
    if (tok) {
      qty = tok.value;
      s = s.slice(tok.len).trim();
      // Range like "¾ to 1 teaspoon" — shop for the upper bound
      const range = s.match(/^(?:to|-|–|—)\s*/);
      if (range) {
        const rest = s.slice(range[0].length);
        const tok2 = parseNumberToken(rest);
        if (tok2) { qty = Math.max(qty, tok2.value); s = rest.slice(tok2.len).trim(); }
      }
    }

    s = s.replace(/\([^)]*\)/g, " ").replace(/\s{2,}/g, " ").trim();

    let unit = null;
    const um = s.match(/^([A-Za-z.]+)\s+/);
    if (um) {
      const w = um[1].toLowerCase().replace(/\./g, "");
      if (UNITS.includes(w)) {
        unit = UNIT_CANON[w] || w;
        s = s.slice(um[0].length);
      }
    }
    s = s.replace(/^of\s+/i, "");

    const name = normalizeName(s);
    return { qty, unit, name };
  }

  /* 0.75 → "¾", 1.5 → "1½", 2 → "2" */
  const FRAC_OUT = [
    [0.125, "⅛"], [0.2, "⅕"], [0.25, "¼"], [1 / 3, "⅓"], [0.375, "⅜"],
    [0.5, "½"], [0.625, "⅝"], [2 / 3, "⅔"], [0.75, "¾"], [0.8, "⅘"], [0.875, "⅞"],
  ];
  function formatQty(q) {
    const whole = Math.floor(q + 1e-9);
    const frac = q - whole;
    if (frac < 0.04) return String(whole);
    for (const [v, ch] of FRAC_OUT) {
      if (Math.abs(frac - v) < 0.04) return (whole ? whole : "") + ch;
    }
    return String(Math.round(q * 100) / 100);
  }

  function formatAmounts(amounts) {
    return Object.entries(amounts || {})
      .map(([unit, q]) => formatQty(q) + (unit === "x" ? "" : " " + unit))
      .join(" + ");
  }

  function build(recipes) {
    const map = new Map();
    recipes.forEach(r => (r.ingredients || []).forEach(line => {
      const p = parseIngredient(line);
      if (!p.name) return;
      const rule = EXCLUDE_CORE.test(p.name) ? null : CORE_RULES.find(rl => rl.re.test(p.name));
      const key = rule ? "core:" + rule.label : p.name;
      let item = map.get(key);
      if (!item) {
        item = { name: rule ? rule.label : p.name, amounts: {}, from: [], details: [], entries: [], core: !!rule, checked: false };
        map.set(key, item);
      }
      if (p.qty != null) {
        const unit = p.unit || "x";
        item.amounts[unit] = (item.amounts[unit] || 0) + p.qty;
      }
      item.entries.push(p);
      // Keep the recipe's exact wording so quantities can be judged in-store
      if (rule && p.name !== rule.label.toLowerCase()) {
        item.details.push(String(line).trim() + " (" + r.name + ")");
      }
      if (!item.from.includes(r.name)) item.from.push(r.name);
    }));

    const items = [...map.values()].map(item => {
      const rule = item.core ? CORE_RULES.find(rl => rl.label === item.name) : null;
      if (rule && (rule.perLb || rule.defaultPerPiece || rule.weight)) {
        item.est = estimatePounds(rule, item.entries);
      } else if (rule && rule.cloves) {
        const cloves = item.amounts["clove"];
        if (cloves) item.est = "≈ " + Math.ceil(cloves / 10) + (cloves > 10 ? " heads" : " head");
      }
      delete item.entries; // parse internals — don't persist
      return item;
    });

    return {
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      recipeNames: recipes.map(r => r.name),
      createdAt: new Date().toISOString(),
    };
  }

  return { build, formatAmounts, parseIngredient };
})();
