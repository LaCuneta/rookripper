import { _ as head, V as escape_html, G as attr, Q as ensure_array_like, J as attr_class } from "../../chunks/renderer.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    let syncing = false;
    function fmt(ts) {
      if (!ts) return "never";
      return new Date(ts).toLocaleString();
    }
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
    $$renderer2.push(`<!--]--> <section class="sync svelte-1uha8ag"><h2 class="svelte-1uha8ag">Sync</h2> <div class="sync-row svelte-1uha8ag"><div class="svelte-1uha8ag"><div class="svelte-1uha8ag">Puzzles: last synced ${escape_html(fmt(data.lastPuzzleSync))}</div> <div class="svelte-1uha8ag">Games: last synced ${escape_html(fmt(data.lastGameSync))}</div></div> <button${attr("disabled", syncing, true)} class="svelte-1uha8ag">${escape_html("Sync Now")}</button></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (data.recentSyncs.length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<table class="sync-log svelte-1uha8ag"><thead><tr><th class="svelte-1uha8ag">Type</th><th class="svelte-1uha8ag">Added</th><th class="svelte-1uha8ag">Status</th><th class="svelte-1uha8ag">When</th></tr></thead><tbody><!--[-->`);
      const each_array = ensure_array_like(data.recentSyncs);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let s = each_array[$$index];
        $$renderer2.push(`<tr><td class="svelte-1uha8ag">${escape_html(s.sync_type)}</td><td class="svelte-1uha8ag">${escape_html(s.items_added ?? "—")}</td><td${attr_class("svelte-1uha8ag", void 0, { "error": !!s.error })}>${escape_html(s.error ? "error" : "ok")}</td><td class="svelte-1uha8ag">${escape_html(s.completed_at ? fmt(s.completed_at) : "…")}</td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
export {
  _page as default
};
