function isValidHttpUrl(s) {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_err) {
    return false;
  }
}

export default {
  /**
   * Default fetch event handler
   * @param {Request} request
   * @param {{MAPPER: KVNameSpace}} env
   * @param ctx 
   * @returns {Promise<Response>}
   */
  async fetch(request, { MAPPER }) {
    try {
      const { pathname } = new URL(request.url);

      if (pathname === '/') { // home page
        return new Response("Nothing here.", { status: 400 });
      }
      if (pathname === '/favicon.ico') {
        return fetch('https://workers.cloudflare.com/favicon.ico');
      }

      const q = pathname.slice(1);
      const val = await MAPPER.get(q);
      if (val === null) {  // q not found
        return new Response("None.", { status: 404 });
      }
      if (q.startsWith('html:')) {
        return new Response(val, {
          headers: {
            "content-type": "text/html;charset=utf-8",
          },
        });
      }
      if (q.startsWith('css:')) {
        return new Response(val, {
          headers: {
            "content-type": "text/css;charset=utf-8",
          },
        });
      }
      if (isValidHttpUrl(val)) {
        const url = new URL(val);
        switch (url.hostname) {
          case 'api.github.com': {
            const headers = {
              'Authorization': `Bearer ${url.password}`,
              'User-Agent': 'curl/8.0.1',
            }
            // Handle asset downloading
            if (url.pathname.indexOf('assets/') !== -1) {
              // Get asset information
              const r = await fetch(url, { headers })
              const asset = await r.json();
              // Get binary response of this release asset
              const b = await fetch(url, {
                headers: {
                  'Accept': 'application/octet-stream',
                  ...headers,
                }
              });
              // Copy original response headers
              const h = new Headers(b.headers);
              // Override 'Content-Type'
              h.set('Content-Type', asset['content_type']);
              // Ensure 'Content-Disposition'
              h.set('Content-Disposition', `attachment; filename=${asset['name']}`);
              return new Response(b.body, {
                status: b.status,
                statusText: b.statusText,
                headers: h,
              });
            }
            return fetch(url, { headers });
          }
          default:
            return fetch(url);
        }
      }
      return new Response("Error.", { status: 500 });
    } catch (err) {
      return new Response(err.stack, { status: 500 })
    }
  }
}
