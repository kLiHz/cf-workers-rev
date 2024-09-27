import 'https://deno.land/x/worker_types@v1.0.1/cloudflare-worker-types.ts';

type GitHubUser = {
  login: string,
  id: number,
  avatar_url: string,
  url: string,
  html_url: string,
}

type GitHubReleaseAsset = {
  url: string,
  id: number,
  name: string,
  label: string,
  uploader: GitHubUser,
  content_type: string,
  state: string,
  size: number,
  download_count: number,
  created_at: string,
  updated_at: string,
  browser_download_url: string,
}

type GitHubRelease = {
  url: string,
  assets_url: string,
  upload_url: string,
  html_url: string,
  id: number,
  author: GitHubUser,
  node_id: string,
  tag_name: string,
  target_commitish: string,
  name: string,
  draft: boolean,
  prerelease: boolean,
  created_at: string,
  published_at: string,
  assets: GitHubReleaseAsset[],
  tarball_url: string,
  zipball_url: string,
  body: string,
  reactions: {
    url: string,
    total_count: string,
    '+1': number,
    '-1': number,
    'laugh': number,
    'hooray': number,
    'confused': number,
    'heart': number,
    'rocket': number,
    'eyes': number,
  },
}

function isValidHttpUrl(s: string) {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_err) {
    return false;
  }
}

function ghHeaders(authHeader: string | undefined | null, token: string | undefined | null) {
  return {
    // Merge "Authorization" if applicable
    ...authHeader ? { 'Authorization': authHeader }
      : token ? { 'Authorization': `Bearer ${token}` }
        : {},
    'User-Agent': 'curl/8.10.1',
  }
}

async function downloadGitHubAssetFromApi(asset: GitHubReleaseAsset, headers: { [k: string]: string }) {
  // Get binary response of this release asset
  const b = await fetch(asset.url, {
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

export default {
  async fetch(request: Request, { KV }: { KV: KVNamespace }): Promise<Response> {
    // Reading request URL 
    const url = new URL(request.url);
    if (url.pathname == '/') {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rev Fetch</title>
</head>
<body>
  <p>This is a key-based reverse proxy.</p>
  <p>It also supports '/gh/latest/{owner}/{repo}/{matcher}' to get a latest release asset with its name containing the {matcher}.</p>
  <p>If {matcher} is omitted/missing, returning fetched release data.</p>
  <p>Query with "Authorization" header or pass the token via  \`token\` or \`auth\` query parameter, if applicable.</p>
  <p>You can also store the token (with \`token:\` prefix) in KV, and pass the key via \`key\` query parameter.</p>
  <p>Add a \`info\` query parameter to get the asset info instead</p>
</body>
</html>`, {
        headers: {
          'Content-Type': 'text/html',
        }
      });
    }
    if (url.pathname == '/index.html') {
      return Response.redirect(`${url.origin}/`);
    }
    if (url.pathname === '/favicon.ico') {
      return fetch('https://workers.cloudflare.com/favicon.ico');
    }
    const prefix = '/gh/latest/';
    const authHeader = request.headers.get('Authorization');
    if (url.pathname.startsWith(prefix)) {
      const key = url.searchParams.get('key');  // The `key` is used to refer the token stored in KV
      const kvToken = await KV.get(`token:${key}`);
      // const kv = await Deno.openKv();
      // const kvToken = (key ? (await kv.get(['token', key])).value as string : null);
      const headers = ghHeaders(
        authHeader,
        kvToken || url.searchParams.get('token') || url.searchParams.get('auth'),
      );
      const [owner, repo, matcher] = url.pathname.slice(prefix.length).split('/');
      // const releaseKvKey = ['releases', owner, repo, 'latest'];
      // const v: Deno.KvEntryMaybe<GitHubRelease> = await kv.get(releaseKvKey);
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
      // response might not be ok, e.g. lacking authorization, reaching rate limits...
      if (!r.ok) {
        return r;
      }
      // if "matcher" not specified, consider querying "latest" release
      if (!matcher) {
        // currently returning the response directly
        return r;
      }
      const d: GitHubRelease = await r.json();
      const l = d.assets.filter(({ name }) => name.includes(matcher));
      // If returning release asset info is wanted
      if (url.searchParams.has('info')) {
        return new Response(
          JSON.stringify(l,
            (k, v) => {
              // Omitting `uploader` property
              if (k == 'uploader') {
                return undefined;
              }
              return v;
            }, 2
          ), {
          headers: {
            'Content-Type': 'application/json',
          }
        }
        );
      }
      // Only use the first matched asset
      const asset = l[0];
      if (!asset) {
        return new Response("No matching asset.", { status: 404 });
      }
      if (!headers.Authorization) {
        // If code reaches here and there's no authorization,
        // then it means that there's no need for it, i.e. it's a public repository, or there's no rate limits, etc.
        return fetch(asset.browser_download_url);
      }
      // or else we need authorization and need to download via "api.github.com" url
      return downloadGitHubAssetFromApi(asset, headers);
    }
    const key = url.pathname.slice(1);
    // Not allow querying token entries
    if (key.startsWith('token:')) {
      return new Response('Querying token is not allowed.', { status: 400 });
    }
    // Fetching entry value
    const val = await KV.get(key);
    if (!val) {
      return new Response("No resource found with this key.", { status: 404 });
    }
    // Returning directly stored value (html)
    if (key.startsWith('html:')) {
      return new Response(val, {
        headers: {
          "content-type": "text/html;charset=utf-8",
        },
      });
    }
    // Returning directly stored value (css)
    if (key.startsWith('css:')) {
      return new Response(val, {
        headers: {
          "content-type": "text/css;charset=utf-8",
        },
      });
    }
    if (isValidHttpUrl(val)) {
      const url = new URL(val);
      switch (url.hostname) {
        // Specially consider api.github.com
        case 'api.github.com': {
          // If token is stored as part of api.github.com URL
          const headers = ghHeaders(authHeader, url.password);
          // If 'assets/' apeears in URL then consider asset downloading
          if (url.pathname.includes('assets/')) {
            // Get asset information
            const r = await fetch(url, { headers })
            // Directly fetching this URL gets its info
            const asset: GitHubReleaseAsset = await r.json();
            // If fetch with "Accept: appliaction/octet-stream" then we get the asset contents
            return downloadGitHubAssetFromApi(asset, headers);
          }
          return fetch(url, { headers });
        }
        default:
          return fetch(url);
      }
    }
    return new Response(`'${val}' is not a valid URL.`, { status: 500 });
  }
}
