/* ============ SnakApp recipe suggestions ============
 * Pulls fresh recipe ideas from favorite food blogs. Two source kinds:
 *  - "wp": the site's public WordPress JSON API (fetched directly — these
 *    sites send CORS headers, verified per-site before inclusion)
 *  - "jina": bot-protected sites with no open API; the r.jina.ai reader
 *    renders the homepage and we pull recipe links out of its markdown
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
    { name: "Damn Delicious", type: "jina", page: "https://damndelicious.net/" },
    { name: "AllRecipes", type: "jina", page: "https://www.allrecipes.com/" },
    { name: "Pinch of Yum", type: "wp", api: "https://pinchofyum.com/wp-json/wp/v2/posts" },
    { name: "Natasha's Kitchen", type: "wp", api: "https://natashaskitchen.com/wp-json/wp/v2/posts" },
    { name: "Sally's Baking Addiction", type: "wp", api: "https://sallysbakingaddiction.com/wp-json/wp/v2/posts" },
  ];

  /* Roundups, meal-plan posts, giveaways, and promo banners aren't single recipes — skip them */
  const SKIP_TITLE = /^\d+\s|^image \d+$|\b(meal plan|round ?ups?|what i ate|giveaway|sweepstakes|gift card|chance to win|week of|gift guide)\b/i;

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

  async function fetchWp(src, offset) {
    const url = src.api + "?per_page=" + PER_SOURCE + "&offset=" + offset +
      "&_embed=wp:featuredmedia&_fields=link,title,date,jetpack_featured_media_url,_links,_embedded";
    const posts = JSON.parse(await fetchWithTimeout(url, 12000));
    return posts.map(p => ({
      title: decodeEntities((p.title && p.title.rendered) || "").trim(),
      url: p.link,
      image: wpImage(p),
      source: src.name,
    })).filter(it => it.title && it.url && !SKIP_TITLE.test(it.title));
  }

  /* ---- Reader-rendered homepage sources ---- */

  /* Damn Delicious markdown: [![Image N: Title](imgurl)](https://damndelicious.net/YYYY/MM/DD/slug/) */
  function parseDamnDelicious(md, src) {
    const items = [];
    const re = /\[!\[(?:Image \d+:\s*)?([^\]]+)\]\((https:\/\/damndelicious\.net\/wp-content\/[^)\s]+)\)\]\((https:\/\/damndelicious\.net\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/)\)/g;
    let m;
    while ((m = re.exec(md)) && items.length < PER_SOURCE) {
      const title = decodeEntities(m[1]).trim();
      if (!title || SKIP_TITLE.test(title) || items.some(it => it.url === m[3])) continue;
      items.push({ title, url: m[3], image: m[2], source: src.name });
    }
    return items;
  }

  function slugTitle(slug) {
    return slug.split("-").filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
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

  async function fetchJina(src) {
    const md = await fetchWithTimeout("https://r.jina.ai/" + src.page, 30000);
    return src.page.includes("damndelicious") ? parseDamnDelicious(md, src) : parseAllRecipes(md, src);
  }

  /* Weekly auto-refresh shows each site's latest; a manual refresh digs into
   * the archives at a random depth so the batch actually changes */
  function fetchSource(src, manual) {
    if (src.type === "jina") return fetchJina(src);
    const offset = manual ? PER_SOURCE * (1 + Math.floor(Math.random() * 12)) : 0;
    return fetchWp(src, offset);
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

  /* onUpdate fires as each source lands so the grid fills in progressively
   * (the reader-service sources can take ~30 s; the API ones land in ~2 s) */
  async function refresh(manual, onUpdate) {
    const collected = [];
    const assemble = () => ({ fetchedAt: new Date().toISOString(), items: interleave(collected, MAX_ITEMS) });
    await Promise.all(SOURCES.map(src =>
      fetchSource(src, manual).then(list => {
        if (list.length) {
          collected.push(list);
          if (onUpdate) onUpdate(assemble());
        }
      }, () => {}) // a dead source just sits this batch out
    ));
    if (!collected.length) throw new Error("no suggestion sources reachable — check your connection and try again");
    const payload = assemble();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (e) {}
    return payload;
  }

  return { get, isStale, refresh };
})();
