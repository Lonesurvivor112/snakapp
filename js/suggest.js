/* ============ SnakApp recipe suggestions ============
 * Pulls fresh recipe ideas from favorite food blogs. Two source kinds:
 *  - "wp": the site's public WordPress JSON API (fetched directly — these
 *    sites send CORS headers, verified per-site before inclusion)
 *  - "jina": bot-protected sites with no open API; the r.jina.ai reader
 *    renders the page and we pull recipe links out of its markdown
 * A preference (chicken, vegetarian, dessert, …) is passed through to each
 * site's own search, so filtered batches come pre-matched from the source.
 * The feed is a weekly batch: a new one arrives each Monday. Every fetch digs
 * into the archives at a random depth, and recipes shown in earlier batches
 * (or dismissed with "Not for me") are skipped, so each week is genuinely new.
 * With no type chosen, the "Dinner mix" spreads the batch across main-dish
 * types instead of just taking each blog's newest posts. */
const Suggest = (() => {

  const CACHE_KEY = "snakapp-suggestions";
  const SEEN_KEY = "snakapp-ideas-seen";     // { url: weekKey } — shown in a past batch
  const HIDDEN_KEY = "snakapp-ideas-hidden"; // [url] — dismissed with "Not for me"
  const MAX_SEEN = 1500;
  const MAX_HIDDEN = 1000;
  const MAX_ITEMS = 28;
  const PER_SOURCE = 8;

  const SOURCES = [
    { name: "RecipeTin Eats", type: "wp", api: "https://www.recipetineats.com/wp-json/wp/v2/posts" },
    { name: "Budget Bytes", type: "wp", api: "https://www.budgetbytes.com/wp-json/wp/v2/posts" },
    { name: "Damn Delicious", type: "jina", page: "https://damndelicious.net/", search: "https://damndelicious.net/?s=" },
    { name: "Pinch of Yum", type: "wp", api: "https://pinchofyum.com/wp-json/wp/v2/posts" },
    { name: "Natasha's Kitchen", type: "wp", api: "https://natashaskitchen.com/wp-json/wp/v2/posts" },
    { name: "Sally's Baking Addiction", type: "wp", api: "https://sallysbakingaddiction.com/wp-json/wp/v2/posts", baking: true },
  ];

  const MEAT_RE = /\b(chicken|beef|steak|pork|bacon|ham|sausage|turkey|lamb|meatballs?|burgers?|brisket|ribs|pepperoni|chorizo|prosciutto|carnitas|bulgogi|salmon|shrimp|tuna|cod|tilapia|fish|crab|lobster|scallops?|anchov\w+)\b/i;

  /* Preference chips shown on the Ideas tab.
   *  term:        feeds each site's own search
   *  titleSearch: ask WordPress sites to match the term in titles only —
   *               far more precise than the default body-text search
   *  re / ex:     a suggestion is kept only when its title matches `re` and
   *               not `ex` (covers the reader-service sites and any site
   *               that ignores title-only search)
   *  noMeat:      screens out meat/seafood titles for the vegetarian pick   */
  const PREFS = [
    { id: "all", label: "🍽️ Dinner mix", term: "" },
    { id: "chicken", label: "🍗 Chicken", term: "chicken", titleSearch: true,
      re: /\b(chicken|drumsticks?|wings)\b/i, ex: /\b(cauliflower|tofu|vegan)\b/i },
    { id: "beef", label: "🥩 Beef", term: "beef", titleSearch: true,
      re: /\b(beef|steaks?|brisket|meatloaf|bolognese|birria|bulgogi|pot roast|short ribs?|burgers?|meatballs?)\b/i,
      ex: /\b(chicken|turkey|pork|lamb|salmon|tuna|veggie|vegan|black bean|portobello)\b/i },
    { id: "pork", label: "🥓 Pork", term: "pork", titleSearch: true,
      re: /\b(pork|bacon|ham|sausage|ribs|carnitas|prosciutto|chorizo|bratwursts?|kielbasa)\b/i,
      ex: /\b(beef|chicken|turkey|short ribs?)\b/i },
    { id: "seafood", label: "🐟 Seafood", term: "seafood",
      re: /\b(shrimp|salmon|fish|tuna|cod|tilapia|scallops?|crab|lobster|seafood|prawns?|mussels?|clams?|oysters?|calamari|halibut|snapper|trout|mahi|crawfish)\b/i },
    { id: "pasta", label: "🍝 Pasta", term: "pasta", titleSearch: true,
      re: /\b(pasta|spaghetti|lasagna|penne|fettuccine|linguine|macaroni|noodles?|gnocchi|ravioli|tortellini|orzo|carbonara|alfredo|ziti|rigatoni|cacio e pepe|mac (and|&|'?n'?) cheese)\b/i },
    { id: "soup", label: "🍲 Soups", term: "soup", titleSearch: true,
      re: /\b(soups?|stews?|chowders?|bisque|minestrone|ramen|pho|gumbo|goulash)\b/i },
    { id: "vegetarian", label: "🥦 Vegetarian", term: "vegetarian", noMeat: true },
    { id: "veggies", label: "🥕 Veggies & Sides", term: "side dish",
      re: /\b(vegetables?|veggies?|salads?|slaws?|green beans?|asparagus|broccoli|cauliflower|brussels?( sprouts?)?|zucchini|squash|carrots?|cabbage|beets?|eggplant|mushrooms?|corn|cornbread|coleslaw|side dish(?!es)|greens|cucumber|peppers?|spinach|kale|quinoa|couscous)\b/i,
      ex: MEAT_RE }, // sides shouldn't be meat mains that merely mention a veggie
    { id: "potato", label: "🥔 Potatoes", term: "potato", titleSearch: true,
      re: /\b(potato(es)?|fries|hash ?browns?|tater ?tots?|gnocchi)\b/i },
    { id: "dessert", label: "🍰 Desserts", term: "dessert", titleSearch: true,
      re: /\b(cakes?|cookies?|brownies?|pies?|muffins?|desserts?|cheesecakes?|pudding|ice cream|scones?|cobblers?|tarts?|fudge|donuts?|doughnuts?|cupcakes?|blondies|candy|truffles?|macarons?|macaroons?|shortbread|biscotti|mousse|tiramisu|panna cotta|eclairs?|churros?|baklava|snickerdoodles?|cinnamon rolls?|banana bread|s['’]?mores|puppy chow|rice krispies?|marshmallows?|meringues?|custard|flan|gelato|sorbet|popsicles?|toffee|pralines?|parfaits?|trifle)\b/i,
      ex: /\b(chicken|beef|pork|turkey|shepherd'?s|cottage|pot pies?|pizza|tamale|empanadas?)\b/i },
  ];

  const SPECIFIC = PREFS.filter(p => p.id !== "all"); // the real food types (no "All")
  // Main-dish types the default Dinner mix spreads its batch across
  const MIX_IDS = ["chicken", "beef", "pork", "seafood", "pasta", "soup", "vegetarian"];

  /* Food-type taxonomy reused by the Recipes page: the same types, plus a
   * catch-all. `classifyTitle` guesses a recipe's type from its title. */
  const OTHER = { id: "other", label: "🍴 Other" };
  const FOOD_TYPES = [...SPECIFIC.map(p => ({ id: p.id, label: p.label })), OTHER];
  const CLASSIFY_ORDER = ["chicken", "beef", "pork", "seafood", "dessert", "pasta", "soup", "potato", "veggies"];

  function classifyTitle(title) {
    const t = String(title || "");
    for (const id of CLASSIFY_ORDER) {
      const p = SPECIFIC.find(x => x.id === id);
      if (p && p.re && p.re.test(t) && !(p.ex && p.ex.test(t))) return id;
    }
    return "other"; // vegetarian isn't guessable from a title — left for the user to set
  }

  function foodTypeLabel(id) {
    const f = FOOD_TYPES.find(x => x.id === id);
    return f ? f.label : OTHER.label;
  }

  /* Roundups, meal-plan posts, giveaways, and promo banners aren't single recipes — skip them */
  const SKIP_TITLE = /^\d+\+?\s(?!-?(minutes?|min|ingredients?|hours?|steps?)\b)|^image \d+$|recipes\s*$|\b\d+\s+(\w+[- ]?){0,3}recipes\b|^(homemade |easy )?(\w+ )?(\w+ )?(stock|broth)\s*$|\b(meal plans?|round[ -]?ups?|what i ate|giveaway|sweepstakes|gift card|chance to win|week of|gift guide|ideas)\b/i;

  const ta = document.createElement("textarea");
  function decodeEntities(s) {
    ta.innerHTML = s || "";
    if (/&[#a-z0-9]+;/i.test(ta.value)) ta.innerHTML = ta.value; // some titles arrive double-encoded ("&amp;amp;")
    return ta.value;
  }

  /* withTotal: also return WordPress's X-WP-Total (how many posts match) */
  async function fetchWithTimeout(url, ms, withTotal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      return withTotal ? { text, total: parseInt(res.headers.get("X-WP-Total"), 10) || 0 } : text;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- WordPress JSON API sources ---- */

  function wpImage(post) {
    const media = post._embedded && post._embedded["wp:featuredmedia"] && post._embedded["wp:featuredmedia"][0];
    const sizes = media && media.media_details && media.media_details.sizes;
    return (sizes && ((sizes.medium_large && sizes.medium_large.source_url) ||
                      (sizes.medium && sizes.medium.source_url))) ||
      post.jetpack_featured_media_url || (media && media.source_url) || "";
  }

  async function fetchWp(src, offset, pref, count) {
    const query = (off, titleOnly) => src.api + "?per_page=" + count + "&offset=" + off +
      (pref.term
        ? "&search=" + encodeURIComponent(pref.term) + (titleOnly ? "&search_columns=post_title" : "")
        : "") +
      "&_embed=wp:featuredmedia&_fields=link,title,date,jetpack_featured_media_url,_links,_embedded";
    const load = async (off, titleOnly) => {
      const r = await fetchWithTimeout(query(off, titleOnly), 12000, true);
      return { posts: JSON.parse(r.text), total: r.total };
    };
    const titleOnly = !!pref.titleSearch;
    let { posts, total } = await load(offset, titleOnly);
    if (!posts.length && offset > 0 && total > 0) { // dug past the end of a smaller result set — re-dig inside it
      ({ posts } = await load(Math.floor(Math.random() * Math.max(1, total - count + 1)), titleOnly));
    }
    if (!posts.length && titleOnly) { // no title matches on this site — try its full search
      ({ posts } = await load(0, false));
    }
    return posts.map(p => ({
      title: decodeEntities((p.title && p.title.rendered) || "").trim(),
      url: p.link,
      image: wpImage(p),
      source: src.name,
    })).filter(it => it.title && it.url && !SKIP_TITLE.test(it.title));
  }

  /* ---- Reader-rendered sources ---- */

  /* Damn Delicious markdown, both shapes seen in the wild:
   *   homepage: [![Image N: Title](imgurl)](posturl)
   *   search:   [![Image N](imgurl) ### Title](posturl "Title")            */
  function parseDamnDelicious(md, src) {
    const items = [];
    const re = /\[!\[(?:Image \d+:?\s*)?([^\]]*)\]\((https:\/\/damndelicious\.net\/wp-content\/[^)\s]+)\)\s*(?:###\s+([^\]]+))?\]\((https:\/\/damndelicious\.net\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/)/g;
    let m;
    while ((m = re.exec(md)) && items.length < PER_SOURCE * 2) {
      const title = decodeEntities((m[3] || m[1] || "").trim());
      if (!title || SKIP_TITLE.test(title) || items.some(it => it.url === m[4])) continue;
      items.push({ title, url: m[4], image: m[2], source: src.name });
    }
    return items;
  }

  async function fetchJina(src, pref) {
    const target = pref.term ? src.search + encodeURIComponent(pref.term) : src.page;
    const md = await fetchWithTimeout("https://r.jina.ai/" + encodeURIComponent(target), 30000);
    return parseDamnDelicious(md, src);
  }

  /* Strict per-type title check: keep only titles that name the type (and, for
   * vegetarian, name no meat). This is what makes "Chicken" actually all chicken. */
  function applyPrefFilter(list, pref) {
    if (pref.noMeat) list = list.filter(it => !MEAT_RE.test(it.title));
    if (pref.re) list = list.filter(it => pref.re.test(it.title) && !(pref.ex && pref.ex.test(it.title)));
    return list;
  }

  /* Exclusion keeps everything that doesn't name an unwanted type — including
   * uncategorizable recipes, so "everything except desserts" really means it. */
  function dropExcluded(list, excluded) {
    return list.filter(it => !excluded.some(p => p.re && p.re.test(it.title)));
  }

  /* One WordPress source, searched for a single type. Every fetch digs into the
   * archives at a random depth (sometimes 0 = newest) so batches keep changing
   * week to week — shallower when a search term already narrows the pool. */
  function fetchWpForPref(src, pref, keep) {
    const count = (pref.re || pref.noMeat) ? PER_SOURCE * 2 : PER_SOURCE; // over-fetch; the filters thin it
    const depth = pref.term ? 5 : 12;
    const offset = count * Math.floor(Math.random() * (depth + 1));
    return fetchWp(src, offset, pref, count).then(list =>
      applyPrefFilter(list, pref).filter(keep).slice(0, PER_SOURCE)
        .map(it => Object.assign(it, { type: pref.id })));
  }

  const ALL_PREF = PREFS[0]; // { term: "" } — latest posts / homepage, unfiltered
  const DESSERT = SPECIFIC.find(p => p.id === "dessert");

  /* Fetch one source under a plan: { mode, included, excluded, keep, mixFor }.
   *  mix      → (default) each blog searched for a couple of main-dish types
   *  all      → posts at a random depth, no filter
   *  exclude  → posts minus the unwanted types (few requests, keeps misc.)
   *  include  → search each wanted type and merge (precise; the common case)
   * `keep` drops recipes already seen, dismissed, or in the collection. */
  function fetchSourceMulti(src, plan) {
    const keep = plan.keep;
    if (src.type === "wp") {
      if (plan.mode === "mix" || plan.mode === "include") {
        if (plan.mode === "mix" && src.baking) return Promise.resolve([]); // little for dinner there
        const prefs = plan.mode === "mix" ? (plan.mixFor[src.name] || []) : plan.included;
        return Promise.all(prefs.map(p => fetchWpForPref(src, p, keep).catch(() => [])))
          .then(lists => interleave(lists, PER_SOURCE));
      }
      const count = PER_SOURCE * 2;
      const offset = count * Math.floor(Math.random() * 13);
      return fetchWp(src, offset, ALL_PREF, count).then(list =>
        (plan.mode === "exclude" ? dropExcluded(list, plan.excluded) : list).filter(keep).slice(0, PER_SOURCE));
    }
    // reader-service source: keep it to one request each so we never hammer r.jina.ai
    if (plan.mode === "include" && plan.included.length === 1) { // a single type → the site's own search
      const p = plan.included[0];
      return fetchJina(src, p).then(list => applyPrefFilter(list, p).filter(keep).slice(0, PER_SOURCE));
    }
    return fetchJina(src, ALL_PREF).then(list => {
      if (plan.mode === "include") { // several types → filter the homepage
        list = list.filter(it => plan.included.some(p => p.re && p.re.test(it.title) && !(p.ex && p.ex.test(it.title))));
      } else if (plan.mode !== "all") {
        list = dropExcluded(list, plan.excluded);
      }
      return list.filter(keep).slice(0, PER_SOURCE);
    });
  }

  /* Turn a set of chosen type ids into a fetch plan. Nothing chosen is the Dinner
   * mix; choosing more than half the types flips to exclusion (fewer requests,
   * and it keeps miscellaneous recipes). */
  function planFrom(ids) {
    const seen = new Set();
    const selected = ids.map(id => SPECIFIC.find(p => p.id === id))
      .filter(p => p && !seen.has(p.id) && seen.add(p.id));
    if (!selected.length) {
      return { mode: "mix", included: SPECIFIC.filter(p => MIX_IDS.includes(p.id)), excluded: [DESSERT], ids: [] };
    }
    if (selected.length === SPECIFIC.length) {
      return { mode: "all", included: [], excluded: [], ids: selected.map(p => p.id) };
    }
    if (selected.length > SPECIFIC.length / 2) {
      return { mode: "exclude", included: [], excluded: SPECIFIC.filter(p => !selected.includes(p)),
        ids: selected.map(p => p.id) };
    }
    return { mode: "include", included: selected, excluded: [], ids: selected.map(p => p.id) };
  }

  /* Dinner mix: shuffle the main types and hand each blog two of them, so the
   * week's batch covers every type and the pairings change each time. */
  function assignMix(plan) {
    const types = plan.included.slice();
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    plan.mixFor = {};
    SOURCES.filter(s => s.type === "wp" && !s.baking).forEach((s, k) => {
      plan.mixFor[s.name] = [types[(2 * k) % types.length], types[(2 * k + 1) % types.length]];
    });
  }

  /* Round-robin across sources so no single site dominates the top of the grid.
   * Same-titled recipes from different blogs only appear once. */
  function interleave(lists, cap) {
    const out = [];
    const seen = new Set();
    for (let i = 0; ; i++) {
      let any = false;
      for (const list of lists) {
        if (i >= list.length) continue;
        any = true;
        const it = list[i];
        const titleKey = "t:" + it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!seen.has(it.url) && !seen.has(titleKey) && out.length < cap) {
          seen.add(it.url);
          seen.add(titleKey);
          out.push(it);
        }
      }
      if (!any || out.length >= cap) break;
    }
    return out;
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* The feed's week: "YYYY-MM-DD" of this week's Monday (local time) */
  function weekKey(date) {
    const d = date ? new Date(date) : new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* Remember what a batch showed so later batches skip it (oldest weeks age out) */
  function rememberSeen(items, week) {
    const seen = readJson(SEEN_KEY, {});
    items.forEach(it => { seen[it.url] = week; });
    let entries = Object.entries(seen);
    if (entries.length > MAX_SEEN) {
      entries.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      entries = entries.slice(-MAX_SEEN);
    }
    writeJson(SEEN_KEY, Object.fromEntries(entries));
  }

  /* "Not for me": hide this recipe from the current batch and every future one */
  function dismiss(url) {
    const hidden = readJson(HIDDEN_KEY, []);
    if (!hidden.includes(url)) {
      hidden.push(url);
      writeJson(HIDDEN_KEY, hidden.slice(-MAX_HIDDEN));
    }
    const c = get();
    if (c && c.items) {
      c.items = c.items.filter(it => it.url !== url);
      writeJson(CACHE_KEY, c);
    }
  }

  function get() {
    return readJson(CACHE_KEY, null);
  }

  /* A new batch is due every Monday (or when there's nothing cached) */
  function isStale() {
    const c = get();
    return !c || !(c.items || []).length || c.week !== weekKey();
  }

  /* opts: { prefs, skipUrls } — prefs is an array of PREFS ids (empty = Dinner mix;
   * `pref` singular is still accepted); skipUrls are recipes the caller already has.
   * onUpdate fires as each source lands so the grid fills in progressively
   * (reader-service sources ~30 s; API ones ~2 s). */
  async function refresh(opts, onUpdate) {
    let ids = (opts && opts.prefs) || (opts && opts.pref ? [opts.pref] : []);
    ids = (ids || []).filter(id => id && id !== "all");
    const plan = planFrom(ids);
    if (plan.mode === "mix") assignMix(plan);

    const seen = readJson(SEEN_KEY, {});
    const hidden = new Set(readJson(HIDDEN_KEY, []));
    const skip = new Set((opts && opts.skipUrls) || []);
    plan.keep = it => !seen[it.url] && !hidden.has(it.url) && !skip.has(it.url);

    const week = weekKey();
    const collected = [];
    const assemble = () => {
      const hiddenNow = new Set(readJson(HIDDEN_KEY, [])); // honor dismissals made mid-fetch
      return {
        week,
        fetchedAt: new Date().toISOString(),
        prefs: plan.ids,
        items: interleave(collected.map(list => list.filter(it => !hiddenNow.has(it.url))), MAX_ITEMS),
      };
    };
    await Promise.all(SOURCES.map(src =>
      fetchSourceMulti(src, plan).then(list => {
        if (list && list.length) {
          collected.push(list);
          if (onUpdate) onUpdate(assemble());
        }
      }, () => {}) // a dead source just sits this batch out
    ));
    if (!collected.length) {
      throw new Error(plan.mode === "mix" || plan.mode === "all"
        ? "no suggestion sources reachable — check your connection and try again"
        : "no new matches came back for those types — try different types, or check your connection");
    }
    const payload = assemble();
    writeJson(CACHE_KEY, payload);
    rememberSeen(payload.items, week);
    return payload;
  }

  return { get, isStale, refresh, dismiss, weekKey, PREFS, FOOD_TYPES, classifyTitle, foodTypeLabel };
})();
