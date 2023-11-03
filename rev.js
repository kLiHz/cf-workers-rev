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
  } else if (q === 'favicon.ico') {
    return fetch('https://workers.cloudflare.com/favicon.ico');
  } else {
    let val = await MAPPER.get(q);
    if (val === null) {  // q not found
      return new Response("None.", { status: 404 });
    } else {
      if (q.startsWith('html:')) {
        return new Response(val, {
          headers: {
            "content-type": "text/html;charset=utf-8"
          }
        });
      } else if (isValidHttpUrl(val)) {
        const url = new URL(val);
        if (url.hostname === 'api.github.com') {
          const headers = new Headers();
          headers.append('Authorization', `Bearer ${url.password}`);
          return fetch(url, {headers});
        }
        return fetch(val);
      } else {
        return new Response("Error.", { status: 500 });
      }
    }
  }
}
