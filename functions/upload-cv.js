// Pages Function: POST /upload-cv
// Stores the artist's CV PDF in the amv-paintings R2 bucket at a stable key
// so the public link never changes.
const PUBLIC_BASE = "https://pub-4836c3859b604ddf81b2d5d30b12c835.r2.dev";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { env } = context;
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const { fileData } = body || {};
  if (!fileData || typeof fileData !== "string" || !fileData.startsWith("data:application/pdf")) {
    return json({ success: false, error: "Missing or non-PDF fileData" }, 400);
  }
  let bytes;
  try {
    const bin = atob(fileData.slice(fileData.indexOf(",") + 1));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) {
    return json({ success: false, error: "Could not decode file data" }, 400);
  }
  if (bytes.length > 10 * 1024 * 1024) {
    return json({ success: false, error: "PDF exceeds 10 MB limit" }, 400);
  }
  const key = "cv/Aline-Marbella-Villanueva-CV.pdf";
  try {
    await env.PAINTINGS_BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  } catch (e) {
    return json({ success: false, error: "Storage write failed: " + e.message }, 500);
  }
  return json({ success: true, url: PUBLIC_BASE + "/" + key });
}
