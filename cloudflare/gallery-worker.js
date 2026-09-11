const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=300';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const CLIENT_SYNC = String.raw`<script>
(function () {
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el && value != null && value !== '') el.textContent = String(value);
  }
  function lines(value) {
    return String(value || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  }
  function applyHeroName(value) {
    var el = document.getElementById('hero-name');
    var nameLines = lines(value);
    if (!el || !nameLines.length) return;
    el.replaceChildren();
    nameLines.forEach(function (line, index) {
      if (index) el.appendChild(document.createElement('br'));
      var node = index === 1 ? document.createElement('em') : document.createTextNode(line);
      if (index === 1) node.textContent = line;
      el.appendChild(node);
    });
  }
  function applyStatement(value) {
    var el = document.getElementById('statement-text');
    if (!el || !value) return;
    el.replaceChildren();
    String(value).split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean).forEach(function (paragraph) {
      var p = document.createElement('p');
      if (paragraph.indexOf('* ') === 0) {
        var em = document.createElement('em');
        em.textContent = paragraph.slice(2);
        p.appendChild(em);
      } else {
        p.textContent = paragraph;
      }
      el.appendChild(p);
    });
  }
  function applyList(id, value) {
    var el = document.getElementById(id);
    if (!el || !value) return;
    el.replaceChildren();
    lines(value).forEach(function (entry) {
      var parts = entry.split('|').map(function (part) { return part.trim(); });
      var li = document.createElement('li');
      li.className = 'exh-item';
      var year = document.createElement('span');
      year.className = 'exh-year';
      year.textContent = parts[0] || '';
      var details = document.createElement('div');
      var title = document.createElement('p');
      title.className = 'exh-title';
      title.textContent = parts[1] || '';
      var venue = document.createElement('p');
      venue.className = 'exh-venue';
      venue.textContent = parts.slice(2).join(' | ');
      details.append(title, venue);
      li.append(year, details);
      el.appendChild(li);
    });
  }
  function applyAcquire(value) {
    var el = document.getElementById('acquire-details');
    var items = lines(value);
    if (!el || !items.length) return;
    if (/^available for:?$/i.test(items[0])) items.shift();
    items = items.map(function (item) { return item.replace(/^[*#]\s*/, ''); }).filter(Boolean);
    el.replaceChildren(document.createTextNode('Available for:'), document.createElement('br'));
    items.forEach(function (item) {
      var span = document.createElement('span');
      span.textContent = item;
      el.appendChild(span);
    });
  }
  function setVisible(id, visible) {
    var el = document.getElementById(id);
    if (el) el.style.display = visible === false ? 'none' : '';
  }
  function applySettings(settings) {
    if (!settings) return;
    var hero = document.getElementById('hero');
    var heroImage = document.getElementById('hero-img');
    if (heroImage && settings.heroImageUrl) {
      heroImage.onload = function () { heroImage.style.opacity = '1'; };
      heroImage.onerror = function () { heroImage.style.opacity = '1'; };
      heroImage.src = settings.heroImageUrl;
      if (heroImage.complete) heroImage.style.opacity = '1';
    }
    if (hero && settings.heroEyebrow) {
      var eyebrow = document.getElementById('hero-eyebrow');
      if (!eyebrow) {
        eyebrow = document.createElement('p');
        eyebrow.id = 'hero-eyebrow';
        eyebrow.style.cssText = 'font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:0 0 14px;color:rgba(247,247,245,.75)';
        var name = document.getElementById('hero-name');
        if (name && name.parentNode) name.parentNode.insertBefore(eyebrow, name);
      }
      eyebrow.textContent = settings.heroEyebrow;
    }
    applyHeroName(settings.heroNameText);
    setText('hero-bio', settings.heroBio);
    applyStatement(settings.statementText);
    applyList('education-list', settings.educationText);
    applyList('exhibitions-list', settings.exhibitionsText);
    applyAcquire(settings.acquireText);
    if (settings.contactEmail) {
      var email = document.getElementById('acquire-email');
      if (email) {
        email.textContent = settings.contactEmail;
        email.href = 'mailto:' + settings.contactEmail;
      }
      document.querySelectorAll('[data-public-email]').forEach(function (link) { link.href = 'mailto:' + settings.contactEmail; });
    }
    var cv = document.getElementById('cv-download-btn');
    if (cv) {
      if (settings.cvUrl) cv.href = settings.cvUrl;
      cv.style.display = settings.cvButtonVisible === false ? 'none' : '';
    }
    window.smPriceState = {
      visible: settings.pricesVisible !== false,
      text: settings.priceText || 'Price upon request'
    };
    var visibility = settings.visibility || {};
    setVisible('hero', visibility.hero);
    setVisible('works', visibility.works);
    setVisible('statement', visibility.statement);
    setVisible('cv', visibility.cv);
    setVisible('acquire', visibility.acquire);
  }
  function loadPublicContent() {
    fetch('/api/public', { cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('public feed'); return response.json(); })
      .then(function (data) {
        applySettings(data.settings);
        if (Array.isArray(data.works) && data.works.length && typeof window.renderWorks === 'function') {
          window.renderWorks(data.works);
        }
      })
      .catch(function () { /* Keep the verified static fallback already rendered. */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPublicContent);
  else loadPublicContent();
})();
</script>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/public') {
      let content = (await env.PUBLIC_CONTENT.get('site')) || '{}';
      while (typeof content === 'string') content = JSON.parse(content);
      return json(content, 200, { 'cache-control': PUBLIC_CACHE, 'access-control-allow-origin': 'https://www.alinevillanueva.com' });
    }
    const asset = await env.ASSETS.fetch(request);
    const type = asset.headers.get('content-type') || '';
    if (request.method === 'GET' && type.includes('text/html')) {
      const html = await asset.text();
      const headers = new Headers(asset.headers);
      headers.set('cache-control', 'public, max-age=60, stale-while-revalidate=600');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'strict-origin-when-cross-origin');
      return new Response(html.replace('</body>', CLIENT_SYNC + '\n</body>'), { status: asset.status, headers });
    }
    return asset;
  }
};
