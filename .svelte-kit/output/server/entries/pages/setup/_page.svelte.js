import { $ as head } from "../../../chunks/renderer.js";
import "@sveltejs/kit/internal";
import "../../../chunks/url.js";
import "../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../chunks/root.js";
import "../../../chunks/exports.js";
import "../../../chunks/client.js";
import "../../../chunks/db.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    head("g40i6i", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>Setup · RookRipper</title>`);
      });
    });
    $$renderer2.push(`<div class="setup svelte-g40i6i"><h1 class="svelte-g40i6i">Connect to Lichess</h1> `);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<p class="help svelte-g40i6i">RookRipper is a fully in-browser app — your puzzles, games, and review
      progress stay on this device. Connect your Lichess account to pull in your
      failed puzzles and analyzed games. We request only the <code class="svelte-g40i6i">puzzle:read</code> scope; your games are public.</p> `);
      {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`<button class="primary svelte-g40i6i">Connect with Lichess</button>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
