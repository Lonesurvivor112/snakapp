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
   * "Monterey Jack cheese" merge into one grocery item */
  function normalizeName(name) {
    return name.toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(",")[0]
      .replace(/\b(chopped|minced|sliced|diced|shredded|grated|melted|softened|cooked|beaten|peeled|crushed|cubed|trimmed|halved|quartered|fresh|freshly|finely|thinly|coarsely|roughly|lightly|divided|drained|rinsed|packed|heaping|level|optional|large|medium|small|extra|plus more.*|or more.*|to taste|as needed|for garnish|for serving)\b/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function parseIngredient(raw) {
    let s = String(raw).trim();
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
      let item = map.get(p.name);
      if (!item) {
        item = { name: p.name, amounts: {}, from: [], checked: false };
        map.set(p.name, item);
      }
      if (p.qty != null) {
        const unit = p.unit || "x";
        item.amounts[unit] = (item.amounts[unit] || 0) + p.qty;
      }
      if (!item.from.includes(r.name)) item.from.push(r.name);
    }));
    return {
      items: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
      recipeNames: recipes.map(r => r.name),
      createdAt: new Date().toISOString(),
    };
  }

  return { build, formatAmounts, parseIngredient };
})();
