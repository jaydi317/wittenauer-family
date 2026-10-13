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
      if (!cache.cfg) cache.cfg = fetch(ROOT + "media/cfg.bin?v=5").then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return decrypt(key, b); }).then(function (p) { return JSON.parse(new TextDecoder().decode(p)); });
      return cache.cfg;
    },
    forget() {
      store(false, null); key = null; Vault.ready = false;
      try { ["witt-lib-v2", "witt-people-v2", "witt-faces-v2", "witt-uploads-v1", "witt-uploaders-v1"].forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {}
      try { ["witt-me", "witt-seen-upload", "witt-uploaders"].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    },
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
    var startItem = items[opts.start || 0];
    while (startItem && startItem.video && items.indexOf(startItem) < items.length - 1) startItem = items[items.indexOf(startItem) + 1];
    items = items.filter(function (it) { return it.title || !it.video; });
    if (!items.length) return null;
    opts.start = Math.max(0, items.indexOf(startItem));
    function ready(it) { /* fetch and decode before fading in, so slides never flash blank */
      return src(it, size).then(function (u) { return new Promise(function (res) { var im = new Image(); im.onload = function () { (im.decode ? im.decode() : Promise.resolve()).then(function () { res(u); }, function () { res(u); }); }; im.onerror = function () { res(u); }; im.src = u; }); });
    }
    var readyCache = {};
    function preload(k) { var it = items[k]; if (it && it.id && !readyCache[it.id]) readyCache[it.id] = ready(it); }
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
      if (!readyCache[it.id]) readyCache[it.id] = ready(it);
      readyCache[it.id].then(function (u) {
        if (!alive || items[i] !== it) return;
        var nxt = 1 - cur, L = layers[nxt]; var portrait = it.h > it.w;
        L.className = "layer" + (portrait || small ? "" : " cover");
        L.innerHTML = (portrait || small ? '<div class="bgblur" style="background-image:url(' + u + ')"></div>' : "") +
          '<img class="photo" alt="' + (it.caption || "").replace(/"/g, "&quot;") + '" src="' + u + '" style="object-position:' + (it.focus || "50% 50%") + '">';
        var img = L.querySelector("img.photo"); if (!reduce) img.classList.add("kb" + (kb++ % 4 + 1));
        titleEl.classList.remove("on");
        requestAnimationFrame(function () { L.classList.add("on"); layers[cur].classList.remove("on"); cur = nxt; });
        el.querySelector(".cap .y").textContent = it.date ? it.date.slice(0, 4) : "";
        el.querySelector(".cap .c").textContent = it.caption || prettyDate(it.date); cap.style.opacity = 1;
        schedule(it);
      }).catch(function () { schedule(it, 10); });
    }
    function schedule(it, ms) { ms = ms || dur(it); if (!paused) { runBar(ms); timer = setTimeout(function () { go(i + 1); }, ms); } }
    function toggle() { paused = !paused; el.classList.toggle("is-paused", paused); var b = el.querySelector(".pp"); b.innerHTML = paused ? ICON.play : ICON.pause; b.setAttribute("aria-label", paused ? "Play" : "Pause"); if (paused) { clearTimeout(timer); bar.style.transition = "none"; } else go(i + 1); }
    var popped = false;
    function onPop() { popped = true; close(); }
    function close() { if (!alive) return; if (!popped) { popped = true; window.removeEventListener("popstate", onPop); if (window.Witt) window.Witt.skipPop = true; history.back(); } window.removeEventListener("popstate", onPop); alive = false; clearTimeout(timer); clearTimeout(uiT); document.removeEventListener("keydown", key, true); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} el.remove(); document.body.style.overflow = prevOverflow; if (opts.onClose) opts.onClose(); }
    function key(e) { e.stopPropagation(); if (e.key === "Escape") close(); else if (e.key === " ") { e.preventDefault(); toggle(); } else if (e.key === "ArrowRight") go(i + 1); else if (e.key === "ArrowLeft") go(i - 1); poke(); }
    el.querySelector(".close").onclick = function (e) { e.stopPropagation(); close(); };
    el.querySelector(".pp").onclick = function (e) { e.stopPropagation(); toggle(); };
    el.querySelector(".prev").onclick = function (e) { e.stopPropagation(); go(i - 1); };
    el.querySelector(".next").onclick = function (e) { e.stopPropagation(); go(i + 1); };
    el.addEventListener("mousemove", poke); el.addEventListener("click", function () { poke(); });
    var sx = null; el.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; poke(); }, { passive: true });
    el.addEventListener("touchend", function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); sx = null; });
    document.addEventListener("keydown", key, true);
    history.pushState({ witt: "film" }, ""); window.addEventListener("popstate", onPop);
    if (opts.fullscreen !== false && el.requestFullscreen && !small) { el.requestFullscreen().catch(function () {}); }
    poke(); preload(0); go(opts.start || 0);
    return { close: close };
  }
  /* A film of the whole family, in order, with a title card for each year. */
  function familyFilm(photos, perYear, opts) {
    opts = opts || {};
    var sorted = photos.filter(function (p) { return p.date && !p.video; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (perYear) { /* keep the film to a sitting: an even sample from each year */
      var by = {}; sorted.forEach(function (p) { (by[p.date.slice(0, 4)] = by[p.date.slice(0, 4)] || []).push(p); });
      sorted = [].concat.apply([], Object.keys(by).sort().map(function (y) {
        var l = by[y]; if (l.length <= perYear) return l;
        var out = []; for (var i = 0; i < perYear; i++) out.push(l[Math.floor(i * l.length / perYear)]); return out;
      }));
    }
    var items = [{ title: opts.title || "THE WITTS", sub: opts.sub || "Every Witt, every year" }], last = null;
    sorted.forEach(function (p) { var y = p.date.slice(0, 4); if (y !== last) { items.push({ title: y, sub: (opts.who || "The Witts") + " in " + y }); last = y; } items.push(p); });
    return items;
  }


  /* ---------- Add photos & videos (goes to the family photo library) ---------- */
  function uploadTarget(cfg) {
    var t = todayNY(), list = (cfg && cfg.upload) || [];
    for (var i = 0; i < list.length; i++) if (t <= list[i].until) return list[i];
    return null;
  }
  function addPhotos() {
    var prev = document.activeElement;
    var w = document.createElement("div"); w.className = "up-wrap";
    w.innerHTML = '<div class="up" role="dialog" aria-modal="true" aria-labelledby="upT"><button class="icon-btn x" aria-label="Close">' + ICON.x + '</button><div class="upin"><h2 class="xd" id="upT">Add your photos &amp; videos</h2><p class="lead">One sec&hellip;</p></div></div>';
    var box = w.querySelector(".upin"), bodyOverflow = document.body.style.overflow;
    function close() { document.removeEventListener("keydown", key, true); w.remove(); document.body.style.overflow = bodyOverflow; if (prev && prev.focus) prev.focus(); }
    function key(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    w.querySelector(".x").onclick = close;
    w.addEventListener("click", function (e) { if (e.target === w) close(); });
    document.addEventListener("keydown", key, true);
    document.body.appendChild(w); document.body.style.overflow = "hidden"; w.querySelector(".x").focus();
    var esc = function (t) { return String(t || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var low = function (t) { return String(t || "").toLowerCase().trim(); };
    var LIST = [], PEOPLE = [], FACES = {}, generic = null, label = firstName;
    var SOON = "Your photos show up on the site in about 10 minutes.";

    function personFor(name) {
      var n = low(name), exact = PEOPLE.filter(function (p) { return low(p.name) === n; });
      if (exact.length) return exact[0];
      var byFirst = PEOPLE.filter(function (p) { return low(firstName(p.name)) === low(firstName(name)); });
      return byFirst.length === 1 ? byFirst[0] : null;  /* only when nobody else shares the first name */
    }
    function faceHTML(name) { return '<i data-face="' + esc(name) + '"><b aria-hidden="true">' + esc(label(name).charAt(0).toUpperCase()) + '</b></i>'; }
    function paintFaces() {
      box.querySelectorAll("i[data-face]").forEach(function (i) {
        if (i.querySelector("img")) return;
        var p = personFor(i.getAttribute("data-face")), f = p && FACES[p.id];
        if (f) { var img = new Image(); img.alt = ""; img.src = f; i.appendChild(img); }
      });
    }
    function opened() {
      /* When they come back from the upload page, fetch fresh lists next time. */
      document.addEventListener("visibilitychange", function once() {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", once);
        try { ["witt-lib-v2", "witt-uploads-v1"].forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {}
      });
    }
    function steps(u, opts) {
      opts = opts || {};
      var who = u.name ? label(u.name) : "";
      box.innerHTML = (who ? '<div class="hi">' + faceHTML(u.name).replace("<i ", '<i class="wf" ') + '<h2 class="xd" id="upT">Hi, ' + esc(who) + '!</h2></div>' : '<h2 class="xd" id="upT">Add your photos &amp; videos</h2>') +
        '<p class="lead">' + opts.lead + '</p>' +
        '<ol><li><b class="n">1</b><span>Tap <b>Open my upload page</b> below.</span></li>' +
        '<li><b class="n">2</b><span>At the top, tap <b>Add photos</b> (the upload arrow), then pick your photos and videos.</span></li>' +
        '<li><b class="n">3</b><span>Keep that page open until they finish. ' + SOON + '</span></li></ol>' +
        '<a class="btn btn-gold go" href="' + esc(u.url) + '" target="_blank" rel="noopener">Open my upload page</a>' +
        (who ? '<button type="button" class="notme">Not ' + esc(who) + '? Pick someone else</button>' : '') +
        (opts.back ? '<button type="button" class="notme back">&larr; Back to faces</button>' : '');
      paintFaces();
      box.querySelector(".go").onclick = function () { if (u.name) me(u.name); opened(); };
      var nm = box.querySelector(".notme:not(.back)"); if (nm) nm.onclick = function () { me(null); picker(); };
      var bk = box.querySelector(".back"); if (bk) bk.onclick = picker;
      box.querySelector(".go").focus();
    }
    var MINE = "Everything you add goes into the family library with your name on it. Full quality, videos too.";
    function genericLead() { return "They go straight into <b>" + esc(generic.album) + "</b> at full quality, so everyone can see them."; }
    function picker() {
      box.innerHTML = '<h2 class="xd" id="upT">Who&rsquo;s adding?</h2><p class="lead">Tap your name. This phone will remember, and your photos will say they&rsquo;re from you.</p><div class="who" role="group" aria-label="Family members"></div>' +
        (generic ? '<button type="button" class="notme someone">Someone else</button>' : '');
      var grid = box.querySelector(".who");
      LIST.forEach(function (u) {
        var b = document.createElement("button"); b.type = "button"; b.className = "wface";
        b.innerHTML = faceHTML(u.name) + '<span>' + esc(label(u.name)) + '</span>';
        b.onclick = function () { steps(u, { lead: MINE }); };
        grid.appendChild(b);
      });
      paintFaces();
      var so = box.querySelector(".someone");
      if (so) so.onclick = function () { steps({ url: generic.url }, { lead: genericLead(), back: true }); };
      var f = grid.querySelector("button"); if (f) f.focus();
    }
    Vault.config().then(function (cfg) {
      generic = uploadTarget(cfg);
      /* Faces fill in when ready; the picker never waits for them. */
      Promise.all([people(), faces()]).then(function (r) { PEOPLE = r[0]; FACES = r[1]; paintFaces(); }).catch(function () {});
      return uploaders();
    }).then(function (list) {
      LIST = list; if (!LIST.length) throw new Error("none");
      label = labeler(LIST.map(function (u) { return u.name; }));
      var mine = me(), u = mine && LIST.filter(function (x) { return low(x.name) === low(mine); })[0];
      if (u) steps(u, { lead: MINE }); else picker();
    }).catch(function () {
      /* No per-person links (or the relay is down): the shared album, like before. */
      if (!document.body.contains(w)) return;
      if (generic) steps({ url: generic.url }, { lead: genericLead() + (me() ? " (Your name won&rsquo;t be on these this time.)" : "") });
      else box.innerHTML = '<h2 class="xd" id="upT">Add your photos &amp; videos</h2><p class="lead">Adding photos isn&rsquo;t open right now. Please try again later.</p>';
    });
  }

  /* ---------- The full family library (Immich at photos.wittenauer.family) ----------
     The list comes through the family's Google relay (ids and dates only). Pictures load
     straight from Immich using a share key that lives inside the locked settings. */
  var LIB = { base: "", keys: [] };
  function isLib(p) { return p && p.k != null; }
  function libUrl(p, kind) {
    var key = encodeURIComponent(LIB.keys[p.k] || "");
    if (kind === "orig") return LIB.base + "/api/assets/" + p.id + "/original?key=" + key;
    if (kind === "video") return LIB.base + "/api/assets/" + p.id + "/video/playback?key=" + key;
    return LIB.base + "/api/assets/" + p.id + "/thumbnail?size=" + (kind === "t" ? "thumbnail" : "preview") + "&key=" + key;
  }
  /* One way to get a picture's address, whether it is a locked favorite or from the library. */
  function src(p, size) { return isLib(p) ? Promise.resolve(libUrl(p, size)) : Vault.url(p.id, size); }
  var libPromise = null;
  function library() {
    if (libPromise) return libPromise;
    libPromise = Vault.config().then(function (cfg) {
      if (!cfg.immich || !cfg.api) throw new Error("no library configured");
      LIB.base = cfg.immich.base.replace(/\/$/, ""); LIB.keys = cfg.immich.keys;
      var cached = null;
      try { cached = JSON.parse(sessionStorage.getItem("witt-lib-v2") || "null"); } catch (e) {}
      if (cached && Date.now() - cached.got < 10 * 60 * 1000) return cached.data;
      var ctl = "AbortController" in window ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 9000);
      return fetch(cfg.api + "?action=library", ctl ? { signal: ctl.signal } : {}).then(function (r) { clearTimeout(tm); return r.json(); }).then(function (data) {
        if (!data || !data.ok) throw new Error("library unavailable");
        try { sessionStorage.setItem("witt-lib-v2", JSON.stringify({ got: Date.now(), data: data })); } catch (e) {}
        return data;
      });
    }).then(function (data) {
      var items = [], seen = {};
      data.shares.forEach(function (sh) {
        sh.a.forEach(function (a) {
          if (seen[a[0]]) { seen[a[0]].in.push(sh.s); return; }
          var ratio = a[3] || 1;
          var it = { id: a[0], k: sh.s, in: [sh.s], share: sh.album, date: a[1].slice(0, 10), time: a[1].slice(11, 16), video: !a[2],
            dur: a[4] || "", w: ratio >= 1 ? 1600 : Math.round(1600 * ratio), h: ratio >= 1 ? Math.round(1600 / ratio) : 1600, focus: "50% 40%", caption: "" };
          seen[a[0]] = it; items.push(it);
        });
      });
      items.sort(function (x, y) { return (x.date + x.time) < (y.date + y.time) ? -1 : 1; });
      return { items: items, shares: data.shares };
    });
    libPromise.catch(function () { libPromise = null; });
    return libPromise;
  }

  /* ---------- People: the faces Jimmy named in the photo library ----------
     The relay only answers if we prove we are past the family word (a fingerprint of the archive key). */
  function sha256hex(str) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    });
  }
  function relayGet(url, store, maxAge, ms) {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(store) || "null"); } catch (e) {}
    if (cached && Date.now() - cached.got < maxAge) return Promise.resolve(cached.data);
    var ctl = "AbortController" in window ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { clearTimeout(tm); return r.json(); }).then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "unavailable");
      try { sessionStorage.setItem(store, JSON.stringify({ got: Date.now(), data: data })); } catch (e) {}
      return data;
    });
  }
  function relayUrl(cfg, part) {
    return sha256hex(cfg.immich.keys[0]).then(function (t) { return cfg.api + "?action=people&t=" + t + (part ? "&part=" + part : ""); });
  }
  /* ---------- Who added what (each person uploads through their own album link) ---------- */
  var uploadsPromise = null;
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0]; }
  /* Show first names, unless two people share one: then the full name. */
  function labeler(names) {
    var c = {}; names.forEach(function (n) { var f = firstName(n).toLowerCase(); c[f] = (c[f] || {}); c[f][String(n).toLowerCase()] = 1; });
    return function (n) { return Object.keys(c[firstName(n).toLowerCase()] || {}).length > 1 ? String(n).trim() : firstName(n); };
  }
  function uploads() {
    if (uploadsPromise) return uploadsPromise;
    uploadsPromise = Promise.all([Vault.config(), library()]).then(function (r) {
      var cfg = r[0], lib = r[1];
      return relayUrl(cfg, "uploads").then(function (u) { return relayGet(u, "witt-uploads-v1", 2 * 60 * 1000, 20000); }).then(function (d) {
        var byTag = {}; lib.items.forEach(function (it) { byTag[tag(it.id)] = it; });
        var up = (d.up || []).filter(function (x) { return x && x[0] && x[1] && !isNaN(Date.parse(x[2])); });
        var lab = labeler(up.map(function (x) { return x[1]; }));
        var out = [];
        up.forEach(function (x) { var it = byTag[x[0]]; if (it && !it.by) { it.by = lab(x[1]); it.at = x[2]; out.push(it); } });
        /* Everything uploaded, including photos the cached library list hasn't caught up with yet (used for the "new" count). */
        out.raw = up.map(function (x) { return { by: lab(x[1]), full: String(x[1]), at: x[2] }; });
        return out;  /* newest upload first */
      });
    });
    uploadsPromise.catch(function () { uploadsPromise = null; });
    return uploadsPromise;
  }
  function uploaders() {
    return Vault.config().then(function (cfg) {
      return relayUrl(cfg, "uploaders").then(function (u) { return relayGet(u, "witt-uploaders-v1", 6 * 60 * 60 * 1000, 8000); });
    }).then(function (d) {
      var list = (d.people || []).filter(function (x) { return x && x.name && /^https:\/\//.test(String(x.url)); });
      try { localStorage.setItem("witt-uploaders", JSON.stringify(list)); } catch (e) {}
      return list;
    }, function (err) {
      /* Relay slow or down: use the list this phone saw last time, if any. */
      var keep = null; try { keep = JSON.parse(localStorage.getItem("witt-uploaders") || "null"); } catch (e) {}
      if (keep && keep.length) return keep;
      throw err;
    });
  }
  function me(name) {
    try { if (name === undefined) return localStorage.getItem("witt-me") || ""; if (name) localStorage.setItem("witt-me", name); else localStorage.removeItem("witt-me"); } catch (e) {}
    return name || "";
  }
  /* "New since your last visit" = uploads newer than the newest one this phone has already been shown on the Photos page.
     Your own uploads don't count. */
  function seenMark() { try { return localStorage.getItem("witt-seen-upload") || ""; } catch (e) { return ""; } }
  function markSeen(list) {
    var top = list && list.raw && list.raw[0] && list.raw[0].at; if (!top) return;
    try { if (top > (localStorage.getItem("witt-seen-upload") || "")) localStorage.setItem("witt-seen-upload", top); } catch (e) {}
  }
  function newCount(list, mark) {
    if (!mark || !list || !list.raw) return 0;  /* first visit: nothing is "new" yet */
    var mine = me().toLowerCase();
    return list.raw.filter(function (x) { return x.at > mark && x.full.toLowerCase() !== mine; }).length;
  }
  function ago(iso) {
    var t = Date.parse(iso); if (!t) return "";
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return "just now"; if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var d = Math.round(h / 24); if (d === 1) return "yesterday"; if (d < 7) return d + " days ago";
    return prettyDate(new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  }
  var peoplePromise = null, facesPromise = null;
  function tag(id) { return String(id).replace(/-/g, "").slice(-12); }
  function people() {
    if (peoplePromise) return peoplePromise;
    peoplePromise = Promise.all([Vault.config(), library()]).then(function (r) {
      var cfg = r[0], lib = r[1], opt = cfg.people || {};
      return relayUrl(cfg).then(function (u) { return relayGet(u, "witt-people-v2", 6 * 60 * 60 * 1000, 45000); }).then(function (data) {
        var byTag = {}; lib.items.forEach(function (it) { byTag[tag(it.id)] = it; });
        var low = function (s) { return String(s || "").toLowerCase().trim(); };
        var first = function (n) { return low(n).split(/\s+/)[0]; };
        var order = (opt.order || []).map(low), hide = (opt.hide || []).map(low), min = opt.min || 3;
        /* Same full name twice (Immich sometimes splits a person) -> one circle with both sets of photos. */
        var merged = {}, list = [];
        (data.people || []).forEach(function (p) {
          var nm = String(p.name || "").trim(); if (!nm) return;
          if (hide.indexOf(low(nm)) > -1 || hide.indexOf(first(nm)) > -1 || hide.indexOf(String(p.id)) > -1) return;
          var items = (p.a || []).map(function (x) { return byTag[x]; }).filter(Boolean);
          var m = merged[low(nm)];
          if (!m) { m = merged[low(nm)] = { id: p.id, name: nm, ids: [p.id], items: [], seen: {}, big: 0 }; list.push(m); }
          else m.ids.push(p.id);
          if (items.length > m.big) { m.big = items.length; m.id = p.id; }  /* the bigger group's face */
          items.forEach(function (it) { if (!m.seen[it.id]) { m.seen[it.id] = 1; m.items.push(it); } });
        });
        list = list.filter(function (p) { return p.items.length >= min; });
        /* Two people with the same first name show a last initial: "Mark W." */
        var firsts = {}; list.forEach(function (p) { var f = first(p.name); firsts[f] = (firsts[f] || 0) + 1; });
        list.forEach(function (p) {
          var parts = p.name.split(/\s+/);
          p.first = parts[0] + (firsts[first(p.name)] > 1 && parts[1] ? " " + parts[1].charAt(0).toUpperCase() + "." : "");
          delete p.seen; delete p.big;
        });
        /* Family order: an exact full name wins; a first name only counts when nobody else shares it. */
        var rank = function (p) { var i = order.indexOf(low(p.name)); if (i < 0 && firsts[first(p.name)] === 1) i = order.indexOf(first(p.name)); return i < 0 ? 999 : i; };
        list.sort(function (a, b) { return rank(a) - rank(b) || b.items.length - a.items.length || (a.name < b.name ? -1 : 1); });
        return list;
      });
    });
    peoplePromise.catch(function () { peoplePromise = null; });
    return peoplePromise;
  }
  function faces() {
    if (facesPromise) return facesPromise;
    facesPromise = Vault.config().then(function (cfg) {
      return relayUrl(cfg, "faces").then(function (u) { return relayGet(u, "witt-faces-v2", 6 * 60 * 60 * 1000, 30000); });
    }).then(function (d) {
      var out = {}, f = d.faces || {};
      Object.keys(f).forEach(function (k) { if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(f[k])) out[k] = f[k]; });
      return out;
    });
    facesPromise.catch(function () { facesPromise = null; });
    return facesPromise;
  }

  window.Vault = Vault;
  window.Witt = { library: library, people: people, faces: faces, uploads: uploads, uploaders: uploaders, me: me, seenMark: seenMark, markSeen: markSeen, newCount: newCount, ago: ago, src: src, libUrl: libUrl, isLib: isLib, addPhotos: addPhotos, uploadTarget: uploadTarget, wireGate: wireGate, todayNY: todayNY, dayDiff: dayDiff, prettyDate: prettyDate, thisWeekOtherYears: thisWeekOtherYears, playFilm: playFilm, familyFilm: familyFilm, ICON: ICON };
})();
