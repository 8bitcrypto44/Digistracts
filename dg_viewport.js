  // === VIEWPORT — dynamic embed height; page scroll on mobile only ===
  const EMBED_MIN_H = 680;
  const EMBED_MENU_MIN_H = 320;
  const EMBED_PLAY_MIN_H = 360;
  let embedFsActive = false;
  let embedBurstGen = 0;
  let embedMutObs = null;
  let embedPlayH = 0;
  let embedLastReportH = 0;

  function isEmbedPlayShell() {
    return isMobileEmbed() && !ROOT.classList.contains("dg-menu") && !embedFsActive;
  }

  function clearEmbedPlayLock() {
    embedPlayH = 0;
    embedLastReportH = 0;
  }

  function isMobileDevice() {
    try {
      if (window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(pointer: coarse)").matches) {
        return false;
      }
    } catch (e) {}
    var touch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    var narrow = false;
    var coarse = false;
    try {
      narrow = window.matchMedia("(max-width: 700px)").matches;
      coarse = window.matchMedia("(pointer: coarse)").matches;
    } catch (e2) {}
    return (touch && coarse) || narrow;
  }

  function isMobileEmbed() {
    return EMBED && isMobileDevice();
  }

  function syncMobileClass() {
    document.documentElement.classList.toggle("dg-mobile", isMobileDevice());
  }

  function isOverlayScrollTarget(node) {
    return node && node.closest && node.closest("#dg-overlay, .dg-menu-actions, .dg-levels");
  }

  function blockEmbedScroll(e) {
    if (!EMBED || isMobileEmbed()) return;
    if (isOverlayScrollTarget(e.target)) return;
    e.preventDefault();
  }

  function embedFloorH() {
    if (!isMobileEmbed()) return EMBED_MIN_H;
    if (ROOT.classList.contains("dg-menu")) return EMBED_MENU_MIN_H;
    return EMBED_PLAY_MIN_H;
  }

  function measureEmbedHeight() {
    if (!EMBED) return EMBED_MIN_H;
    if (isEmbedPlayShell() && embedPlayH > 0) return embedPlayH;
    const doc = document.documentElement;
    const bod = document.body;
    const stage = ROOT.querySelector(".dg-stage");
    const top = ROOT.querySelector(".dg-top");
    const controls = ROOT.querySelector(".dg-controls");
    const menuOpen = ROOT.classList.contains("dg-menu");
    const mobile = isMobileEmbed();
    [doc, bod, ROOT, stage, top, controls].forEach(function (el) {
      if (!el) return;
      el.style.height = "auto";
      el.style.minHeight = "0";
      el.style.maxHeight = "none";
    });
    const rootTop = ROOT.getBoundingClientRect().top;

    if (mobile && menuOpen) {
      let maxBottom = ROOT.getBoundingClientRect().bottom;
      [top, stage, ROOT.querySelector(".dg-help"), ROOT.querySelector("#dg-overlay")].forEach(function (el) {
        if (!el || el.hidden) return;
        if (el.offsetParent === null && !el.classList.contains("show")) return;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > maxBottom) maxBottom = r.bottom;
      });
      ROOT.querySelectorAll(".dg-menu-actions, .dg-levels").forEach(function (el) {
        if (!el || el.hidden || el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      });
      return Math.ceil(Math.max(EMBED_MENU_MIN_H, maxBottom - rootTop + 4));
    }

    if (mobile && !menuOpen) {
      let maxBottom = rootTop;
      [top, stage, controls].forEach(function (el) {
        if (!el || el.hidden || el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      });
      const h = Math.ceil(Math.max(EMBED_PLAY_MIN_H, maxBottom - rootTop + 4));
      if (isEmbedPlayShell()) embedPlayH = h;
      return h;
    }

    let maxBottom = ROOT.getBoundingClientRect().bottom;
    [top, stage, ROOT.querySelector(".dg-help"), ROOT.querySelector("#dg-overlay")].forEach(function (el) {
      if (!el || el.hidden) return;
      if (el.offsetParent === null && !el.classList.contains("show")) return;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > maxBottom) maxBottom = r.bottom;
    });
    ROOT.querySelectorAll(".dg-menu-actions, .dg-levels, .dg-controls").forEach(function (el) {
      if (!el || el.hidden || el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    });
    const bboxH = Math.ceil(Math.max(0, maxBottom - rootTop)) + 4;
    const tight = !menuOpen;
    let h;
    if (tight || mobile) {
      h = Math.ceil(Math.max(embedFloorH(), bboxH));
    } else {
      h = Math.ceil(Math.max(EMBED_MIN_H, bboxH));
    }
    if (isEmbedPlayShell()) embedPlayH = h;
    else embedPlayH = 0;
    return h;
  }

  function applyEmbedFrameHeight(h) {
    if (!EMBED) return h;
    h = Math.max(embedFloorH(), Math.round(h || measureEmbedHeight()));
    const mobile = isMobileEmbed();
    syncMobileClass();
    if (mobile && isEmbedPlayShell() && embedPlayH > 0) return h;
    [document.documentElement, document.body, ROOT].forEach(function (el) {
      if (mobile) {
        el.style.height = "auto";
        el.style.minHeight = "0";
        el.style.maxHeight = "none";
        el.style.overflowX = "hidden";
        el.style.overflowY = "visible";
        el.style.touchAction = "pan-y";
      } else {
        el.style.height = h + "px";
        el.style.minHeight = h + "px";
        el.style.maxHeight = h + "px";
        el.style.overflow = "hidden";
      }
    });
    return h;
  }

  function syncEmbedUiMode() {
    if (!EMBED) return;
    syncMobileClass();
    if (ROOT.classList.contains("dg-menu")) clearEmbedPlayLock();
    ROOT.classList.toggle("dg-ui-menu", ROOT.classList.contains("dg-menu"));
    notifyResize();
    if (isMobileEmbed() && !isEmbedPlayShell()) scheduleEmbedResizeBurst();
  }

  function flushEmbedResize(force) {
    if (!EMBED || !window.parent) return;
    try {
      const h = applyEmbedFrameHeight(measureEmbedHeight());
      if (!force && isEmbedPlayShell() && embedLastReportH > 0) {
        if (Math.abs(h - embedLastReportH) < 8) return;
        if (h > embedLastReportH + 16) return;
      }
      embedLastReportH = h;
      window.parent.postMessage({
        type: "dg-resize",
        height: h,
        mobile: isMobileEmbed()
      }, "*");
      window.parent.postMessage({
        type: "dg-mobile",
        active: isMobileEmbed()
      }, "*");
    } catch (e) {}
  }

  function scheduleEmbedResizeBurst() {
    if (!EMBED || !isMobileEmbed() || isEmbedPlayShell()) return;
    flushEmbedResize(true);
    const gen = ++embedBurstGen;
    [32, 96].forEach(function (ms) {
      setTimeout(function () {
        if (gen !== embedBurstGen) return;
        flushEmbedResize(true);
      }, ms);
    });
  }

  function bindEmbedResizeObserver() {
    if (!EMBED || !isMobileEmbed() || embedMutObs || !window.MutationObserver) return;
    let debounce = null;
    embedMutObs = new MutationObserver(function () {
      if (!ROOT.classList.contains("dg-menu")) return;
      clearTimeout(debounce);
      debounce = setTimeout(function () { flushEmbedResize(true); }, 48);
    });
    embedMutObs.observe(ROOT, { childList: true, subtree: true, attributes: true });
  }

  function onFsStateMsg(active) {
    embedFsActive = !!active;
    if (embedFsActive) clearEmbedPlayLock();
    syncEmbedUiMode();
  }

  var notifyResize = function () {
    if (!EMBED || !window.parent) return;
    flushEmbedResize(true);
    if (!isEmbedPlayShell() || embedPlayH <= 0) {
      requestAnimationFrame(function () { flushEmbedResize(true); });
    }
  };

  if (EMBED) {
    syncMobileClass();
    applyEmbedFrameHeight(measureEmbedHeight());
    bindEmbedResizeObserver();
    document.addEventListener("wheel", blockEmbedScroll, { passive: false });
    document.addEventListener("touchmove", blockEmbedScroll, { passive: false });
    window.addEventListener("resize", function () {
      if (isEmbedPlayShell()) clearEmbedPlayLock();
      syncEmbedUiMode();
    });
    window.addEventListener("orientationchange", function () {
      clearEmbedPlayLock();
      setTimeout(syncEmbedUiMode, 160);
    });
  } else {
    syncMobileClass();
    window.addEventListener("resize", syncMobileClass);
    window.addEventListener("orientationchange", function () {
      setTimeout(syncMobileClass, 160);
    });
  }

  var _showOverlayVp = showOverlay;
  showOverlay = function (title, sub, btn, opts) {
    _showOverlayVp(title, sub, btn, opts);
    syncEmbedUiMode();
  };

  var _hideOverlayVp = hideOverlay;
  hideOverlay = function () {
    _hideOverlayVp();
    syncEmbedUiMode();
  };

  var _fitVp = fit;
  fit = function () {
    _fitVp();
    if (EMBED && !isEmbedPlayShell()) notifyResize();
  };

  window.addEventListener("message", function (e) {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "dg-fs-state") onFsStateMsg(e.data.active);
    if (e.data.type === "dg-request-resize") {
      if (isEmbedPlayShell() && embedPlayH > 0) {
        flushEmbedResize(true);
        return;
      }
      flushEmbedResize(true);
      scheduleEmbedResizeBurst();
    }
  });

  if (EMBED) {
    syncEmbedUiMode();
    scheduleEmbedResizeBurst();
  }
