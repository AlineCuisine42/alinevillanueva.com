const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_JSON_BYTES = 15 * 1024 * 1024;
const PUBLIC_R2_BASE = 'https://pub-4836c3859b604ddf81b2d5d30b12c835.r2.dev';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function requireAccess(request) {
  // Cloudflare Access injects this assertion after successful authentication.
  // workers.dev and preview hostnames are disabled separately.
  return Boolean(request.headers.get('cf-access-jwt-assertion'));
}

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanWork(work) {
  const status = ['available', 'sold', 'reserved', 'nfs'].includes(work?.status) ? work.status : 'available';
  return {
    id: Number(work?.id) || 0,
    title: cleanText(work?.title, 240),
    medium: cleanText(work?.medium, 240),
    year: Number(work?.year) || '',
    dims: cleanText(work?.dims, 100),
    status,
    price: Math.max(0, Number(work?.price) || 0),
    imageUrl: cleanText(work?.imageUrl || work?.image, 2000),
  };
}

function cleanSettings(settings) {
  const clean = {};
  const owns = key => Object.prototype.hasOwnProperty.call(settings || {}, key);
  const textFields = {
    heroEyebrow: 240,
    heroNameText: 500,
    heroBio: 1000,
    statementText: 12000,
    educationText: 12000,
    exhibitionsText: 12000,
    contactEmail: 320,
    acquireText: 4000,
    cvUrl: 2000,
    priceText: 240,
    heroImageUrl: 2000,
    heroWorkTitle: 240,
  };
  for (const [key, max] of Object.entries(textFields)) {
    if (owns(key)) clean[key] = cleanText(settings[key], max);
  }
  if (owns('heroWorkId')) clean.heroWorkId = Number(settings.heroWorkId) || null;
  if (owns('cvButtonVisible')) clean.cvButtonVisible = settings.cvButtonVisible !== false;
  if (owns('pricesVisible')) clean.pricesVisible = settings.pricesVisible !== false;
  if (settings?.visibility && typeof settings.visibility === 'object') {
    clean.visibility = {};
    for (const key of ['hero', 'works', 'statement', 'cv', 'acquire']) {
      if (Object.prototype.hasOwnProperty.call(settings.visibility, key)) clean.visibility[key] = settings.visibility[key] !== false;
    }
  }
  clean.updatedAt = Number(settings?.updatedAt) || Date.now();
  return clean;
}

function parseDataUrl(dataUrl, allowedTypes, maxBytes) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match || !allowedTypes.includes(match[1])) throw new Error('Unsupported file type');
  const binary = Uint8Array.from(atob(match[2].replace(/\s/g, '')), char => char.charCodeAt(0));
  if (!binary.length || binary.length > maxBytes) throw new Error('File is empty or too large');
  return { type: match[1], binary };
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length')) || 0;
  if (length > MAX_JSON_BYTES) throw new Error('Request is too large');
  return request.json();
}

async function publish(request, env) {
  if (!requireAccess(request)) return json({ success: false, error: 'Access authentication required' }, 403);
  const incoming = await readJson(request);
  let current = (await env.PUBLIC_CONTENT.get('site')) || '{}';
  while (typeof current === 'string') current = JSON.parse(current);
  if (Array.isArray(incoming.works)) {
    current.works = incoming.works.slice(0, 500).map(cleanWork).filter(work => work.id && work.title);
  }
  if (incoming.settings && typeof incoming.settings === 'object') {
    current.settings = { ...(current.settings || {}), ...cleanSettings(incoming.settings) };
  }
  current.publishedAt = Date.now();
  await env.PUBLIC_CONTENT.put('site', JSON.stringify(current));
  return json({ success: true, works: current.works?.length || 0, publishedAt: current.publishedAt }, 200, { 'cache-control': 'no-store' });
}

async function uploadImage(request, env) {
  if (!requireAccess(request)) return json({ success: false, error: 'Access authentication required' }, 403);
  const body = await readJson(request);
  const { type, binary } = parseDataUrl(body.imageData, ['image/jpeg', 'image/png', 'image/webp'], 10 * 1024 * 1024);
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const base = cleanText(body.filename || 'painting', 180).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_') || 'painting';
  const key = `paintings/${Date.now()}_${base}.${extension}`;
  await env.PAINTINGS.put(key, binary, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  return json({ success: true, url: `${PUBLIC_R2_BASE}/${key}` }, 200, { 'cache-control': 'no-store' });
}

async function uploadCv(request, env) {
  if (!requireAccess(request)) return json({ success: false, error: 'Access authentication required' }, 403);
  const body = await readJson(request);
  const { binary } = parseDataUrl(body.fileData, ['application/pdf'], 10 * 1024 * 1024);
  const key = 'cv/Aline-Marbella-Villanueva-CV.pdf';
  await env.PAINTINGS.put(key, binary, { httpMetadata: { contentType: 'application/pdf', contentDisposition: 'inline', cacheControl: 'public, max-age=300' } });
  return json({ success: true, url: `${PUBLIC_R2_BASE}/${key}` }, 200, { 'cache-control': 'no-store' });
}

async function proxyImage(request) {
  if (!requireAccess(request)) return json({ success: false, error: 'Access authentication required' }, 403);
  const requested = new URL(request.url).searchParams.get('url') || '';
  let target;
  try {
    target = new URL(requested);
  } catch {
    return json({ success: false, error: 'Invalid image URL' }, 400);
  }
  const allowedHost = 'pub-4836c3859b604ddf81b2d5d30b12c835.r2.dev';
  if (target.protocol !== 'https:' || target.hostname !== allowedHost || !target.pathname.startsWith('/paintings/')) {
    return json({ success: false, error: 'Image URL is not allowed' }, 403);
  }
  const upstream = await fetch(target.toString(), { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!upstream.ok) return json({ success: false, error: 'Image could not be loaded' }, upstream.status);
  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) return json({ success: false, error: 'Upstream content is not an image' }, 415);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=300',
      'access-control-allow-origin': new URL(request.url).origin,
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/publish') return await publish(request, env);
      if (request.method === 'POST' && url.pathname === '/upload-image') return await uploadImage(request, env);
      if (request.method === 'POST' && url.pathname === '/upload-cv') return await uploadCv(request, env);
      if (request.method === 'GET' && url.pathname === '/proxy-image') return await proxyImage(request);
      const assetResponse = await env.ASSETS.fetch(request);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const headers = new Headers(assetResponse.headers);
        headers.set('cache-control', 'private, no-store, max-age=0');
        return new Response(assetResponse.body, { status: assetResponse.status, headers });
      }
      return assetResponse;
    } catch (error) {
      return json({ success: false, error: error?.message || 'Request failed' }, 400, { 'cache-control': 'no-store' });
    }
  }
};
