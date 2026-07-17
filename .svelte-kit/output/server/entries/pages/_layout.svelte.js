import { J as attr_class, G as attr, Q as derived } from "../../chunks/renderer.js";
import { g as goto } from "../../chunks/client.js";
import { p as page } from "../../chunks/index.js";
import "../../chunks/db.js";
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, children } = $$props;
    let menuOpen = false;
    let reviewSource = derived(() => page.url.pathname === "/review" ? page.url.searchParams.get("source") ?? "" : "");
    function onSourceChange(e) {
      e.currentTarget.value;
      menuOpen = false;
      goto();
    }
    $$renderer2.push(`<div${attr_class("app svelte-12qhfyh", void 0, { "wide": page.url.pathname === "/review" })}><header${attr_class("svelte-12qhfyh", void 0, { "open": menuOpen })}><button class="handle svelte-12qhfyh"${attr("aria-label", menuOpen ? "Hide menu" : "Show menu")}${attr("aria-expanded", menuOpen)}></button> <div class="bar svelte-12qhfyh"><a href="/" class="logo svelte-12qhfyh">RookRipper</a> `);
    if (data.configured) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<nav class="svelte-12qhfyh"><div class="review-nav svelte-12qhfyh"><a href="/review">Review</a> `);
      $$renderer2.select(
        { value: reviewSource(), onchange: onSourceChange, class: "" },
        ($$renderer3) => {
          $$renderer3.option({ value: "" }, ($$renderer4) => {
            $$renderer4.push(`All`);
          });
          $$renderer3.option({ value: "puzzle" }, ($$renderer4) => {
            $$renderer4.push(`Puzzles`);
          });
          $$renderer3.option({ value: "game" }, ($$renderer4) => {
            $$renderer4.push(`Games`);
          });
        },
        "svelte-12qhfyh"
      );
      $$renderer2.push(`</div> <a href="/">Dashboard</a> <a href="/settings">Settings</a></nav>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></header> <main>`);
    children($$renderer2);
    $$renderer2.push(`<!----></main></div>`);
  });
}
export {
  _layout as default
};
