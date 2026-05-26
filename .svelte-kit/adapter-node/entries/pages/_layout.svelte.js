import "clsx";
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, children } = $$props;
    $$renderer2.push(`<div class="app svelte-12qhfyh"><header class="svelte-12qhfyh"><a href="/" class="logo svelte-12qhfyh">RookRipper</a> `);
    if (data.configured) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<nav class="svelte-12qhfyh"><a href="/review">Review</a> <a href="/">Dashboard</a></nav>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></header> <main>`);
    children($$renderer2);
    $$renderer2.push(`<!----></main></div>`);
  });
}
export {
  _layout as default
};
