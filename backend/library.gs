/* ===== Family photo library relay (wittenauer.family/photos) =====
   The website can't read Immich directly (Immich sends no CORS headers), so this
   reads the Immich shared albums server-side and returns a slim list.
   It returns ONLY asset ids, dates, photo/video flags, shape and video length.
   No share keys, no GPS, no file names. Images still need the share key, which
   lives only inside the website's encrypted settings (behind the family word).

   Setup (Script Properties):
     IMMICH_URL     = https://photos.wittenauer.family
     IMMICH_SHARES  = ["<archive share key>", "<hilton head share key>"]   (JSON array, order matters)

   doGet: add   if (action === 'library') return json(library());   before the 'state' check.
*/
function library() {
  const cache = CacheService.getScriptCache();
  const hit = cacheGetBig_(cache, 'witt_library_v2');
  if (hit) return hit;
  const props = PropertiesService.getScriptProperties();
  const base = (props.getProperty('IMMICH_URL') || 'https://photos.wittenauer.family').replace(/\/$/, '');
  const keys = JSON.parse(props.getProperty('IMMICH_SHARES') || '[]');
  const out = { ok: true, at: new Date().toISOString(), shares: [] };
  keys.forEach(function (key, s) {
    const share = { s: s, album: '', count: 0, a: [] };
    try {
      const me = JSON.parse(UrlFetchApp.fetch(base + '/api/shared-links/me?key=' + encodeURIComponent(key), { muteHttpExceptions: true }).getContentText());
      if (!me || !me.album) { out.shares.push(share); return; }
      share.album = me.album.albumName || '';
      const q = 'albumId=' + me.album.id + '&key=' + encodeURIComponent(key);
      const buckets = JSON.parse(UrlFetchApp.fetch(base + '/api/timeline/buckets?' + q, { muteHttpExceptions: true }).getContentText()) || [];
      const reqs = buckets.map(function (b) { return { url: base + '/api/timeline/bucket?' + q + '&timeBucket=' + encodeURIComponent(b.timeBucket), muteHttpExceptions: true }; });
      for (let i = 0; i < reqs.length; i += 20) {
        UrlFetchApp.fetchAll(reqs.slice(i, i + 20)).forEach(function (r) {
          if (r.getResponseCode() !== 200) { share.error = 'partial'; return; }
          let c; try { c = JSON.parse(r.getContentText()); } catch (e) { share.error = 'partial'; return; }
          if (!c || !c.id) return;
          for (let k = 0; k < c.id.length; k++) {
            if (c.isTrashed && c.isTrashed[k]) continue;
            if (c.visibility && c.visibility[k] && c.visibility[k] !== 'timeline') continue;
            // Local date/time the photo was taken: fileCreatedAt is UTC but arrives without a 'Z', so add it, then shift by localOffsetHours.
            const t = new Date(new Date(String(c.fileCreatedAt[k]).replace(/Z?$/, 'Z')).getTime() + ((c.localOffsetHours && c.localOffsetHours[k]) || 0) * 3600000).toISOString().slice(0, 16);
            const ratio = Math.round(((c.ratio && c.ratio[k]) || 1) * 1000) / 1000;
            const img = c.isImage ? (c.isImage[k] ? 1 : 0) : 1;
            share.a.push(img ? [c.id[k], t, 1, ratio] : [c.id[k], t, 0, ratio, String((c.duration && c.duration[k]) || '')]);
          }
        });
      }
      share.a.sort(function (x, y) { return x[1] < y[1] ? -1 : 1; });
      share.count = share.a.length;
    } catch (err) { share.error = 'unavailable'; }
    out.shares.push(share);
  });
  /* Never cache (or claim success for) a broken read. */
  if (out.shares.some(function (s) { return s.error; }) || !out.shares.length || !out.shares[0].count) { out.ok = false; return out; }
  cachePutBig_(cache, 'witt_library_v2', out, 600);
  return out;
}
/* CacheService values are capped at 100KB, so big lists are split into chunks. */
function cachePutBig_(cache, name, obj, secs) {
  const s = JSON.stringify(obj), parts = [];
  for (let i = 0; i < s.length; i += 90000) parts.push(s.slice(i, i + 90000));
  const all = {}; parts.forEach(function (p, i) { all[name + '_' + i] = p; });
  all[name + '_n'] = String(parts.length);
  try { cache.putAll(all, secs); } catch (e) { console.log('cache put failed for ' + name + ': ' + e); }
}
function cacheGetBig_(cache, name) {
  try {
    const n = Number(cache.get(name + '_n') || 0); if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push(name + '_' + i);
    const got = cache.getAll(keys); let s = '';
    for (let i = 0; i < n; i++) { if (!got[keys[i]]) return null; s += got[keys[i]]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}

/* ===== People (face circles) for wittenauer.family/photos =====
   Uses the named faces in Immich. Needs one more Script Property:
     IMMICH_API_KEY = an Immich API key from Jimmy's owner account (person.read + asset.read is enough)
   Locked: the site must send t = SHA-256 hex of the archive share key. Only someone past the family word has that key,
   so names and faces never leave this script for strangers.
   doGet: add   if (action === 'people') return json(people(e.parameter.t, e.parameter.part));   next to the library route.
   Warm-up: add a time-driven trigger that runs warmPeople every 3 hours, so family members never wait on a cold run.

   part omitted -> { ok, people:[{ id, name, n, a:[last 12 hex chars of asset ids] }] }   (6-hour cache)
   part=faces   -> { ok, faces:{ personId: "data:image/jpeg;base64,..." } }              (6-hour cache)
   Only photos that are in the family shares are listed, and only named, non-hidden people who appear in them. */
function people(t, part) {
  try {
    const keys = JSON.parse(PropertiesService.getScriptProperties().getProperty('IMMICH_SHARES') || '[]');
    if (!keys.length || !PropertiesService.getScriptProperties().getProperty('IMMICH_API_KEY')) return { ok: false, error: 'not set up' };
    if (!t || String(t).toLowerCase() !== sha256hex_(keys[0])) return { ok: false, error: 'locked' };
    return part === 'faces' ? facesData_(false) : peopleData_(false);
  } catch (err) { return { ok: false, error: 'unavailable' }; }
}
/* Run from a time-driven trigger (every 3 hours): rebuilds both caches ahead of time. */
function warmPeople() { const p = peopleData_(true); if (p.ok) facesData_(true); console.log('warmPeople', p.ok ? p.people.length + ' people' : p.error); }

function immich_() {
  const props = PropertiesService.getScriptProperties();
  return { base: (props.getProperty('IMMICH_URL') || 'https://photos.wittenauer.family').replace(/\/$/, ''),
           key: props.getProperty('IMMICH_API_KEY') };
}
function assetTag_(id) { return String(id).replace(/-/g, '').slice(-12); }  /* the random end of the id (safe for UUID v4 and v7) */

/* One rebuild at a time: other requests wait for it, then read the fresh cache. */
function withCache_(name, secs, force, build) {
  const cache = CacheService.getScriptCache();
  if (!force) { const hit = cacheGetBig_(cache, name); if (hit) return hit; }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'busy' };
  try {
    if (!force) { const hit = cacheGetBig_(cache, name); if (hit) return hit; }
    const out = build();
    if (out.ok) cachePutBig_(cache, name, out, secs);
    return out;
  } finally { lock.releaseLock(); }
}

function namedPeople_(im) {
  const list = [], seen = {};
  for (let page = 1; page <= 20; page++) {
    const r = UrlFetchApp.fetch(im.base + '/api/people?withHidden=false&size=500&page=' + page, { headers: { 'x-api-key': im.key, Accept: 'application/json' }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('people ' + r.getResponseCode());
    const j = JSON.parse(r.getContentText()) || {};
    if (!Array.isArray(j.people)) throw new Error('people shape');
    j.people.forEach(function (p) { if (p && p.id && !seen[p.id] && p.name && String(p.name).trim() && !p.isHidden) { seen[p.id] = 1; list.push(p); } });
    if (!(j.hasNextPage || j.people.length >= 500)) break;
  }
  return list;
}

function peopleData_(force) {
  return withCache_('witt_people_v2', 21600, force, function () {
    const im = immich_(), H = { 'x-api-key': im.key, Accept: 'application/json' };
    const lib = library();
    if (!lib.ok) return { ok: false, error: 'library unavailable' };
    const inShare = {};
    lib.shares.forEach(function (s) { s.a.forEach(function (a) { inShare[a[0]] = 1; }); });
    const list = namedPeople_(im), byId = {};
    list.forEach(function (p) { byId[p.id] = { a: [], seen: {} }; });
    let pending = list.map(function (p) { return { id: p.id, page: 1 }; });
    for (let round = 0; pending.length && round < 30; round++) {
      const next = [];
      for (let i = 0; i < pending.length; i += 20) {
        const batch = pending.slice(i, i + 20);
        const res = UrlFetchApp.fetchAll(batch.map(function (x) {
          return { url: im.base + '/api/search/metadata', method: 'post', contentType: 'application/json', headers: H, muteHttpExceptions: true,
                   payload: JSON.stringify({ personIds: [x.id], page: x.page, size: 1000 }) };
        }));
        for (let k = 0; k < res.length; k++) {
          if (res[k].getResponseCode() !== 200) return { ok: false, error: 'search ' + res[k].getResponseCode() };
          const j = JSON.parse(res[k].getContentText()) || {};
          if (!j.assets || !Array.isArray(j.assets.items)) return { ok: false, error: 'search shape' };
          const who = byId[batch[k].id], items = j.assets.items;
          items.forEach(function (it) {
            if (!it || !inShare[it.id] || who.seen[it.id]) return;
            who.seen[it.id] = 1; who.a.push(assetTag_(it.id));
          });
          if (j.assets.nextPage || items.length >= 1000) next.push({ id: batch[k].id, page: Number(j.assets.nextPage) || batch[k].page + 1 });
        }
      }
      pending = next;
    }
    const out = { ok: true, at: new Date().toISOString(), people: [] };
    list.forEach(function (p) {
      const w = byId[p.id]; if (!w.a.length) return;
      out.people.push({ id: p.id, name: String(p.name).trim(), n: w.a.length, a: w.a });
    });
    console.log('people', out.people.map(function (p) { return p.name + ':' + p.n; }).join(', '));
    if (!out.people.length) return { ok: false, error: 'no named people in the shares' };  /* never cache an empty answer */
    return out;
  });
}

function facesData_(force) {
  if (!force) { const hit = cacheGetBig_(CacheService.getScriptCache(), 'witt_faces_v2'); if (hit) return hit; }
  const ppl = peopleData_(false);  /* outside the lock: the people build takes the same lock */
  if (!ppl.ok) return { ok: false, error: ppl.error };
  return withCache_('witt_faces_v2', 21600, force, function () {
    const im = immich_();
    const ids = ppl.people.map(function (p) { return p.id; });  /* only people the site actually shows */
    const out = { ok: true, at: new Date().toISOString(), faces: {} };
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      UrlFetchApp.fetchAll(chunk.map(function (id) { return { url: im.base + '/api/people/' + id + '/thumbnail', headers: { 'x-api-key': im.key }, muteHttpExceptions: true }; }))
        .forEach(function (r, k) {
          if (r.getResponseCode() !== 200) return;
          const h = r.getHeaders(), type = String(h['Content-Type'] || h['content-type'] || 'image/jpeg').split(';')[0].trim();
          if (type.indexOf('image/') !== 0) return;
          out.faces[chunk[k]] = 'data:' + type + ';base64,' + Utilities.base64Encode(r.getContent());
        });
    }
    console.log('faces', Object.keys(out.faces).length + ' of ' + ids.length);
    return out;
  });
}
function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
