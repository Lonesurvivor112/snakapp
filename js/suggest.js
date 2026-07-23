/* ============ SnakApp recipe suggestions ============
 * Pulls fresh recipe ideas from favorite food blogs. Two source kinds:
 *  - "wp": the site's public WordPress JSON API (fetched directly — these
 *    sites send CORS headers, verified per-site before inclusion)
 *  - "jina": bot-protected sites with no open API; the r.jina.ai reader
 *    renders the page and we pull recipe links out of its markdown
 * A preference (chicken, vegetarian, dessert, …) is passed through to each
 * site's own search, so filtered batches come pre-matched from the source.
 * Results cache in this browser for a week; a manual refresh digs into
 * older posts (random offset) so you see different ideas each time. */
const Suggest = (() => {

  const CACHE_KEY = "snakapp-suggestions";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_ITEMS = 28;
  const PER_SOURCE = 8;

  const SOURCES = [
    { name: "RecipeTin Eats", type: "wp", api: "https://www.recipetineats.com/wp-json/wp/v2/posts" },
    { name: "Budget Bytes", type: "wp", api: "https://www.budgetbytes.com/wp-json/wp/v2/posts" },
    { name: "Damn Delicious", type: "jina", page: "https://damndelicious.net/", search: "https://damndelicious.net/?s=" },
    { name: "AllRecipes", type: "jina", page: "https://www.allrecipes.com/", search: "https://www.allrecipes.com/search?q=" },
    { name: "Pinch of Yum", type: "wp", api: "https://pinchofyum.com/wp-json/wp/v2/posts" },
    { name: "Natasha's Kitchen", type: "wp", api: "https://natashaskitchen.com/wp-json/wp/v2/posts" },
    { name: "Sally's Baking Addiction", type: "wp", api: "https://sallysbakingaddiction.com/wp-json/wp/v2/posts" },
  ];

  /* Preference chips shown on the Ideas tab. `term` feeds each site's own
   * search; `re` floats title matches to the top (site search also matches
   * post bodies); `noMeat` additionally screens titles for the vegetarian pick. */
  const PREFS = [
    { id: "all", label: "🍽️ All types", term: "" },
    { id: "chicken", label: "🍗 Chicken", term: "chicken", re: /\bchicken\b/i },
    { id: "beef", label: "🥩 Beef", term: "beef", re: /\b(beef|steaks?|burgers?|brisket)\b/i },
    { id: "pork", label: "🥓 Pork", term: "pork", re: /\b(pork|bacon|ham|sausage|ribs|carnitas|prosciutto|chorizo)\b/i },
    { id: "seafood", label: "🐟 Seafood", term: "seafood", re: /\b(shrimp|salmon|fish|tuna|cod|tilapia|scallops?|crab|lobster|seafood|prawns?)\b/i },
    { id: "pasta", label: "🍝 Pasta", term: "pasta", re: /\b(pasta|spaghetti|lasagna|penne|fettuccine|linguine|macaroni|noodles?|gnocchi|ravioli|tortellini|orzo)\b/i },
    { id: "vegetarian", label: "🥦 Vegetarian", term: "vegetarian", noMeat: true },
    { id: "soup", label: "🍲 Soups", term: "soup", re: /\b(soups?|stews?|chowder|bisque|minestrone)\b/i },
    { id: "dessert", label: "🍰 Desserts", term: "dessert", re: /\b(cakes?|cookies?|brownies?|pies?|muffins?|desserts?|cheesecake|pudding|ice cream|scones?|cobbler|tarts?|fudge|donuts?|cupcakes?|blondies)\b/i },
  ];

  const MEAT_RE = /\b(chicken|beef|steak|pork|bacon|ham|sausage|turkey|lamb|meatballs?|burgers?|brisket|ribs|pepperoni|chorizo|prosciutto|carnitas|bulgogi|salmon|shrimp|tuna|cod|tilapia|fish|crab|lobster|scallops?|anchov\w+)\b/i;

  /* Roundups, meal-plan posts, giveaways, and promo banners aren't single recipes — skip them */
  const SKIP_TITLE = /^\d+\+?\s|^image \d+$|\b(meal plans?|round[ -]?ups?|what i ate|giveaway|sweepstakes|gift card|chance to win|week of|gift guide|ideas)\b/i;

  const ta = document.createElement("textarea");
  function decodeEntities(s) { ta.innerHTML = s || ""; return ta.value; }

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
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

  async function fetchWp(src, offset, pref) {
    const query = (off) => src.api + "?per_page=" + PER_SOURCE + "&offset=" + off +
      (pref.term ? "&search=" + encodeURIComponent(pref.term) : "") +
      "&_embed=wp:featuredmedia&_fields=link,title,date,jetpack_featured_media_url,_links,_embedded";
    let posts = JSON.parse(await fetchWithTimeout(query(offset), 12000));
    if (!posts.length && offset > 0) { // dug past the end of a small result set
      posts = JSON.parse(await fetchWithTimeout(query(0), 12000));
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
    while ((m = re.exec(md)) && items.length < PER_SOURCE) {
      const title = decodeEntities((m[3] || m[1] || "").trim());
      if (!title || SKIP_TITLE.test(title) || items.some(it => it.url === m[4])) continue;
      items.push({ title, url: m[4], image: m[2], source: src.name });
    }
    return items;
  }

  function slugTitle(slug) {
    return slug.split("-").filter(Boolean)
      .map(w => /^[ivx]{2,4}$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }

  /* AllRecipes markdown: recipe links carry the article id, and thumbnail
   * URLs embed the same id — join them on it. Titles come from the slug. */
  function parseAllRecipes(md, src) {
    const links = new Map(); // article id → { url, slug }
    let m;
    const reNew = /https:\/\/www\.allrecipes\.com\/([a-z0-9-]+)-recipe-(\d+)/g;
    while ((m = reNew.exec(md))) links.set(m[2], { url: m[0], slug: m[1] });
    const reOld = /https:\/\/www\.allrecipes\.com\/recipe\/(\d+)\/([a-z0-9-]+)\//g;
    while ((m = reOld.exec(md))) links.set(m[1], { url: m[0], slug: m[2] });

    const images = new Map(); // article id → thumbnail
    const reImg = /https:\/\/www\.allrecipes\.com\/thmb\/\S*?\/(\d{6,})[_-][^/\s)]*?\.(?:jpe?g|png|webp)/g;
    while ((m = reImg.exec(md))) { if (!images.has(m[1])) images.set(m[1], m[0]); }

    const items = [];
    for (const [id, { url, slug }] of links) {
      if (items.length >= PER_SOURCE) break;
      const title = slugTitle(slug);
      if (!title || SKIP_TITLE.test(title)) continue;
      items.push({ title, url, image: images.get(id) || "", source: src.name });
    }
    return items;
  }

  async function fetchJina(src, pref) {
    const target = pref.term ? src.search + encodeURIComponent(pref.term) : src.page;
    const md = await fetchWithTimeout("https://r.jina.ai/" + encodeURIComponent(target), 30000);
    return src.page.includes("damndelicious") ? parseDamnDelicious(md, src) : parseAllRecipes(md, src);
  }

  /* Weekly auto-refresh and preference switches show each site's best matches;
   * a manual refresh digs into the archives at a random depth so the batch
   * actually changes (shallower when a search term narrows the result pool) */
  function fetchSource(src, manual, pref) {
    let job;
    if (src.type === "jina") {
      job = fetchJina(src, pref);
    } else {
      const depth = pref.term ? 3 : 12;
      const offset = manual ? PER_SOURCE * (1 + Math.floor(Math.random() * depth)) : 0;
      job = fetchWp(src, offset, pref);
    }
    return job.then(list => {
      if (pref.noMeat) list = list.filter(it => !MEAT_RE.test(it.title));
      if (pref.re) { // title matches outrank body-text matches from the site's search
        list = list.slice().sort((a, b) => (pref.re.test(b.title) ? 1 : 0) - (pref.re.test(a.title) ? 1 : 0));
      }
      return list;
    });
  }

  /* Round-robin across sources so no single site dominates the top of the grid */
  function interleave(lists, cap) {
    const out = [];
    const seen = new Set();
    for (let i = 0; ; i++) {
      let any = false;
      for (const list of lists) {
        if (i >= list.length) continue;
        any = true;
        const it = list[i];
        if (!seen.has(it.url) && out.length < cap) { seen.add(it.url); out.push(it); }
      }
      if (!any || out.length >= cap) break;
    }
    return out;
  }

  function get() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); }
    catch (e) { return null; }
  }

  function isStale() {
    const c = get();
    return !c || !c.fetchedAt || !(c.items || []).length ||
      Date.now() - new Date(c.fetchedAt).getTime() > WEEK_MS;
  }

  /* opts: { manual, pref } — pref is a PREFS id. onUpdate fires as each source
   * lands so the grid fills in progressively (the reader-service sources can
   * take ~30 s; the API ones land in ~2 s) */
  async function refresh(opts, onUpdate) {
    const manual = !!(opts && opts.manual);
    const pref = PREFS.find(p => p.id === ((opts && opts.pref) || "all")) || PREFS[0];
    const collected = [];
    const assemble = () => ({
      fetchedAt: new Date().toISOString(),
      pref: pref.id,
      items: interleave(collected, MAX_ITEMS),
    });
    await Promise.all(SOURCES.map(src =>
      fetchSource(src, manual, pref).then(list => {
        if (list.length) {
          collected.push(list);
          if (onUpdate) onUpdate(assemble());
        }
      }, () => {}) // a dead source just sits this batch out
    ));
    if (!collected.length) {
      throw new Error(pref.term
        ? "no matches came back for that type — try another type, or check your connection"
        : "no suggestion sources reachable — check your connection and try again");
    }
    const payload = assemble();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (e) {}
    return payload;
  }

  return { get, isStale, refresh, PREFS };
})();
