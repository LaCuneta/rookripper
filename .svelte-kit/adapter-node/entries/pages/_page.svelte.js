import { $ as head, X as escape_html, G as attr, V as ensure_array_like, J as attr_class, K as attr_style, ab as stringify, Q as derived } from "../../chunks/renderer.js";
import "../../chunks/db.js";
import "../../chunks/srs.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    let syncing = false;
    let injecting = false;
    let importing = false;
    function fmt(ts) {
      if (!ts) return "never";
      return new Date(ts).toLocaleString();
    }
    const STATES = ["new", "learning", "review", "relearning"];
    const bd = derived(() => {
      const r = {
        puzzle: { new: 0, learning: 0, review: 0, relearning: 0 },
        game: { new: 0, learning: 0, review: 0, relearning: 0 }
      };
      for (const row of data.cardBreakdown) {
        const src = row.source;
        const st = row.state;
        if (STATES.includes(st)) r[src][st] = row.n;
      }
      return r;
    });
    function rowTotal(st) {
      return bd().puzzle[st] + bd().game[st];
    }
    const puzzleTotal = derived(() => STATES.reduce((s, st) => s + bd().puzzle[st], 0));
    const gameTotal = derived(() => STATES.reduce((s, st) => s + bd().game[st], 0));
    const grandTotal = derived(() => puzzleTotal() + gameTotal());
    function dateKey(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    function fmtDay(d, i) {
      if (i === 0) return "Today";
      if (i === 1) return "Tomorrow";
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }
    const forecastDays = derived(() => {
      const fmap = new Map(data.dailyForecast.map((d) => [d.day, d.n]));
      const t = /* @__PURE__ */ new Date();
      t.setHours(0, 0, 0, 0);
      return Array.from({ length: 30 }, (_, i) => {
        const d = new Date(t);
        d.setDate(d.getDate() + i);
        const key = dateKey(d);
        return { label: fmtDay(d, i), n: fmap.get(key) ?? 0 };
      });
    });
    const maxBar = derived(() => Math.max(...forecastDays().map((d) => d.n), 1));
    const scheduledIn30 = derived(() => forecastDays().reduce((s, d) => s + d.n, 0));
    const avgPerDay = derived(() => grandTotal() > 0 ? (scheduledIn30() / 30).toFixed(1) : "0");
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>RookRipper</title>`);
      });
    });
    $$renderer2.push(`<section class="stats svelte-1uha8ag"><div class="stat svelte-1uha8ag"><span class="n svelte-1uha8ag">${escape_html(data.stats.due)}</span> <span class="label svelte-1uha8ag">due now</span></div> <div class="stat svelte-1uha8ag"><span class="n svelte-1uha8ag">${escape_html(data.stats.new)}</span> <span class="label svelte-1uha8ag">new</span></div> <div class="stat svelte-1uha8ag"><span class="n svelte-1uha8ag">${escape_html(data.stats.learning)}</span> <span class="label svelte-1uha8ag">learning</span></div></section> `);
    if (data.stats.due > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<a href="/review" class="review-btn svelte-1uha8ag">Start Review (${escape_html(data.stats.due)})</a>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<p class="empty svelte-1uha8ag">No cards due. Check back later or sync for new failures.</p>`);
    }
    $$renderer2.push(`<!--]--> `);
    if (data.dailyLimit > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="new-cards-row svelte-1uha8ag"><span class="new-cards-label svelte-1uha8ag">New today: ${escape_html(data.newToday)} / ${escape_html(data.dailyLimit + data.extraToday)}</span> `);
      if (data.stats.new > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<button class="inject-btn svelte-1uha8ag"${attr("disabled", injecting, true)}>${escape_html("+ 20 more new")}</button>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (grandTotal() > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<section class="card-stats svelte-1uha8ag"><h2 class="svelte-1uha8ag">Card breakdown</h2> <table class="breakdown svelte-1uha8ag"><thead><tr><th class="svelte-1uha8ag"></th><th class="svelte-1uha8ag">Puzzles</th><th class="svelte-1uha8ag">Games</th><th class="svelte-1uha8ag">Total</th></tr></thead><tbody><!--[-->`);
      const each_array = ensure_array_like(STATES);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let st = each_array[$$index];
        $$renderer2.push(`<tr${attr_class("svelte-1uha8ag", void 0, { "dim": rowTotal(st) === 0 })}><td class="state-label svelte-1uha8ag">${escape_html(st)}</td><td class="svelte-1uha8ag">${escape_html(bd().puzzle[st] || "—")}</td><td class="svelte-1uha8ag">${escape_html(bd().game[st] || "—")}</td><td class="total-col svelte-1uha8ag">${escape_html(rowTotal(st) || "—")}</td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody><tfoot class="svelte-1uha8ag"><tr><td class="state-label svelte-1uha8ag">total</td><td class="svelte-1uha8ag">${escape_html(puzzleTotal())}</td><td class="svelte-1uha8ag">${escape_html(gameTotal())}</td><td class="total-col svelte-1uha8ag">${escape_html(grandTotal())}</td></tr></tfoot></table> <h2 class="svelte-1uha8ag">Scheduled reviews — next 30 days</h2> <p class="forecast-note svelte-1uha8ag">${escape_html(scheduledIn30())} reviews scheduled · avg ${escape_html(avgPerDay())}/day `);
      if (bd().puzzle.new + bd().game.new > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`· ${escape_html(bd().puzzle.new + bd().game.new)} unstarted cards not shown`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></p> <div class="forecast svelte-1uha8ag"><!--[-->`);
      const each_array_1 = ensure_array_like(forecastDays());
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let day = each_array_1[$$index_1];
        $$renderer2.push(`<div class="bar-row svelte-1uha8ag"><span class="bar-label svelte-1uha8ag">${escape_html(day.label)}</span> <span class="bar-track svelte-1uha8ag"><span class="bar-fill svelte-1uha8ag"${attr_style(`width: ${stringify(day.n / maxBar() * 100)}%`)}></span></span> <span class="bar-count svelte-1uha8ag">${escape_html(day.n || "")}</span></div>`);
      }
      $$renderer2.push(`<!--]--></div></section>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <section class="sync svelte-1uha8ag"><h2 class="svelte-1uha8ag">Sync</h2> <div class="sync-row svelte-1uha8ag"><div class="svelte-1uha8ag"><div class="svelte-1uha8ag">Puzzles: last synced ${escape_html(fmt(data.lastPuzzleSync))}</div> <div class="svelte-1uha8ag">Games: last synced ${escape_html(fmt(data.lastGameSync))}</div></div> <button${attr("disabled", syncing, true)} class="svelte-1uha8ag">${escape_html("Sync Now")}</button></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (data.recentSyncs.length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<table class="sync-log svelte-1uha8ag"><thead><tr><th class="svelte-1uha8ag">Type</th><th class="svelte-1uha8ag">Added</th><th class="svelte-1uha8ag">When</th><th class="svelte-1uha8ag">Status</th></tr></thead><tbody><!--[-->`);
      const each_array_2 = ensure_array_like(data.recentSyncs);
      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
        let s = each_array_2[$$index_2];
        $$renderer2.push(`<tr><td class="svelte-1uha8ag">${escape_html(s.sync_type)}</td><td class="svelte-1uha8ag">${escape_html(s.items_added ?? "—")}</td><td class="svelte-1uha8ag">${escape_html(s.completed_at ? fmt(s.completed_at) : "…")}</td><td${attr("title", s.error ?? void 0)}${attr_class("svelte-1uha8ag", void 0, { "error": !!s.error })}>${escape_html(s.error ? s.error.slice(0, 80) + (s.error.length > 80 ? "…" : "") : "ok")}</td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section> <section class="backup svelte-1uha8ag"><h2 class="svelte-1uha8ag">Data &amp; backup</h2> <p class="backup-note svelte-1uha8ag">All your review progress lives in this browser only. Export regularly —
    clearing browsing data or storage eviction will wipe it.</p> <div class="backup-row svelte-1uha8ag"><button class="svelte-1uha8ag">Export backup</button> <button${attr("disabled", importing, true)} class="svelte-1uha8ag">${escape_html("Import backup")}</button> <input type="file" accept="application/json,.json" hidden=""/></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
export {
  _page as default
};
