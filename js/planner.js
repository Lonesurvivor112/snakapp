/* ============ SnakApp weekly planner ============
 * Greedy weighted-random pick for 7 day slots with variety constraints:
 *   - max N picks from the same category
 *   - at least M homemade (recipe-linked or flagged) snacks
 *   - optionally exclude last week's picks
 * Seeded RNG so "re-roll" is reproducible per seed.
 */
const Planner = (() => {

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  /* mulberry32 — small seeded PRNG */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isHomemade(snack) {
    return !!snack.recipeId || !!snack.homemade;
  }

  /* score = 0.6*rating + 0.3*freshness + 0.1*novelty (all normalized 0..1) */
  function score(snack, random) {
    const rating = (snack.rating || 3) / 5;

    let freshness = 1; // never planned → maximally "fresh"
    if (snack.lastPlannedAt) {
      const days = (Date.now() - new Date(snack.lastPlannedAt).getTime()) / 86400000;
      freshness = Math.min(days / 28, 1); // fully fresh again after ~4 weeks
    }

    const novelty = random();
    return 0.6 * rating + 0.3 * freshness + 0.1 * novelty;
  }

  function weightedPick(candidates, random) {
    const total = candidates.reduce((sum, c) => sum + c.score, 0);
    if (total <= 0) return candidates[Math.floor(random() * candidates.length)];
    let roll = random() * total;
    for (const c of candidates) {
      roll -= c.score;
      if (roll <= 0) return c;
    }
    return candidates[candidates.length - 1];
  }

  /**
   * @returns { seed, days: [{day, snackId}], notes: [] }
   */
  function generate(snacks, opts) {
    const { seed, maxPerCategory = 2, minHomemade = 2, excludeIds = [] } = opts;
    const random = rng(seed);
    const notes = [];

    let pool = snacks.filter(s => !excludeIds.includes(s.id));
    if (pool.length < 7 && snacks.length >= 7) {
      pool = snacks.slice();
      notes.push("Not enough snacks outside last week's picks — repeats allowed.");
    }
    if (pool.length === 0) return { seed, days: [], notes: ["No snacks available."] };

    const scored = pool.map(s => ({ snack: s, score: score(s, random) }));
    const homemadeAvailable = scored.filter(c => isHomemade(c.snack)).length;
    const homemadeTarget = Math.min(minHomemade, homemadeAvailable);
    if (homemadeTarget < minHomemade) {
      notes.push(`Only ${homemadeAvailable} homemade snack(s) in catalog — homemade minimum relaxed.`);
    }

    const picks = [];
    const categoryCount = {};
    const usedIds = new Set();

    for (let slot = 0; slot < 7; slot++) {
      const slotsLeft = 7 - slot;
      const homemadeSoFar = picks.filter(p => isHomemade(p)).length;
      const mustBeHomemade = (homemadeTarget - homemadeSoFar) >= slotsLeft;

      let candidates = scored.filter(c =>
        !usedIds.has(c.snack.id) &&
        (categoryCount[c.snack.category] || 0) < maxPerCategory &&
        (!mustBeHomemade || isHomemade(c.snack))
      );
      // Relax constraints in order if we've run dry: category cap, then uniqueness
      if (candidates.length === 0) {
        candidates = scored.filter(c => !usedIds.has(c.snack.id) && (!mustBeHomemade || isHomemade(c.snack)));
      }
      if (candidates.length === 0) {
        candidates = scored.filter(c => !usedIds.has(c.snack.id));
      }
      if (candidates.length === 0) {
        candidates = scored; // fewer than 7 snacks total → repeats within the week
        if (!notes.includes("Fewer than 7 snacks — some repeat within the week.")) {
          notes.push("Fewer than 7 snacks — some repeat within the week.");
        }
      }

      const pick = weightedPick(candidates, random).snack;
      picks.push(pick);
      usedIds.add(pick.id);
      categoryCount[pick.category] = (categoryCount[pick.category] || 0) + 1;
    }

    return {
      seed,
      days: DAYS.map((day, i) => ({ day, snackId: picks[i] ? picks[i].id : null })),
      notes,
    };
  }

  /* score = 0.5*rating + 0.3*freshness + 0.2*novelty — rating comes from the
   * linked catalog snack when the recipe has one, else a neutral 3 */
  function dinnerScore(recipe, ratingByRecipeId, random) {
    const rating = (ratingByRecipeId[recipe.id] || 3) / 5;
    let freshness = 1;
    if (recipe.lastPlannedAt) {
      const days = (Date.now() - new Date(recipe.lastPlannedAt).getTime()) / 86400000;
      freshness = Math.min(days / 28, 1);
    }
    return 0.5 * rating + 0.3 * freshness + 0.2 * random();
  }

  /**
   * Pick 7 dinner recipes: no repeats within the week (relaxed when the
   * collection is small), optionally excluding last week's dinners.
   * @returns { seed, days: [{day, recipeId}], notes: [] }
   */
  function generateDinners(recipes, snacks, opts) {
    const { seed, excludeIds = [] } = opts;
    const random = rng(seed);
    const notes = [];
    if (!recipes.length) return { seed, days: [], notes: ["No recipes yet — import or add some to plan dinners."] };

    const ratingByRecipeId = {};
    snacks.forEach(s => { if (s.recipeId && s.rating) ratingByRecipeId[s.recipeId] = s.rating; });

    let pool = recipes.filter(r => !excludeIds.includes(r.id));
    if (pool.length < 7 && recipes.length >= 7) {
      pool = recipes.slice();
      notes.push("Not enough recipes outside last week's dinners — repeats allowed.");
    }
    if (!pool.length) pool = recipes.slice();

    const scored = pool.map(r => ({ snack: r, score: dinnerScore(r, ratingByRecipeId, random) }));
    const picks = [];
    const used = new Set();
    for (let slot = 0; slot < 7; slot++) {
      let candidates = scored.filter(c => !used.has(c.snack.id));
      if (!candidates.length) {
        candidates = scored;
        const msg = "Fewer than 7 recipes — some dinners repeat within the week.";
        if (!notes.includes(msg)) notes.push(msg);
      }
      const pick = weightedPick(candidates, random).snack;
      picks.push(pick);
      used.add(pick.id);
    }

    return {
      seed,
      days: DAYS.map((day, i) => ({ day, recipeId: picks[i].id })),
      notes,
    };
  }

  return { generate, generateDinners, DAYS, isHomemade };
})();
