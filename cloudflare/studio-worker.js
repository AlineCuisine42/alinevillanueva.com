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
  const visibility = settings?.visibility || {};
  return {
    heroEyebrow: cleanText(settings?.heroEyebrow, 240),
    heroNameText: cleanText(settings?.heroNameText, 500),
    heroBio: cleanText(settings?.heroBio, 1000),
    statementText: cleanText(settings?.statementText, 12000),
    educationText: cleanText(settings?.educationText, 12000),
    exhibitionsText: cleanText(settings?.exhibitionsText, 12000),
    contactEmail: cleanText(settings?.contactEmail, 320),
    acquireText: cleanText(settings?.acquireText, 4000),
    cvButtonVisible: settings?.cvButtonVisible !== false,
    cvUrl: cleanText(settings?.cvUrl, 2000),
    pricesVisible: settings?.pricesVisible !== false,
    priceText: cleanText(settings?.priceText || 'Price upon request', 240),
    visibility: {
      hero: visibility.hero !== false,
      works: visibility.works !== false,
      statement: visibility.statement !== false,
      cv: visibility.cv !== false,
      acquire: visibility.acquire !== false,
    },
    updatedAt: Number(settings?.updatedAt) || Date.now(),
  };
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
  const current = JSON.parse((await env.PUBLIC_CONTENT.get('site')) || '{}');
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/publish') return await publish(request, env);
      if (request.method === 'POST' && url.pathname === '/upload-image') return await uploadImage(request, env);
      if (request.method === 'POST' && url.pathname === '/upload-cv') return await uploadCv(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ success: false, error: error?.message || 'Request failed' }, 400, { 'cache-control': 'no-store' });
    }
  }
};
