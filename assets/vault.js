/* wittenauer.family — the family-word lock, photo loading, and the full-screen film.
   The photos on this site are encrypted. They only open with the family word,
   which is turned into a key right here in the browser. Nothing is sent anywhere. */
(function () {
  "use strict";
  var CFG = window.WITT_VAULT;
  var ROOT = (document.querySelector('meta[name="witt-root"]') || { content: "./" }).content;
  var STORE = "witt-key-v1";
  var key = null;
  var cache = {};

  function b64ToBytes(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function bytesToB64(a) { var s = ""; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function store(get, val) {
    try { if (get) return localStorage.getItem(STORE) || sessionStorage.getItem(STORE); }
    catch (e) { return null; }
    try { if (val === null) { localStorage.removeItem(STORE); sessionStorage.removeItem(STORE); } else localStorage.setItem(STORE, val); }
    catch (e) { try { sessionStorage.setItem(STORE, val); } catch (e2) {} }
  }

  async function decrypt(k, buf) {
    var u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, k, u.slice(12));
  }
  async function checkKey(k) {
    try { var out = await decrypt(k, b64ToBytes(CFG.check)); return new TextDecoder().decode(out) === "witt-ok"; }
    catch (e) { return false; }
  }
  async function importRaw(raw) { return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["decrypt"]); }

  var Vault = {
    ready: false,
    async remembered() {
      var s = store(true);
      if (!s) return false;
      try { var k = await importRaw(b64ToBytes(s)); if (await checkKey(k)) { key = k; Vault.ready = true; return true; } } catch (e) {}
      store(false, null); return false;
    },
    async unlock(word, remember) {
      word = String(word || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!word) return false;
      var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(word), "PBKDF2", false, ["deriveKey"]);
      var k = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64ToBytes(CFG.salt), iterations: CFG.iter, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
      if (!(await checkKey(k))) return false;
      key = k; Vault.ready = true;
      if (remember) { var raw = new Uint8Array(await crypto.subtle.exportKey("raw", k)); store(false, bytesToB64(raw)); }
      return true;
    },
    config() {
      if (!cache.cfg) cache.cfg = fetch(ROOT + "media/cfg.bin").then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return decrypt(key, b); }).then(function (p) { return JSON.parse(new TextDecoder().decode(p)); });
      return cache.cfg;
    },
    forget() { store(false, null); key = null; Vault.ready = false; },
    blob(id, size) {
      var ck = size + "/" + id;
      if (!cache[ck]) {
        cache[ck] = fetch(ROOT + "media/" + size + "/" + id + ".bin")
          .then(function (r) { if (!r.ok) throw new Error("missing " + ck); return r.arrayBuffer(); })
          .then(function (buf) { return decrypt(key, buf); })
          .then(function (plain) { return new Blob([plain], { type: "image/jpeg" }); });
        cache[ck].catch(function () { delete cache[ck]; });
      }
      return cache[ck];
    },
    url(id, size) {
      var ck = "u:" + size + "/" + id;
      if (!cache[ck]) cache[ck] = Vault.blob(id, size).then(function (b) { return URL.createObjectURL(b); });
      return cache[ck];
    }
  };

  /* ---------- The family-word door ---------- */
  function wireGate(onOpen) {
    var gate = document.getElementById("gate");
    var form = gate.querySelector("form");
    var input = gate.querySelector("#word");
    var err = gate.querySelector(".err");
    var btn = form.querySelector("button[type=submit]");
    function open() { gate.classList.add("gone"); document.body.classList.add("unlocked"); setTimeout(function () { gate.hidden = true; }, 950); onOpen(); }
    /* Magic link: wittenauer.family/#w=familyword unlocks with one tap and remembers this phone. */
    var mw = location.hash.match(/[#&]w=([^&]+)/);
    if (mw) {
      var w = decodeURIComponent(mw[1]);
      history.replaceState(null, "", location.pathname + location.search + location.hash.replace(/[#&]?w=[^&]+/, "").replace(/^#?&/, "#").replace(/^#$/, ""));
      Vault.unlock(w, true).then(function (ok) { if (ok) open(); else startGate(); }).catch(startGate);
    } else startGate();
    function startGate() { Vault.remembered().then(function (ok) {
      if (ok) { gate.hidden = true; gate.classList.add("gone"); document.body.classList.add("unlocked", "instant"); onOpen(); }
      else { gate.classList.add("show-form"); setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) {} }, 900); }
    }); }
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      err.textContent = ""; btn.disabled = true; btn.textContent = "Opening…";
      var ok = false;
      try { ok = await Vault.unlock(input.value, gate.querySelector("#remember").checked); } catch (x) { ok = false; }
      btn.disabled = false; btn.textContent = "Come in";
      if (ok) open();
      else { err.textContent = "That's not quite it. Try again?"; gate.classList.remove("shake"); void gate.offsetWidth; gate.classList.add("shake"); input.select(); }
    });
  }

  /* ---------- Dates ---------- */
  function todayNY() {
    var q = new URLSearchParams(location.search).get("today");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
    catch (e) { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5); }
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function prettyDate(d) { if (!d) return ""; var p = d.split("-"); return MONTHS[+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; }
  function thisWeekOtherYears(photos, today, span) {
    var y = +today.slice(0, 4), out = [];
    photos.forEach(function (p) {
      if (!p.date) return; var py = +p.date.slice(0, 4); if (py >= y) return;
      var same = y + p.date.slice(4); var dd = Math.abs(dayDiff(today, same));
      if (dd <= (span || 7)) out.push(Object.assign({ ago: y - py, dd: dd }, p));
    });
    return out.sort(function (a, b) { return a.dd - b.dd; });
  }

  /* ---------- The full-screen film ---------- */
  var ICON = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };
  function playFilm(items, opts) {
    opts = opts || {};
    var small = Math.min(innerWidth, innerHeight) < 700, size = small ? "m" : "f";
    var el = document.createElement("div");
    el.className = "show ui"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", opts.label || "Slideshow");
    el.innerHTML = '<div class="layer"></div><div class="layer"></div><div class="title"><div><div class="yr xd"></div><div class="sub eyebrow"></div></div></div>' +
      '<div class="cap"><div><div class="y xd"></div><div class="c"></div></div></div><div class="bar"><i></i></div><div class="paused">Paused</div>' +
      '<div class="ctl"><button class="icon-btn pp" aria-label="Pause">' + ICON.pause + '</button><button class="icon-btn close" aria-label="Close slideshow">' + ICON.x + '</button></div>' +
      '<button class="icon-btn nav prev" aria-label="Previous">' + ICON.prev + '</button><button class="icon-btn nav next" aria-label="Next">' + ICON.next + '</button>';
    var prevOverflow = document.body.style.overflow; document.body.appendChild(el); document.body.style.overflow = "hidden";
    var layers = el.querySelectorAll(".layer"), cur = 0, i = -1, timer = null, paused = false, uiT = null, bar = el.querySelector(".bar i");
    var titleEl = el.querySelector(".title"), cap = el.querySelector(".cap"), kb = 0, alive = true;
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function poke() { el.classList.add("ui"); clearTimeout(uiT); uiT = setTimeout(function () { el.classList.remove("ui"); }, 2600); }
    function preload(k) { var it = items[k]; if (it && it.id) Vault.url(it.id, size); }
    function dur(it) { return it.title ? 2600 : 5600; }
    function runBar(ms) { bar.style.transition = "none"; bar.style.width = ((i) / items.length * 100) + "%"; void bar.offsetWidth; bar.style.transition = "width " + ms + "ms linear"; bar.style.width = ((i + 1) / items.length * 100) + "%"; }
    function go(n) {
      if (!alive) return;
      clearTimeout(timer);
      i = n; if (i >= items.length) { if (opts.loop) i = 0; else { close(); return; } } if (i < 0) i = 0;
      var it = items[i]; preload(i + 1); preload(i + 2);
      if (it.title) {
        var yr = titleEl.querySelector(".yr"); yr.textContent = it.title; yr.classList.toggle("long", String(it.title).length > 4); titleEl.querySelector(".sub").textContent = it.sub || "";
        titleEl.classList.add("on"); layers[cur].classList.remove("on"); cap.style.opacity = 0; schedule(it); return;
      }
      Vault.url(it.id, size).then(function (u) {
        if (!alive || items[i] !== it) return;
        var nxt = 1 - cur, L = layers[nxt]; var portrait = it.h > it.w;
        L.className = "layer" + (portrait || small ? "" : " cover");
        L.innerHTML = (portrait || small ? '<div class="bgblur" style="background-image:url(' + u + ')"></div>' : "") +
          '<img class="photo" alt="' + (it.caption || "").replace(/"/g, "&quot;") + '" src="' + u + '" style="object-position:' + (it.focus || "50% 50%") + '">';
        var img = L.querySelector("img.photo"); if (!reduce) img.classList.add("kb" + (kb++ % 4 + 1));
        titleEl.classList.remove("on");
        requestAnimationFrame(function () { L.classList.add("on"); layers[cur].classList.remove("on"); cur = nxt; });
        el.querySelector(".cap .y").textContent = it.date ? it.date.slice(0, 4) : "";
        el.querySelector(".cap .c").textContent = it.caption || ""; cap.style.opacity = 1;
        schedule(it);
      }).catch(function () { schedule(it, 10); });
    }
    function schedule(it, ms) { ms = ms || dur(it); if (!paused) { runBar(ms); timer = setTimeout(function () { go(i + 1); }, ms); } }
    function toggle() { paused = !paused; el.classList.toggle("is-paused", paused); var b = el.querySelector(".pp"); b.innerHTML = paused ? ICON.play : ICON.pause; b.setAttribute("aria-label", paused ? "Play" : "Pause"); if (paused) { clearTimeout(timer); bar.style.transition = "none"; } else go(i + 1); }
    function close() { alive = false; clearTimeout(timer); clearTimeout(uiT); document.removeEventListener("keydown", key, true); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} el.remove(); document.body.style.overflow = prevOverflow; if (opts.onClose) opts.onClose(); }
    function key(e) { e.stopPropagation(); if (e.key === "Escape") close(); else if (e.key === " ") { e.preventDefault(); toggle(); } else if (e.key === "ArrowRight") go(i + 1); else if (e.key === "ArrowLeft") go(i - 1); poke(); }
    el.querySelector(".close").onclick = function (e) { e.stopPropagation(); close(); };
    el.querySelector(".pp").onclick = function (e) { e.stopPropagation(); toggle(); };
    el.querySelector(".prev").onclick = function (e) { e.stopPropagation(); go(i - 1); };
    el.querySelector(".next").onclick = function (e) { e.stopPropagation(); go(i + 1); };
    el.addEventListener("mousemove", poke); el.addEventListener("click", function () { poke(); });
    var sx = null; el.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; poke(); }, { passive: true });
    el.addEventListener("touchend", function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); sx = null; });
    document.addEventListener("keydown", key, true);
    if (opts.fullscreen !== false && el.requestFullscreen && !small) { el.requestFullscreen().catch(function () {}); }
    poke(); preload(0); go(opts.start || 0);
    return { close: close };
  }
  /* A film of the whole family, in order, with a title card for each year. */
  function familyFilm(photos) {
    var sorted = photos.filter(function (p) { return p.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var items = [{ title: "THE WITTS", sub: "Every Witt, every year" }], last = null;
    sorted.forEach(function (p) { var y = p.date.slice(0, 4); if (y !== last) { items.push({ title: y, sub: "The Witts in " + y }); last = y; } items.push(p); });
    return items;
  }


  /* ---------- Add photos & videos (goes to the family photo library) ---------- */
  function uploadTarget(cfg) {
    var t = todayNY(), list = (cfg && cfg.upload) || [];
    for (var i = 0; i < list.length; i++) if (t <= list[i].until) return list[i];
    return null;
  }
  function addPhotos() {
    Vault.config().then(function (cfg) {
      var u = uploadTarget(cfg); if (!u) return;
      var prev = document.activeElement;
      var w = document.createElement("div"); w.className = "up-wrap";
      w.innerHTML = '<div class="up" role="dialog" aria-modal="true" aria-labelledby="upT">' +
        '<button class="icon-btn x" aria-label="Close">' + ICON.x + '</button>' +
        '<h2 class="xd" id="upT">Add your photos &amp; videos</h2>' +
        '<p class="lead">They go straight into <b>' + u.album + '</b> at full quality, so everyone can see them. Videos work too.</p>' +
        '<ol><li><b class="n">1</b><span>Tap <b>Open the album</b> below.</span></li>' +
        (u.pass ? '<li><b class="n">2</b><span>If it asks for a password, type<br><span class="pw">' + u.pass + '</span></span></li>' : '') +
        '<li><b class="n">' + (u.pass ? 3 : 2) + '</b><span>Tap the <b>upload arrow</b> at the top, then pick your photos and videos.</span></li>' +
        '<li><b class="n">' + (u.pass ? 4 : 3) + '</b><span>Keep that page open until they finish. That\'s it.</span></li></ol>' +
        '<a class="btn btn-gold go" href="' + u.url + '" target="_blank" rel="noopener">Open the album</a></div>';
      function close() { document.removeEventListener("keydown", key, true); w.remove(); if (prev) prev.focus(); }
      function key(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
      w.querySelector(".x").onclick = close;
      w.addEventListener("click", function (e) { if (e.target === w) close(); });
      document.addEventListener("keydown", key, true);
      document.body.appendChild(w); w.querySelector(".go").focus();
    });
  }

  window.Vault = Vault;
  window.Witt = { addPhotos: addPhotos, uploadTarget: uploadTarget, wireGate: wireGate, todayNY: todayNY, dayDiff: dayDiff, prettyDate: prettyDate, thisWeekOtherYears: thisWeekOtherYears, playFilm: playFilm, familyFilm: familyFilm, ICON: ICON };
})();
