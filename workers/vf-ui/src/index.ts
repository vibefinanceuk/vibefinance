/**
 * vf-ui — the shared interface — decision 0099.
 *
 * **One deployment, every customer.** Decision 0083 section 3 settled
 * this: with authentication in the control plane, a per-instance UI
 * would mean a person had to know their region before they could sign
 * in, which is backwards.
 *
 * **Its own Worker, not assets bound to `vf-licence`**, on deployment
 * frequency: binding them means every UI change redeploys the component
 * that mints licence tokens for the entire fleet, and UI changes are far
 * more frequent than control-plane changes.
 *
 * The Worker itself does almost nothing. Static files are served by
 * Cloudflare before it runs; this exists to inject configuration that
 * must not be baked into the JavaScript.
 */

export interface Env {
  ASSETS: Fetcher;
  /**
   * Where `vf-licence` lives.
   *
   * **Configuration, not a constant.** If the API address were compiled
   * into the JavaScript, moving to a custom domain would mean rebuilding
   * the UI. As a var it is a deployment setting, and both origins can be
   * served during a transition.
   */
  LICENCE_API?: string;
}

/**
 * Configuration, as a script the page loads.
 *
 * A `<script src="/config.js">` rather than JSON fetched at startup, so
 * the value is present before any code needs it — the same reasoning as
 * serving branding as CSS (decision 0096): a thing needed for the first
 * paint should not require a round trip after it.
 *
 * `JSON.stringify` rather than string concatenation. The value comes
 * from deployment configuration rather than a user, but a URL
 * interpolated raw into JavaScript is the shape of a mistake worth not
 * making at all.
 */
function configScript(env: Env): Response {
  const config = {
    licenceApi: env.LICENCE_API ?? "",
  };

  return new Response(`window.VF_CONFIG = ${JSON.stringify(config)};\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Not cached. Configuration changing is exactly the case where a
      // stale copy sends a browser to the wrong API, and the file is
      // forty bytes.
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/config.js") {
      return configScript(env);
    }

    // Everything else is a file. Cloudflare has already tried to match
    // one before this Worker ran, so reaching here means nothing did —
    // and a single-page interface answers an unknown path with its own
    // entry point rather than a 404, because the path may be a route
    // the page understands.
    const asset = await env.ASSETS.fetch(new URL("/index.html", request.url));
    return new Response(asset.body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
