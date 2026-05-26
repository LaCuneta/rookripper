import { _ as head, V as escape_html, G as attr } from "../../../chunks/renderer.js";
import "@sveltejs/kit/internal";
import "../../../chunks/exports.js";
import "../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../chunks/root.js";
import "../../../chunks/state.svelte.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    let saving = false;
    head("g40i6i", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>Setup · RookRipper</title>`);
      });
    });
    $$renderer2.push(`<div class="setup svelte-g40i6i"><h1 class="svelte-g40i6i">Setup</h1> `);
    if (data.hasToken && data.username) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="connected svelte-g40i6i">Connected as <strong>${escape_html(data.username)}</strong></p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <p class="help svelte-g40i6i">Generate a personal access token at <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer" class="svelte-g40i6i">lichess.org/account/oauth/token</a> with the <code class="svelte-g40i6i">puzzle:read</code> scope. Your games are public and need no extra scope.</p> <form method="POST" action="?/save" class="svelte-g40i6i"><label for="token" class="svelte-g40i6i">Personal Access Token</label> <input id="token" name="token" type="password" placeholder="lip_xxxxxxxxxxxxxxxxxxxx" autocomplete="off" required="" class="svelte-g40i6i"/> `);
    if (form?.error) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="error svelte-g40i6i">${escape_html(form.error)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button type="submit"${attr("disabled", saving, true)} class="svelte-g40i6i">${escape_html(data.hasToken ? "Update Token" : "Connect")}</button></form></div>`);
  });
}
export {
  _page as default
};
