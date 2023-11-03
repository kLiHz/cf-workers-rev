export default {
  async fetch(request, env) {
    return await handleRequest(request, env).catch(
      (err) => new Response(err.stack, { status: 500 })
    )
  }
}

function isValidHttpUrl(s) {
  let url;
  try {
    url = new URL(s);
  } catch (err) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

async function handleRequest(request, { MAPPER }) {
  const { pathname } = new URL(request.url);
  
  const q = pathname.substring(1);

  if (q === '') { // home page
    return new Response("Nope.", { status: 400 });
  }
  if (q === 'favicon.ico') {
    return fetch('https://workers.cloudflare.com/favicon.ico');
  }
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
  if (isValidHttpUrl(val)) {
    const url = new URL(val);
    const headers = new Headers();
    switch (url.hostname) {
      case 'api.github.com':
        headers.append('Authorization', `Bearer ${url.password}`);
        headers.append('User-Agent', 'curl/8.0.1');
        // Handle asset downloading
        if (url.pathname.indexOf('assets/') !== -1) {
          // Get asset information
          const assetInfo = await fetch(url, {headers}).then(r => r.json());
          // Get binary response of this release asset
          headers.append('Accept', 'application/octet-stream');
          return fetch(url, {headers}).then(response => {
            response.headers.set('Content-Type', assetInfo['content_type']);
            response.headers.append('Content-Disposition', 'attachment');
            response.headers.append('Content-Disposition', `filename="${assetInfo['name']}"`);
            return response;
          });
        }
        return fetch(url, {headers});
      default:
        return fetch(url, {headers});
    }
  }
  return new Response("Error.", { status: 500 });
}
