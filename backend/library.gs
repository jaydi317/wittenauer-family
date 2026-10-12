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
  const hit = cacheGetBig_(cache, 'witt_library_v1');
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
          let c; try { c = JSON.parse(r.getContentText()); } catch (e) { return; }
          if (!c || !c.id) return;
          for (let k = 0; k < c.id.length; k++) {
            if (c.isTrashed && c.isTrashed[k]) continue;
            if (c.visibility && c.visibility[k] && c.visibility[k] !== 'timeline') continue;
            // Local date/time the photo was taken: fileCreatedAt (UTC) shifted by localOffsetHours.
            const t = new Date(new Date(c.fileCreatedAt[k]).getTime() + ((c.localOffsetHours && c.localOffsetHours[k]) || 0) * 3600000).toISOString().slice(0, 16);
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
  cachePutBig_(cache, 'witt_library_v1', out, 600);
  return out;
}
/* CacheService values are capped at 100KB, so big lists are split into chunks. */
function cachePutBig_(cache, name, obj, secs) {
  const s = JSON.stringify(obj), parts = [];
  for (let i = 0; i < s.length; i += 90000) parts.push(s.slice(i, i + 90000));
  const all = {}; parts.forEach(function (p, i) { all[name + '_' + i] = p; });
  all[name + '_n'] = String(parts.length);
  try { cache.putAll(all, secs); } catch (e) {}
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
