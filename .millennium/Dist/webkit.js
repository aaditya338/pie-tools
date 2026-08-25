// PieTools button injection (standalone plugin)

// ============================================
// GAMEPAD NAVIGATION SYSTEM - Inline Version
// ============================================
(function () {
  "use strict";

  // Inject gamepad navigation CSS
  const gamepadCSS = document.createElement("style");
  gamepadCSS.id = "gamepad-navigation-styles";
  gamepadCSS.textContent = `
        .active-focus {
            outline: 3px solid #31D0FC !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 0 4px rgba(49, 208, 252, 0.3),
                        0 0 12px rgba(49, 208, 252, 0.5) !important;
            position: relative !important;
            z-index: 9999 !important;
            transition: outline 0.15s ease, box-shadow 0.15s ease !important;
        }

        @keyframes gamepad-focus-pulse {
            0%, 100% {
                box-shadow: 0 0 0 4px rgba(49, 208, 252, 0.3),
                            0 0 12px rgba(49, 208, 252, 0.5);
            }
            50% {
                box-shadow: 0 0 0 4px rgba(49, 208, 252, 0.5),
                            0 0 16px rgba(49, 208, 252, 0.7);
            }
        }

        .active-focus {
            animation: gamepad-focus-pulse 1.5s ease-in-out infinite;
        }

        button.active-focus,
        a.active-focus {
            background-color: rgba(49, 208, 252, 0.15) !important;
            transform: scale(1.02);
        }

        .BasicUI .active-focus,
        .touch .active-focus {
            outline-width: 4px !important;
            outline-offset: 3px !important;
        }

        input.active-focus,
        select.active-focus,
        textarea.active-focus {
            border-color: #31D0FC !important;
            background-color: rgba(49, 208, 252, 0.1) !important;
        }

        .active-focus:focus {
            outline: 3px solid #31D0FC !important;
        }

        button,
        a,
        input,
        select,
        textarea,
        .focusable {
            transition: transform 0.15s ease, background-color 0.15s ease !important;
        }

        .PieTools-button.active-focus,
        .PieTools-restart-button.active-focus {
            transform: scale(1.05) !important;
            background: linear-gradient(135deg, rgba(49, 208, 252, 0.3), rgba(49, 208, 252, 0.2)) !important;
        }

        .btnv6_blue_hoverfade.active-focus {
            background: linear-gradient(to right, #0E43F4 5%, #31D0FC 95%) !important;
        }

        .active-focus {
            scroll-margin: 20px;
        }
    `;
  document.head.appendChild(gamepadCSS);

  // Gamepad Navigation System
  // ALL PieTools overlays that should block Steam navigation
  const OVERLAY_SELECTORS = [
    ".PieTools-overlay",
    ".PieTools-settings-overlay",
    ".PieTools-fixes-results-overlay",
    ".PieTools-loading-fixes-overlay",
    ".PieTools-unfix-overlay",
    ".PieTools-settings-manager-overlay",
    ".PieTools-alert-overlay",
    ".PieTools-confirm-overlay",
    ".PieTools-loadedapps-overlay",
  ];
  const OVERLAY_SELECTOR_STRING = OVERLAY_SELECTORS.join(", ");

  const CONFIG = {
    deadzone: 0.4, // Increased from 0.3 to prevent unwanted drift
    debounceTime: 200,
    pollRate: 16,
    stickThreshold: 0.7, // Increased threshold for stick navigation
    buttonMap: {
      A: 0,
      B: 1,
      X: 2,
      Y: 3,
      LB: 4,
      RB: 5,
      LT: 6,
      RT: 7,
      SELECT: 8,
      START: 9,
      L3: 10,
      R3: 11,
      DPAD_UP: 12,
      DPAD_DOWN: 13,
      DPAD_LEFT: 14,
      DPAD_RIGHT: 15,
    },
    axesMap: {
      LEFT_STICK_X: 0,
      LEFT_STICK_Y: 1,
      RIGHT_STICK_X: 2,
      RIGHT_STICK_Y: 3,
    },
  };

  const state = {
    gamepadConnected: false,
    gamepadIndex: null,
    focusableElements: [],
    currentFocusIndex: 0,
    lastNavigationTime: 0,
    lastAxisValues: {
      x: 0,
      y: 0,
    },
    buttonStates: {},
    animationFrameId: null,
  };

  // duplicated from main code thing for reliability
  function isBigPictureMode() {
    if (typeof window.__PieTools_IS_BIG_PICTURE__ !== "undefined") {
      return window.__PieTools_IS_BIG_PICTURE__;
    }
    const htmlClasses = document.documentElement.className;
    const userAgent = navigator.userAgent;
    let score = 0;
    if (htmlClasses.includes("BasicUI")) score += 3;
    if (htmlClasses.includes("DesktopUI")) score -= 3;
    if (userAgent.includes("Valve Steam Gamepad")) score += 2;
    if (userAgent.includes("Valve Steam Client")) score -= 2;
    if (htmlClasses.includes("touch")) score += 1;
    return score > 0;
  }

  // B button handler removed - users should use the modal buttons directly
  // This prevents conflicts with Steam's back navigation
  let onBackHandler = function () {
    console.log(
      "[Gamepad] B button pressed - ignoring (use modal buttons instead)",
    );
    // Do nothing - let users navigate with D-pad/stick and press A on Cancel/Back buttons
  };

  function onGamepadConnected(event) {
    console.log("[Gamepad] Gamepad conectado en Millennium:", event.gamepad.id);
    state.gamepadConnected = true;
    state.gamepadIndex = event.gamepad.index;
    if (!state.animationFrameId) {
      pollGamepad();
    }
    // Don't scan immediately - only scan when an overlay is opened
    // scanFocusableElements() will be called by the overlay's setTimeout
  }

  function onGamepadDisconnected(event) {
    console.log("[Gamepad] Gamepad disconnected:", event.gamepad.id);
    if (state.gamepadIndex === event.gamepad.index) {
      state.gamepadConnected = false;
      state.gamepadIndex = null;
      if (state.animationFrameId) {
        cancelAnimationFrame(state.animationFrameId);
        state.animationFrameId = null;
      }
    }
  }

  function scanFocusableElements() {
    if (!isBigPictureMode()) return;

    // Only scan if there's a PieTools overlay active
    const activeOverlay = document.querySelector(OVERLAY_SELECTOR_STRING);

    if (!activeOverlay) {
      console.log("[Gamepad] No PieTools overlay active, skipping scan");
      state.focusableElements = [];
      state.currentFocusIndex = 0;
      return;
    }

    // Only scan elements INSIDE the active overlay
    const selectors = [
      "button:not([disabled])",
      "a[href]:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex="0"]',
      '[tabindex]:not([tabindex="-1"])',
      ".focusable:not([disabled])",
    ].join(", ");

    // Use querySelectorAll on the overlay, not the whole document
    const elements = Array.from(activeOverlay.querySelectorAll(selectors));
    state.focusableElements = elements.filter(function (el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    });

    console.log(
      "[Gamepad] Scanned " +
      state.focusableElements.length +
      " focusable elements inside overlay",
    );

    if (state.focusableElements.length > 0) {
      focusElement(0);
    }
  }

  function focusElement(index) {
    const prevElement = state.focusableElements[state.currentFocusIndex];
    if (prevElement) {
      prevElement.blur();
      prevElement.classList.remove("active-focus");
    }

    if (index < 0) index = 0;
    if (index >= state.focusableElements.length)
      index = state.focusableElements.length - 1;

    state.currentFocusIndex = index;

    const element = state.focusableElements[index];
    if (element) {
      element.focus();
      element.classList.add("active-focus");
      element.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
      console.log("[Gamepad] Focused element " + index + ":", element);
    }
  }

  function navigate(direction) {
    const now = Date.now();
    if (now - state.lastNavigationTime < CONFIG.debounceTime) {
      return;
    }
    state.lastNavigationTime = now;

    if (state.focusableElements.length === 0) {
      scanFocusableElements();
      return;
    }

    let newIndex = state.currentFocusIndex;

    switch (direction) {
      case "up":
        newIndex--;
        break;
      case "down":
        newIndex++;
        break;
      case "left":
        newIndex = findElementInDirection("left");
        break;
      case "right":
        newIndex = findElementInDirection("right");
        break;
    }

    if (newIndex < 0) newIndex = state.focusableElements.length - 1;
    if (newIndex >= state.focusableElements.length) newIndex = 0;

    focusElement(newIndex);
  }

  function findElementInDirection(direction) {
    const currentElement = state.focusableElements[state.currentFocusIndex];
    if (!currentElement) return state.currentFocusIndex;

    const currentRect = currentElement.getBoundingClientRect();
    let closestIndex = state.currentFocusIndex;
    let closestDistance = Infinity;

    state.focusableElements.forEach(function (el, index) {
      if (index === state.currentFocusIndex) return;

      const rect = el.getBoundingClientRect();
      let isInDirection = false;
      let distance = 0;

      if (direction === "left") {
        isInDirection = rect.right <= currentRect.left;
        distance = currentRect.left - rect.right;
      } else if (direction === "right") {
        isInDirection = rect.left >= currentRect.right;
        distance = rect.left - currentRect.right;
      }

      if (isInDirection && distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }

  function handleButtonPress(buttonIndex) {
    const element = state.focusableElements[state.currentFocusIndex];

    switch (buttonIndex) {
      case CONFIG.buttonMap.A:
        if (element) {
          console.log("[Gamepad] A button: clicking element", element);
          element.click();
          setTimeout(scanFocusableElements, 100);
        }
        break;

      case CONFIG.buttonMap.B:
        // B button disabled - users should use modal buttons
        console.log("[Gamepad] B button pressed - ignoring");
        break;

      case CONFIG.buttonMap.DPAD_UP:
        navigate("up");
        break;

      case CONFIG.buttonMap.DPAD_DOWN:
        navigate("down");
        break;

      case CONFIG.buttonMap.DPAD_LEFT:
        navigate("left");
        break;

      case CONFIG.buttonMap.DPAD_RIGHT:
        navigate("right");
        break;
    }
  }

  function pollGamepad() {
    if (!state.gamepadConnected) {
      state.animationFrameId = null;
      return;
    }

    // Check if there's an active PieTools overlay
    const hasActiveOverlay = document.querySelector(OVERLAY_SELECTOR_STRING);

    // If no overlay is active, skip input processing but keep polling
    if (!hasActiveOverlay) {
      state.animationFrameId = requestAnimationFrame(pollGamepad);
      return;
    }

    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[state.gamepadIndex];

    if (!gamepad) {
      state.animationFrameId = requestAnimationFrame(pollGamepad);
      return;
    }

    // Buttons
    gamepad.buttons.forEach(function (button, index) {
      const wasPressed = state.buttonStates[index] || false;
      const isPressed = button.pressed;

      if (isPressed && !wasPressed) {
        handleButtonPress(index);
      }

      state.buttonStates[index] = isPressed;
    });

    // Left stick
    const axisX = gamepad.axes[CONFIG.axesMap.LEFT_STICK_X] || 0;
    const axisY = gamepad.axes[CONFIG.axesMap.LEFT_STICK_Y] || 0;

    const x = Math.abs(axisX) > CONFIG.deadzone ? axisX : 0;
    const y = Math.abs(axisY) > CONFIG.deadzone ? axisY : 0;

    const now = Date.now();
    const threshold = CONFIG.stickThreshold; // Use higher threshold (0.7)
    if (now - state.lastNavigationTime >= CONFIG.debounceTime) {
      if (y < -threshold && state.lastAxisValues.y >= -threshold) {
        navigate("up");
      } else if (y > threshold && state.lastAxisValues.y <= threshold) {
        navigate("down");
      } else if (x < -threshold && state.lastAxisValues.x >= -threshold) {
        navigate("left");
      } else if (x > threshold && state.lastAxisValues.x <= threshold) {
        navigate("right");
      }
    }

    state.lastAxisValues.x = x;
    state.lastAxisValues.y = y;

    state.animationFrameId = requestAnimationFrame(pollGamepad);
  }

  // Disabled: MutationObserver was causing unwanted auto-scanning
  // Only manual scanElements() calls from overlay setTimeout will trigger scans
  /*
    const observer = new MutationObserver(function(mutations) {
        clearTimeout(observer.rescanTimeout);
        observer.rescanTimeout = setTimeout(function() {
            if (state.gamepadConnected) {
                scanFocusableElements();
            }
        }, 300);
    });
    */

  // Block Steam's gamepad navigation when overlay is active
  function blockSteamNavigation(event) {
    const hasActiveOverlay = document.querySelector(OVERLAY_SELECTOR_STRING);

    if (hasActiveOverlay && state.gamepadConnected) {
      // Block arrow keys, Enter, Escape, Backspace and other navigation keys
      // Note: Steam may translate gamepad B button to Escape or Backspace
      const navKeys = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        "Escape",
        "Backspace",
        " ",
        "Tab",
      ];
      if (navKeys.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        console.log("[Gamepad] Blocked Steam navigation key:", event.key);
        return false;
      }
    }
  }

  // Block clicks on Steam UI when overlay is active
  function blockSteamClicks(event) {
    const hasActiveOverlay = document.querySelector(OVERLAY_SELECTOR_STRING);

    if (hasActiveOverlay && state.gamepadConnected) {
      // Only allow clicks inside the overlay
      const clickedInsideOverlay = event.target.closest(
        OVERLAY_SELECTOR_STRING,
      );

      if (!clickedInsideOverlay) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        console.log("[Gamepad] Blocked click outside overlay");
        return false;
      }
    }
  }

  // Block browser history navigation when overlay is active
  function blockHistoryNavigation(event) {
    const hasActiveOverlay = document.querySelector(OVERLAY_SELECTOR_STRING);
    if (hasActiveOverlay && state.gamepadConnected) {
      console.log("[Gamepad] Blocked history navigation (popstate)");
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // Push the current state back to prevent navigation
      window.history.pushState(null, "", window.location.href);
      return false;
    }
  }

  function init() {
    if (!isBigPictureMode()) {
      console.log("[Gamepad] Not in Big Picture Mode, skipping initialization");
      return;
    }

    console.log("[Gamepad] Initializing Gamepad Navigation System...");

    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);

    // Block Steam's keyboard navigation when overlay is active
    document.addEventListener("keydown", blockSteamNavigation, true);
    document.addEventListener("keyup", blockSteamNavigation, true);

    // Block clicks outside overlay when gamepad is active
    document.addEventListener("click", blockSteamClicks, true);
    document.addEventListener("mousedown", blockSteamClicks, true);

    // Block browser history navigation (back button)
    window.addEventListener("popstate", blockHistoryNavigation, true);

    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        onGamepadConnected({
          gamepad: gamepads[i],
        });
        break;
      }
    }

    // Disabled: MutationObserver auto-scanning
    /*
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        */

    // Don't scan on init - only scan when overlays are opened
    // scanFocusableElements();

    console.log("[Gamepad] Initialization complete");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.GamepadNav = {
    scanElements: scanFocusableElements,
    setBackHandler: function (fn) {
      if (typeof fn === "function") {
        onBackHandler = fn;
      }
    },
    focusElement: focusElement,
    getCurrentIndex: function () {
      return state.currentFocusIndex;
    },
    getElements: function () {
      return state.focusableElements;
    },
    isConnected: function () {
      return state.gamepadConnected;
    },
  };
})();

// ============================================
// PieTools MAIN CODE
// ============================================
(function () {
  "use strict";

  // Big Picture Mode Detector - Multi-method system for maximum reliability
  function isBigPictureMode() {
    const htmlClasses = document.documentElement.className;
    const userAgent = navigator.userAgent;

    // METHOD 1: HTML Classes
    // Big Picture: 'BasicUI' + 'touch'
    // Normal Mode: 'DesktopUI' (without 'touch')
    const hasBigPictureClass = htmlClasses.includes("BasicUI");
    const hasDesktopClass = htmlClasses.includes("DesktopUI");
    const hasTouchClass = htmlClasses.includes("touch");

    // METHOD 2: User Agent
    // Big Picture: 'Valve Steam Gamepad'
    // Normal Mode: 'Valve Steam Client'
    const isGamepadUA = userAgent.includes("Valve Steam Gamepad");
    const isClientUA = userAgent.includes("Valve Steam Client");

    // Scoring system: each indicator adds points
    let bigPictureScore = 0;

    // BasicUI/DesktopUI class (weight: 3 points - highly reliable)
    if (hasBigPictureClass) bigPictureScore += 3;
    if (hasDesktopClass) bigPictureScore -= 3;

    // User Agent (weight: 2 points - reliable)
    if (isGamepadUA) bigPictureScore += 2;
    if (isClientUA) bigPictureScore -= 2;

    // Touch class (weight: 1 point - additional indicator)
    if (hasTouchClass) bigPictureScore += 1;

    // Positive score = Big Picture, negative/zero = Normal
    const isBigPicture = bigPictureScore > 0;

    return isBigPicture;
  }

  // Detect and save mode at startup
  window.__PieTools_IS_BIG_PICTURE__ = isBigPictureMode();

  // Start Achievements background poller
  try {
    startAchievementsPoller();
  } catch (err) {
    backendLog("Failed to start achievements poller: " + err);
  }

  // Forward logs to Millennium backend so they appear in the dev console
  function backendLog(message) {
    try {
      if (
        typeof Millennium !== "undefined" &&
        typeof Millennium.callServerMethod === "function"
      ) {
        Millennium.callServerMethod("PieTools", "Logger.log", {
          message: String(message),
        });
      }
    } catch (err) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[PieTools] backendLog failed", err);
      }
    }
  }

  backendLog("PieTools script loaded");
  backendLog(
    "Mode Detection: " +
    (window.__PieTools_IS_BIG_PICTURE__ ? "BIG PICTURE MODE" : "NORMAL MODE"),
  );
  // anti-spam state
  const logState = {
    missingOnce: false,
    existsOnce: false,
  };
  // click/run debounce state
  const runState = {
    inProgress: false,
    appid: null,
  };

  // Games Database - backend handles caching
  function fetchGamesDatabase() {
    if (
      typeof Millennium === "undefined" ||
      typeof Millennium.callServerMethod !== "function"
    ) {
      return Promise.resolve({});
    }
    return Millennium.callServerMethod("PieTools", "GetGamesDatabase", {
      contentScriptQuery: "",
    })
      .then(function (res) {
        var payload = (res && (res.result || res.value)) || res;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch (e) { }
        }
        return payload || {};
      })
      .catch(function (err) {
        console.warn("[PieTools] Failed to fetch games database", err);
        return {};
      });
  }

  // Fixes - backend handles caching
  function fetchFixes(appid) {
    if (
      typeof Millennium === "undefined" ||
      typeof Millennium.callServerMethod !== "function"
    ) {
      return Promise.resolve(null);
    }
    return Millennium.callServerMethod("PieTools", "CheckForFixes", {
      appid: appid,
      contentScriptQuery: "",
    })
      .then(function (res) {
        const payload = typeof res === "string" ? JSON.parse(res) : res;
        return payload && payload.success ? payload : null;
      })
      .catch(function (err) {
        console.warn("[PieTools] Failed to fetch fixes", err);
        return null;
      });
  }

  // Cache for game names fetched from Steam API
  const steamGameNameCache = {};
  // Track in-flight promises so we don't fire duplicate requests for the same appid
  const steamGameNameInFlight = {};
  // Throttle: max 2 concurrent fetch calls to avoid overwhelming Millennium's network interceptor
  let _steamFetchActive = 0;
  const _steamFetchQueue = [];
  const _STEAM_FETCH_CONCURRENCY = 2;

  function _runSteamFetchQueue() {
    if (_steamFetchActive >= _STEAM_FETCH_CONCURRENCY || _steamFetchQueue.length === 0) return;
    const { appid, resolve, reject } = _steamFetchQueue.shift();
    _steamFetchActive++;
    fetch(
      "https://store.steampowered.com/api/appdetails?appids=" + appid + "&filters=basic"
    )
      .then(function (res) { return res.json(); })
      .then(function (data) {
        let name = null;
        if (data && data[appid] && data[appid].success && data[appid].data && data[appid].data.name) {
          name = data[appid].data.name;
          steamGameNameCache[appid] = name;
        }
        resolve(name);
      })
      .catch(function (err) {
        resolve(null);
      })
      .finally(function () {
        _steamFetchActive--;
        delete steamGameNameInFlight[appid];
        _runSteamFetchQueue();
      });
  }

  /**
   * get game name separately without cached full appid
   * @param {number|string} appid
   * @returns {Promise<string|null>}
   */
  function fetchSteamGameName(appid) {
    if (!appid) return Promise.resolve(null);
    if (steamGameNameCache[appid]) return Promise.resolve(steamGameNameCache[appid]);
    // Deduplicate: return the same promise if already in-flight
    if (steamGameNameInFlight[appid]) return steamGameNameInFlight[appid];

    const promise = new Promise(function (resolve, reject) {
      _steamFetchQueue.push({ appid: appid, resolve: resolve, reject: reject });
      _runSteamFetchQueue();
    });
    steamGameNameInFlight[appid] = promise;
    return promise;
  }

  const TRANSLATION_PLACEHOLDER = "translation missing";

  function applyTranslationBundle(bundle) {
    if (!bundle || typeof bundle !== "object") return;
    const stored = window.__PieToolsI18n || {};
    if (bundle.language) {
      stored.language = String(bundle.language);
    } else if (!stored.language) {
      stored.language = "en";
    }
    if (bundle.strings && typeof bundle.strings === "object") {
      stored.strings = bundle.strings;
    } else if (!stored.strings) {
      stored.strings = {};
    }
    if (Array.isArray(bundle.locales)) {
      stored.locales = bundle.locales;
    } else if (!Array.isArray(stored.locales)) {
      stored.locales = [];
    }
    stored.ready = true;
    stored.lastFetched = Date.now();
    window.__PieToolsI18n = stored;
  }

  // Theme definitions (pulled from themes.json; inline only used as fallback)
  const DEFAULT_THEMES = {
    original: {
      name: "PieTools Cyan",
      bgPrimary: "#0b1120",
      bgSecondary: "#1e293b",
      bgTertiary: "rgba(15, 23, 42, 0.86)",
      bgHover: "rgba(30, 41, 59, 0.86)",
      bgContainer: "rgba(15, 23, 42, 0.6)",
      bgContainerGradient: "rgba(15, 23, 42, 0.85), #0b1120",
      accent: "#31D0FC",
      accentLight: "#7DD4FF",
      accentDark: "#0E43F4",
      border: "rgba(49, 208, 252, 0.3)",
      borderHover: "rgba(49, 208, 252, 0.8)",
      text: "#ffffff",
      textSecondary: "#94a3b8",
      gradient: "linear-gradient(135deg, #31D0FC 0%, #0E43F4 30%, #3D10F6 65%, #AE29FB 100%)",
      gradientLight: "linear-gradient(135deg, #31D0FC 0%, #7DD4FF 100%)",
      shadow: "rgba(49, 208, 252, 0.35)",
      shadowHover: "rgba(49, 208, 252, 0.6)",
    },
  };

  // Runtime THEMES map - start with fallback, then hydrate from themes.json/backend.
  let THEMES = DEFAULT_THEMES;
  let themesLoaded = false;

  function normalizeThemesPayload(input) {
    try {
      let payload = input;
      if (typeof payload === "string") payload = JSON.parse(payload);
      if (payload && typeof payload === "object") {
        if (Array.isArray(payload.themes)) return payload.themes;
        if (Array.isArray(payload.result)) return payload.result;
        if (payload.result && Array.isArray(payload.result.themes))
          return payload.result.themes;
        if (Array.isArray(payload.value)) return payload.value;
      }
      if (Array.isArray(payload)) return payload;
    } catch (_) {
      /* ignore */
    }
    return [];
  }

  function _applyBackendThemes(themesArray) {
    try {
      const themes = normalizeThemesPayload(themesArray);
      if (!Array.isArray(themes) || themes.length === 0) return;
      const map = {};
      themes.forEach(function (t) {
        if (!t || (!t.value && !t.key)) return;
        const key = t.value || t.key;
        map[key] = Object.assign({}, t, {
          value: key,
          name: t.name || key,
        });
      });
      if (Object.keys(map).length === 0) return;
      // Merge into existing THEMES if themes have been loaded, otherwise start from DEFAULT_THEMES
      THEMES = Object.assign({}, themesLoaded ? THEMES : DEFAULT_THEMES, map);
      themesLoaded = true;
      try {
        ensurePieToolsStyles();
      } catch (_) { }
    } catch (e) {
      console.warn("Failed to apply backend themes", e);
    }
  }

  function loadThemesFromFile() {
    try {
      return fetch("themes/themes.json", {
        cache: "no-store",
      })
        .then(function (res) {
          if (!res || !res.ok) return null;
          return res.json();
        })
        .then(function (json) {
          if (!json) return null;
          _applyBackendThemes(json);
          return json;
        })
        .catch(function () {
          return null;
        });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function loadThemesFromBackend() {
    if (
      typeof Millennium === "undefined" ||
      typeof Millennium.callServerMethod !== "function"
    ) {
      return Promise.resolve(null);
    }
    return Millennium.callServerMethod("PieTools", "GetThemes", {
      contentScriptQuery: "",
    })
      .then(function (res) {
        try {
          const payload = typeof res === "string" ? JSON.parse(res) : res;
          if (payload && payload.success && payload.themes) {
            _applyBackendThemes(payload.themes);
            return payload.themes;
          }
        } catch (_) { }
        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function loadThemes() {
    return Promise.all([loadThemesFromFile(), loadThemesFromBackend()]).catch(
      function () {
        /* ignore */
      },
    );
  }

  // Trigger load (non-blocking). Keeps DEFAULT_THEMES as a safe fallback.
  const themeLoadPromise = loadThemes();

  function getCurrentThemeKey() {
    try {
      const settings = window.__PieToolsSettings || {};
      const themeKey = (settings.values || {}).general || {};
      return themeKey.theme || "original";
    } catch (e) {
      return "original";
    }
  }

  function getCurrentTheme() {
    try {
      const themeName = getCurrentThemeKey();
      const theme = THEMES[themeName] || THEMES.original;
      if (!THEMES[themeName]) {
        try {
          backendLog(
            "PieTools: Theme " +
            themeName +
            " not found in THEMES, using original. Available: " +
            Object.keys(THEMES).join(", "),
          );
        } catch (_) { }
      }
      return theme;
    } catch (e) {
      return THEMES.original;
    }
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
      : [49, 208, 252];
  }

  function getThemeColors() {
    const theme = getCurrentTheme();
    const rgb = hexToRgb(theme.accent);
    return {
      modalBg: `linear-gradient(135deg, ${theme.bgPrimary} 0%, ${theme.bgSecondary} 100%)`,
      border: theme.accent,
      borderRgba: theme.border,
      text: theme.text,
      textSecondary: theme.textSecondary,
      accent: theme.accent,
      accentLight: theme.accentLight,
      gradient: theme.gradient,
      gradientLight: theme.gradientLight,
      shadow: theme.shadow,
      shadowHover: theme.shadowHover,
      shadowRgba: theme.shadow.replace("0.4", "0.3"),
      bgContainer: theme.bgContainer,
      bgTertiary: theme.bgTertiary,
      bgHover: theme.bgHover,
      rgbString: rgb.join(","),
    };
  }

  function generateThemeStyles(theme) {
    return `
            /* Force overlay backdrops to follow the active theme (overrides inline styles) */
            .PieTools-settings-overlay,
            .PieTools-overlay,
            .PieTools-fixes-results-overlay,
            .PieTools-loading-fixes-overlay,
            .PieTools-unfix-overlay,
            .PieTools-settings-manager-overlay,
            .PieTools-loadedapps-overlay {
                background: rgba(${theme.rgbString}, 0.12) !important;
                backdrop-filter: blur(8px) !important;
            }

            /* Prefer overlay-scoped select rules to override theme CSS files */
            .PieTools-settings-overlay select,
            .PieTools-settings-manager-overlay select,
            .PieTools-overlay select,
            .PieTools-fixes-results-overlay select,
            .PieTools-loadedapps-overlay select {
                background-color: ${theme.bgTertiary} !important;
                color: ${theme.text} !important;
                border: 1px solid ${theme.border} !important;
                border-radius: 3px !important;
                padding: 6px 8px !important;
                font-size: 14px !important;
            }
            .PieTools-settings-overlay select option,
            .PieTools-settings-manager-overlay select option,
            .PieTools-overlay select option,
            .PieTools-fixes-results-overlay select option,
            .PieTools-loadedapps-overlay select option {
                background-color: ${theme.bgPrimary} !important;
                color: ${theme.text} !important;
            }
            .PieTools-settings-overlay select option:checked,
            .PieTools-settings-manager-overlay select option:checked,
            .PieTools-overlay select option:checked,
            .PieTools-fixes-results-overlay select option:checked,
            .PieTools-loadedapps-overlay select option:checked {
                background: ${theme.accent} !important;
                color: ${theme.text} !important;
            }
            .PieTools-settings-overlay select:hover,
            .PieTools-settings-manager-overlay select:hover,
            .PieTools-overlay select:hover,
            .PieTools-fixes-results-overlay select:hover,
            .PieTools-loadedapps-overlay select:hover {
                border-color: ${theme.borderHover} !important;
            }
            .PieTools-settings-overlay select:focus,
            .PieTools-settings-manager-overlay select:focus,
            .PieTools-overlay select:focus,
            .PieTools-fixes-results-overlay select:focus,
            .PieTools-loadedapps-overlay select:focus {
                outline: none !important;
                border-color: ${theme.accent} !important;
                box-shadow: 0 0 0 2px ${theme.shadow} !important;
            }
            .PieTools-btn {
                padding: 12px 24px;
                background: rgba(49, 208, 252, 0.15) !important;
                border: 2px solid rgba(49, 208, 252, 0.4) !important;
                border-radius: 12px;
                color: ${theme.text};
                font-size: 15px;
                font-weight: 600;
                text-decoration: none;
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                cursor: pointer;
                box-shadow: 0 0 8px rgba(49, 208, 252, 0.4) !important;
                letter-spacing: 0.3px;
            }
            .PieTools-btn:hover:not([data-disabled="1"]) {
                background: rgba(49, 208, 252, 0.3) !important;
                transform: translateY(-2px);
                box-shadow: 0 6px 20px ${theme.shadowHover};
                border-color: #0E43F4 !important;
            }
            .PieTools-btn.primary {
                background: ${theme.gradient};
                border-color: ${theme.borderHover.replace("0.8", "0.8")};
                color: ${theme.text};
                font-weight: 700;
                box-shadow: 0 4px 15px ${theme.shadow}, inset 0 1px 0 rgba(255,255,255,0.3);
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            }
            .PieTools-btn.primary:hover:not([data-disabled="1"]) {
                background: ${theme.gradientLight};
                transform: translateY(-3px) scale(1.03);
                box-shadow: 0 8px 25px rgba(26, 159, 255, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4);
            }

            /* Modern Toggle Switch */
            .PieTools-toggle-container {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
            }
            .PieTools-toggle-label-wrap {
                display: flex;
                flex-direction: column;
                gap: 4px;
                flex: 1;
                margin-right: 20px;
            }
            .PieTools-toggle {
                position: relative;
                display: inline-block;
                width: 50px;
                height: 26px;
                flex-shrink: 0;
            }
            .PieTools-toggle input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .PieTools-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(255, 255, 255, 0.1);
                transition: .4s;
                border-radius: 34px;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .PieTools-slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background-color: #ffffff;
                transition: .4s;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            input:checked + .PieTools-slider {
                background-color: #31D0FC;
                border-color: #31D0FC;
            }
            input:checked + .PieTools-slider:before {
                transform: translateX(24px);
            }
            .PieTools-slider:hover {
                border-color: #31D0FC;
            }

            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: scale(0.9);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            /* Store header button - PieTools themed icon button */
            button.PieTools-header-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                align-self: center;
                width: 36px;
                height: 36px;
                padding: 0;
                border: 2px solid rgba(49, 208, 252, 0.4) !important;
                border-radius: 4px;
                background: rgba(49, 208, 252, 0.15) !important;
                color: ${theme.text};
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                box-shadow: 0 0 8px rgba(49, 208, 252, 0.4) !important;
                margin-left: 12px;
            }
            button.PieTools-header-button:hover, button.PieTools-header-button.Focusable:hover, button.PieTools-header-button.Focusable:focus {
                background: rgba(49, 208, 252, 0.3) !important;
                transform: translateY(-1px);
                box-shadow: 0 0 15px rgba(49, 208, 252, 0.6) !important;
                border-color: #0E43F4 !important;
            }
            button.PieTools-header-button:focus-visible {
                outline: 2px solid ${theme.accent};
                outline-offset: 2px;
            }
            button.PieTools-header-button img,
            button.PieTools-header-button svg {
                height: 16px;
                width: 16px;
            }

            .PieTools-achievements-overlay {
                background: rgba(${theme.rgbString}, 0.12) !important;
                backdrop-filter: blur(8px) !important;
            }
            .PieTools-ach-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 12px;
                margin-top: 16px;
                padding-right: 4px;
            }
            .PieTools-ach-card {
                display: flex;
                align-items: center;
                gap: 12px;
                background: rgba(${theme.rgbString}, 0.05);
                border: 1px solid ${theme.borderRgba};
                border-radius: 10px;
                padding: 10px 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                user-select: none;
            }
            .PieTools-ach-card:hover {
                background: rgba(${theme.rgbString}, 0.15);
                border-color: ${theme.accent};
                transform: translateY(-1px);
            }
            .PieTools-ach-card.unlocked {
                border-color: rgba(92, 156, 62, 0.4);
                background: linear-gradient(135deg, rgba(92, 156, 62, 0.1) 0%, rgba(92, 156, 62, 0.03) 100%);
            }
            .PieTools-ach-card.unlocked:hover {
                border-color: rgba(92, 156, 62, 0.8);
                background: linear-gradient(135deg, rgba(92, 156, 62, 0.2) 0%, rgba(92, 156, 62, 0.06) 100%);
            }
            .PieTools-toast-container {
                position: fixed;
                bottom: 24px;
                right: 24px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                z-index: 100000;
                pointer-events: none;
            }
            .PieTools-toast {
                display: flex;
                align-items: center;
                gap: 16px;
                width: 320px;
                padding: 14px 18px;
                background: rgba(30, 30, 50, 0.95);
                border: 1px solid rgba(49, 208, 252, 0.5);
                border-radius: 10px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 15px rgba(49, 208, 252, 0.25);
                backdrop-filter: blur(10px);
                animation: slideIn 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards;
                pointer-events: auto;
            }
            .PieTools-toast.fade-out {
                animation: slideOut 0.35s cubic-bezier(0.25, 1, 0.5, 1) forwards;
            }
            @keyframes slideIn {
                from { transform: translateX(120%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(120%); opacity: 0; }
            }
        `;
  }

  function ensureThemeStylesheet(themeKey) {
    const id = "PieTools-theme-css";
    const href = "themes/" + themeKey + ".css";
    const link = document.getElementById(id);
    if (link) {
      const currentTheme = link.getAttribute("data-theme");
      if (currentTheme === themeKey) return;
      link.href = href;
      link.setAttribute("data-theme", themeKey);
      return;
    }
    try {
      const el = document.createElement("link");
      el.id = id;
      el.rel = "stylesheet";
      el.href = href;
      el.setAttribute("data-theme", themeKey);
      document.head.appendChild(el);
    } catch (err) {
      backendLog("PieTools: Theme CSS injection failed: " + err);
    }
  }

  function ensurePieToolsStyles() {
    const styleEl = document.getElementById("PieTools-styles");
    const themeKey = getCurrentThemeKey();
    const theme = getCurrentTheme();
    const styles = generateThemeStyles(theme);

    try {
      ensureThemeStylesheet(themeKey);
    } catch (_) { }

    if (styleEl) {
      styleEl.textContent = styles;
    } else {
      try {
        const style = document.createElement("style");
        style.id = "PieTools-styles";
        style.textContent = styles;
        document.head.appendChild(style);
      } catch (err) {
        backendLog("PieTools: Styles injection failed: " + err);
      }
    }
  }

  function ensureFontAwesome() {
    if (document.getElementById("PieTools-fontawesome")) return;
    try {
      const link = document.createElement("link");
      link.id = "PieTools-fontawesome";
      link.rel = "stylesheet";
      link.href =
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
      link.integrity =
        "sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==";
      link.crossOrigin = "anonymous";
      link.referrerPolicy = "no-referrer";
      document.head.appendChild(link);
    } catch (err) {
      backendLog("PieTools: Font Awesome injection failed: " + err);
    }
  }



  function showSettingsPopup() {
    if (document.querySelector(".PieTools-settings-overlay")) return;
    settingsMenuPending = true;
    ensureTranslationsLoaded(false)
      .catch(function () {
        return null;
      })
      .finally(function () {
        settingsMenuPending = false;
        if (document.querySelector(".PieTools-settings-overlay")) return;

        try {
          const d = document.querySelector(".PieTools-overlay");
          if (d) d.remove();
        } catch (_) { }
        ensurePieToolsStyles();
        ensureFontAwesome();

        const overlay = document.createElement("div");
        overlay.className = "PieTools-settings-overlay";
        overlay.style.cssText =
          "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

        const modal = document.createElement("div");
        const colors = getThemeColors();
        modal.style.cssText = `position:relative;background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:460px;padding:20px 24px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

        const header = document.createElement("div");
        header.style.cssText = `display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${colors.borderRgba};`;

        const title = document.createElement("div");
        title.style.cssText = `display:flex;align-items:center;gap:10px;font-size:22px;color:${colors.text};font-weight:600;`;
        const titleIcon = document.createElement("img");
        titleIcon.style.cssText = "width:24px;height:24px;border-radius:4px;";
        titleIcon.alt = "PieTools";
        try {
          Millennium.callServerMethod("PieTools", "GetIconDataUrl", {
            contentScriptQuery: "",
          }).then(function (res) {
            try {
              const p = typeof res === "string" ? JSON.parse(res) : res;
              titleIcon.src =
                p && p.success && p.dataUrl
                  ? p.dataUrl
                  : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAABGRklEQVR4nO19B7hdRbn2OzNrrV1PTU4SkhBCEBAwKBBAEEgCKEhVIBEEUURQBO+9iorlYogFe0NBxYhIjUlAqhTBECkiBEKHQHrPSTl1n13Wmpn/+b6Ztc/B//lLFJLD5UyelV3O3mvvvb7e3gGG1tAaWkNraA2toTW0htbQejsta63A23zJHf0FhtbQGlo7cIm3otq+7LI393tf9s8PLtumN1v6dgLCvvHf7G285syxylr7ljFZQjKzKjvfBnaOVTNmDM7v/pbQAER4IYSh+9Mu2dp00D6iNYZQmWwGpgJtDaRVtUAFGStiawIDa0MhA81vVEnifqcUsVI6tBEAek21KiTdlxIi0RA5aRMlIYQVmchCS033kyBrg1hICJtAZUVk4rgGaSGzELJWhQVsEgFJd6eNNz2nexc/kO+eCdH7z79DKOCvD9hg01Ww0+fCYBBoiUHOAFZYCwgh7OwHSifuNSHzmXwO+2lrm62FlAJCSKFZ6VpIWMuvFcJaJYSgH2cMJN3SC/gpeg0AJYV176NHVtC5pIDhR/RnepJoRs9aw2+WfEbLZKNT0a21/j8LYxIYq22fraG71odNtV6xuq9LL+5ZjoUvXW8Wnv1EbvlAZjA3W4Xp9Jk7jhEGLwNYS1eFJF//9dnqL/Z6R3RRbwK0b9WISVwBK4kYUgq6ZSrCQikBJpozxVYJ0HNEeD4h0ZA4h7kC7gIoCcvPi1RTwNLfJXEBh0rEae69jtPojjs/MxfzGjMRwkCJMBBQasBvqQBda3W5Zx0Wb37VPrj8LnvnKbd952FgpqE4bP6l84MpM6foHcEIYhBLPglx8sBz1Sv3mxh9dtGSaq23V5MhYLIQTZlITBTmFEdcvhXMFER2eiydwDrCSkHS/zoGAP2dPlAJS39zNPXETj+Dzsuf47iIz8cvdH+XkjSPO58Q/D5iDmIkqwKIIJRhFDk3oHc50P6yfmbdfMy65kftc36P0ZvoZHNOtWr6XKHxdmcAa21AxP/TE+WfvHf/7OefXR5X+3qSwGojDKtcQJIN8ARXAxiBbqSULL3Segn1BPfM4RiAxd2693nR59fUX+9MhSO+swspsflD+LV0HtIwQKAARZJPj/kkpCn6zw0Law37JEYpq8JMoFACVj+m1796R/LLi3+5/qpnsWsnO7rMPNtHG4jBSvw/Pl772uRJ4XeeXxXXtm5NAmsMdKxhjGUHmyRcOhvhCOpsPIIBEiy9rRd1Fe4Ir8jrSyVXuPfTkuTZDdAsfCIv5fVbUicDJJ81gzcXzAzSMUMQOMagx+ln02M+rbGwGoa0Q5gNQpSBpffrJf+4ovKtM+cXr9ue2kAMRuL/4bHKl44+MPODV9YmtS1bElWLtUhqCRHfeXUsYJYJp1LiQiAQKQFJ+Vry2oghnBYgaWUisOc4wBcQjnie8AMZo054py3YxgspbKodmBnqjNXPNLTocRgAUQgEIVhLoc5w5MG672Rq7KdolVNRZTnw1G8rf7r5u70XXYm2dfNn2GDqTJG8LRggJf6vF9QuPPag8JdL2uN44yYtk1oiakR8bQBtnENOks3qW7qLbkkrELGdM0dagL0AA0FMEii6yKQlnAYgXcGMAGYI9hPE6xgg9Sc8cZ0jSeQin9M64jkP0Nv/9PVCSCowOM5JNUXgGSGKWCOlpof8EZE6i7YCE0YwCFS05Dq98qGvVD5z3obivZRDENPfPE0wKBhg4UIbTpok4p/dXz3n+EOja1ZsjeM167W0SSKqRPxEwyQGVhsXgrH9t1Ac+TniE9GIAUjlOqlmx5xDt4DVsiN0SlwX1kk2Ee71TpwHOpbEIfS+OtHY3vdHBE6inYbguJG1BIehrzMNqSYhYmciOtLXUJjptQcxQgKIGIkqqGjdPdr+/RvxZ05bmLv6zdQEO5wB5lsbTBUi+dbd5XNOOyx7zeqeJFmzLiGVL6rVBFZr6NgR32oLYbS3+U6FciRIkixhg7oNT+16ygBOap337ySfLn/gHjsGUKk5cObBEdAzBL3X3fZrgFRb0H3PdM4/cMRPtUS/mehnBNIIuawzET4MfZ0ZMb3WhE0SpYUyePg/KjM/+PfcZW8WE+xQBvjNwoXhpydNir/55+pZpx4SXr+mT+vlaxLYWItyJYapaWYAR3wn/ZLSfl5NkxPIP8FARIEL8YgxnMqWLn73DqKTtDQK8D4A3HMpU7jogCIIep9nBE8g1gLEAMQw3uFLncL0vmMCn6Gqh4PeHAxkGH+fmIA0gvc/3HnpFAFgeqwNG4SpPqPChy6ozjj28ew33wwmEDta8i++JTn9rKnq5vaaTpasTIQhya/EIKePvH6y+5wONI4BSFOylPlyCxM3deYGRATsIBIx0zwBEyWVaEdkyURzhGam8AwRsKj7c6rX+wdkAuoEZ2q52g/5EkRwzyh15uFwkLXJAM2QMg6cb5DNurDTmSPmPTATdMOGjTDlx1T4wDnli096Nf+T+ZNtMHXBG8cEYkcS/7Nzq2ecd3Rw/boa7JKVCRBrWS2T5CeOARIn/cJwntc1L9D9NF5nBnDSmUo4a2RKvnhCDnTs2OjCCiWl0xaCLoAktQ4VSA7A3XmcgWFnUglW+2xSUnOQOn1e+lNGSB3ClMh8gev+QOof9DNAGiJS2JgnJpAp43JWU8hQwHRaGzYLs+kWGT74idqpZ/Rlb30jQ0S5I9Q+Ef+s2fGpH5sS3LA6seKVVRq6amSpLwbZ/WpNI46N0MYiMUBiLLS2MJqyKeBbCgk5BW9JSVg+KELg57kGYKGtBSWO6H76eudCskKBZgVDr+FIwmVr6B+fy/j3gqIJd35O+7/+YH3kk1Pk/9Pr+ai/hssP7ntTGcF/Z/d6d9D36Kv49/PvcYlsmwCyWYikE6LtVGsO/or6/SzTtef0WwRdCfmWYwCSfLL5p8xJPnL+0fKPm0NrX1ppTa1sZG8lQaWm+SAG0IlhoqeE0HwBUwKz8+eI6AnrLpyrCRhjmAmYIfovvr/gngC0hCs0+UoBP8WpBqrsWCs0lQ/oXPQeZjr6TEekdPHfXkd0S9lKwUzE/9LWM87s+VKUqzEMZCT67n1lz3AW9NnufBoQRUjdafWuXwoaDzgjd/OxxmbmTqMT/vstbduNAc7/jZP8o2+qTv/sFHHTRmXEU0utrfU54vex5BvEiUHij7rkUiHYkjboJ54jmP/9dKH834j4VGh19aH0te42TQgN/Bu8KLLG8J/HBBaSikeOTswEAxgoPf8/MRf9504tXvd6YjL3wQMYcADxnQZykl+ueMJ7RqPPspTTDin1oWvv+Wq431f3qFw6fZ7QmPbv02+7MMCM+Ta4+tOT4qk39Z3x5fcHs9uz1i5cBhOXjOwux6hUEtSqBklsWPITY5Bw6rz/IqYqmBdLuL/U9WKQqwkPfJLfy10EqaBQEsGdL0mMMJoLiP7vLPqeMO5cdSLWGc2r+pS/6jUC5yj2f4j7nDqDvI7j3Ef6U9VXej/RQKWacp5/nrRAAUh6oTBRJ3tdGF5ymy1NkvOEngM7sO44+BhghrXBzKkiOWx2cvrFR0U3bshZ84/XrDUlK0sVjVqF7L1Gog00qXtWgf0XyUmsu5JpPT6VtpQ0aZrXeev9t1wB9lVg+i4pQ7jz0upP9/IHDkgF94t4PyHrjp3/bf1ErLNE+tf6J7g/U0tBvXWAvpjTB/7rp+9ITUscuyP1ZUzKBI0Qeits2ydUMP7o4Md0rmmpJAxGBjh/oQ1nCpFMnpOcfsnR6qYNDTCPLzVAH2S5YlCresIn5OCZAVLuyVOXOCYxX6W0Guf8d5+F49DMhYDOy+YsGwIlraLD13Ct4aqvLxizt+/MqB1YF+C4gD+PU80DQsyU0VwU4mP9+q/t/5t75HjAtQq4xhbnhPIfyKq4X+gJz48HkLJadY6v13OWNVnIDKzQaOI9zouOeCDXd7KQwthp/7oWeNMY4PyFC8OrJ4n4sBuTaV+YIm5clU/ME8usVSUhSMXFNefV66TfufN9HQNULTfapNq0rpLTMm2/K+7fm+Zn2XkaYDLcItKzw+ccP7bx3vMmCaW0soTRdFBySfJBtpiP1Jw4L7Hu+buchGO4NJOXaqGBKWPX4+CcNvq9de1UjyYGRhbu59RqdS3g3BFqIisCeoNF7iTYsUeqSydbG1w251/XAgHeJJs/c5KI3/Xz6vSLJ4ubVxStfeI1Y/PdQnb3WaBqIRI6QO4uH5zgSaXMi7mr6RtO0lAqlr4s3UZe4tMcAD0OFeX1uVfHV/0kosA9R1fVFYU4908dQ/WsoPBZwoA6iXwMn2YK+Vy+pJsWdzhnT8sTl0TTdYQ5iXWRi3sBaySV+ios7YK1v0sH8HsoncXv9w0nqVmhFyQJkMRURGKPhM8rIsAkUCqr9fjTMvtffnf12PfJ7F3zMT+YiqnJDk8ETZtj1dzpQu83Kzl9xofFDWtagafXwua6pYz7AFEFRA2QZNPiGMpoSJ1AaY1QGBjO/iX8POX9qZiryP5zZKCRDZQrBrHKdGo6JGGllLFxF50ISsqNbungDN6AjqFUUm3df0gbDLlo5JzAejrXFXHSzCBn/ihrF7gEThQFCKMQ+XyEQkOEQhGIsk5R9JVj9JUohHRmignurZvTRGm10dcw6inl/kYUKmTl885EEfOLEDCbQckxHcggXH6y/suEx4IP2BlWipmucXaHaYAZ1spvCqEP/F384S8fJW56ZZMxd99nbH5zRZbbu1HZ2g3d14O4VEJc6kFcLkNXe6GrJehaDTouI4lr0NUajK5B69ip5YTKwZpVNbG/MRpGc2OYq8n64Nmpf5+58eUi59qn9//Z6in/2HX+vX6xfun3Dvk+HayH+FAygFIJM0Ix34LGhlbsNKIV79xjHCYdOBYHHNKK8XsS0Qw6OhLEVdc15KNBv/q9Sw57uFzd/6n000gTRBGFh9T/AAoJYTdCYQ9jWo7ElNsfq+4jviVepOSQwLYxwRunAWZYKb8pTPS5vnHfOC988cFFIv/gT7VGb6xQ2QRUNwJxB2B7qNwF2DJgSR1UyeXhgjhAri891v4gnZdQ17UnLj2X9F80Z5Tr8Zi7dD5qcL5zPxO4eDy94nXn2630bvpeNkj9MSV3GLo+JF9uYipIZCBtGyRaoHUXjK6CWpSBLAQaMCwcjUmTdscZZ+2GY09tQNiksbmdONfVC9KfkZoiTg8P6EVwWsGyhsuSFiCNRjUCunTrgMyuSPAPFT13Uu277+7IfO1fqRO8YQwweb4NFkwVybTbaxeNnhj+4ueXJ5VwLcKkzwhUE4hap2MA3QskXYCugJr6bVJyxLc1wFT7b01VOE+u5gmYwDqx9/QmxkjT4QNDMCJOSnwv+SxSdKUDd8mt4kfwpsK/j6wvKXz3HF+Z15WefK+q7+Kmz7ZVCKsQ2V2Rl+OgdYcr6jAfUT1Do0zfGc2YtPteuPgr78KxH81iS0+MSsmZljoRBjaZ+vKy621wf8/mgJA6i8iUVAG9HogaYVRWBSuPT57/0iPBfnPoy5F92hEmYAqABQCasmJUTwZGDBdC9VmhqdlehrCqhfQfEGcAGQK6BJBTQF/BZpzk02FIC9SIQax7LusuNjEF13/pctDF9xoiDezT8JEa7l2Xtm/aJjNBVzp0l5e8e0qqsR4N/ed7U8KvcbGWIwc9dn/z5saFA9yVGPP3sCijinWwsoad8kehr68DBt1QJmDpzaoEQsR47rUXcfa5a3Hmn/bHN6/cGbm2BB3thk2CC03dpzrm6U9kpYuiJeojcLUQ98mmBKlGGNN8sNjrnEeqewqVfWlbzcAbxgAzNzkSPP1s7anTDwpk074Q1U7HsXzt+gJY1eh+RRwCSQZQEaAjR3ivEZj4dHF1zZsDM+CxqZsAQd43fSBLolOrTnLpJzl17QgbQIgMbEKEbYHMjUaUaRUyyHixI4YJ2MsSUUQ1OEcF7+XRY01VxUhBWsE1Cfbo41jIOIFNakC1BFFajz4RY1TDu7Fp7QaooAzLjOvMVnOYwIgSrr/rCbz8XAlXz3kndnpPgvZ1FmHoIgH+OT4UdskwHydIxwBUh6CvG1ctuULebbFJ06Eq2uXnOAIaLz00GRIL6vZve0YBrB+5MfeL9yZ/k4cEB//g2qRWXCqCaoelBgdYFmryaqoAqX4yZkkJNiYzwGof0N4MaJIwJ2X8a/lieubwFtrF4qnTR4sILvul2mQgEMEmjQjze6PYUATKTyGuvISkupFHeaxU3uWPLHVicOsnMaYMuTBvhYIRJM0Ru+D02BcpKEoRlr5TUoNMKqiVVtsxrcPFO7KXYdXKTqigAmPIka1C2yqMrSAIKuis9WLnpp1x0137YsykBFs2WK7/p95JvazMfQq+G4nC3wwQ5gR611jIEkA/R7WJRK5W0fLj4xsnLIvOoqSQ2IZS8RsYBQgrLuOad+1HV2z9yOWtjY99/Ixg9B+uTeIGQFVJ+yoLS1JVybnmPU1GLYQgaWT7X3aSTgcTPfaHkyRbv08SQlLvHcDU5/MN46y6TRbCZGHtKDS2vQtFPITO1Vegr/tZL2eR4JiKXkux3UAvn0wUaxEK4l0wr/m8aWSAuvj1RxoGQiRYu+5pO2K3YeKdYz6P1eurUJJqGzFiYgL0Qid9aI2KWN/VjnM+9BLm/W1vNI5N0N3heg77k8rO3HGl07uedElIodR6yc10Fs2WIDEayOwi9z9/2cJQzBN0kdLq4/+banij17Q5Ss6drrOfKh3w7S9k/3J/Bs33zja6YSNktdM6D5Y1vaHWL2fz6UlTg6A/UJ80aQhW+SkDUN2XnECyp5SZS1Wrt9WcE/D2HwGEzcCaPIDRaB25C1T7N7F56RU+wZKz9DrLxFckY84Cp6aDCCzCARY4cO089VAwTe2l0YD/3d4XoTjBJBtx/L5fE4XSR7B8bRVSKNRig5gcQ9sHTbnwoBebaptxxL7jcP0j47G1RF1QjvBp42rqBNJBzSlkPen3d7xq0VgQKDa6sTY1WqrNZ5q+BbNre58m8ytnGCtn/n/6AW98KnjudH34DBuUZxWeuvL62qnHStQOOUmI3mEwUbOAagBkATSKC5GlXuksEBQhwiIQNHIPFDJN7ojoaAbCBiDbAMHPNUDQc9kWiHwbRLaVD2SHA5nhENlRQGY0UHgnRu21C+TGz2DT0m/BEoFFyPI0oIBj+0uAabhJtzUXfTDz1awwMfjgCIUYlR4n/rnEHaB5RaeKpGzG/S//3A4b/Q/sOTKDrNRoiiQaZISCaEIOw6F0G0ZFozH/uXb8ZkaHGDUqREJBDzH463sF+AniL2KMvq0WJnZZQWbRxApIo/NjVX4Mgp3pl+2zDYL9pqSCF8wUiQ8L5/95ROX006dFf+o41iTL77M2GwgRB4DmVDs5MxKWnUKy2xFfVL7wqt8MUEhFmoKiOFcVoavi0maUKXT1AXo/peDysLIRY/bIo/bUudi87PcQcoRvxCAmIOcvDfUC1hq+6dsr2gGhIQfrqdTTohSxe+ymD2kRJfrLQvT9hIiQxBazF30b3zj8t8g+Owob+mrICoVKDFR1hCoCJDrCiMDiN79Yb4/7aANadpPo6SKXxIcFLhqo18eSxKK73YL1E3mjaRML/eqxUAXIXQA80rYNDPCmFYMoJ0A1gfs/n73trlurF174DhWMnipM3ASrioDMAyoHGrKHzFGmQwFhBISkEeiPpBGKLP2CNARpg0wjRKaZ75M2EFELkKFjGJAdAeTagGIrxh2QR+2FT2DTK9dAyOGuoCQCCJlhovN9lQGhAwgRMsGkiIQQgSBH0B0hMxXNGwmEQiASghI/iIQSeSFRFEoMhxJjhJSjhBTNfF4nUyGCoAEdvR32mme/h+P3r2EXJdAcGjSFQDEA8lDI2Dwa5Ah0J8Bvvr8FTfSHNBpI9Ukq/Qro3gJUqJZCz7ML5O6zIRpOrGrGpCH5DtUA6aI+ACoJXz1JXDW8WGn+r9My37m8rGulx2xAXJyQCXZmn30Wnsm2lOoKYMlB5F+ZOntpvO8dv7T1lofDXIO9iBTGToxQfuBMbHr2JgjZBEvOpQiFayrzUQW9lzQNvKPF35YlKoV38b8gbQTx2RgrhesNIs3Dw+BUpLdCtAgpW4SQbTCiB8Z0MW2iYDieX/e0vbnld+IL770ANz9SRVdGuewCFai0QEUX0CaH4747enD+C8PQMk6gt4eKV74U7OcN4hrQsZGygr75JPU9KM9CNy3s/bRsa13wTWUAWlQS9l3Alzc36NYvHKcuvryS1NRzCEhg4m7nuLMHnIh0cNI9SXANxAxpmXjgr+MLk5bkDGRGYqeJCuV7zkD7k7MhVCNJiCVPn/MAdFtX+wT3QXRM57J8Xdc98K9zfnQQkJZQ0JpqEL7XkPmGMvPERO2wph0JxeiiDVLuAyXahMV6a2wZ2WAE5rx4jz1o3D7i7AOOwOwnq8hECiGdmz6OUAGCJqytVfDQnRWc/dU8ujuTAX0PJP0CG1dQ/wQQZhxeBZuHNC9Gi9MapnFQtoRNpfyJtepX09QXV90b3/ylo4OotieSoAEIm0jTW8icgMrSLZkEgLS1pFbpnEBQkFB5CZlXUPkAqqCg6LmidO9tlRh1SIi+v3wM7Y8R8RucjeRQj9Q+MQGpfnfLIyN0K+hQ7vAtHm6CkPSKREYVkFQilMsSopZFKCOqP0KJACo9J7JkPqxEZK3ZYpPkIWvMEig1jrQCjM0hGxTw1ft+j44xq/Ch3TJoMQbDI4HmAChSttCGKKARjz9YZcXku9KZ0Sgf1bXFomOTDxPJ4GvKkvtAzydGyVVJOFkBPDT4mkJ5QtcQE1x56qNnlx6K777gmCAqT0CSaQZUowAxg2pwBJd5AVXoP8hfkHSfb93rAnpPwUC0COz0vhB9d52JzX+7yRGfrYSz7XS4eJ/CO8XSTIygZBahSo+cnxj2XUBUYqZkUJwXn/rwefjVty/HoZMORqKlyEaNIgpzCGUGpMyJiSjZ5BiKmCEPo19GEv8dSo4SAjkhkRMUVZx3x9UYdWAfDmsKMExaNEugkcq9ABqRx+rFBp2bDbtC3MOggFoFWLciYUbglDRrR+ogHaAN/VxhPPC5QdcWTl0Ql1FeY4r+7nEdp2ef1E988vgg6hqNJNsiEAwjojq/jw7yAVXBEVzmLRQdRRdGusNAjJQYdViI6pyPYcuDRPyid4xCC5Fl9V93+hxDCIkIShSQIdUTN4ugPFaYShahyLMmcBgDIUwSYPe2ifjxrPPxma9/AE1NTZAmC1MOEZcLQsRFkZENUMhCiQiKmYD0BhVxWlgb1OLHoOQ4WFtETjViedcKXDj/ehx6uMRusGgJgCZmAIu8VOjZEqFjs2UGSLueVy9L2Pt3bfC+WfSfG11pkS9FmTQxmAdDZgojLqOR7ZG937pAHb/Ts/rF044NolKb1blGQDQDsgmQnsh0y5qBtABFDnS/yRO/TWDUIQGqN5yNjfffAKEKXu0T8TNO8tPiDrlHLKEZq2QDctlhIu4dJU444JP4y72/xFkfOVXUYkmT2UQ+BAHVDoqYdsrxyLcCDz+4GI/OfxmhCHHilBMwd9bPsN/YY2FqLSIXNAtFUk6RBCj1TAd1HDXC2E02Mc8jlGOgTYjmYBjuXfJ3fG/l3Th6vxDDYoMGYgCaE6QMc6JQ6rIIAkH1AaxZGaO323A9hYdi0txXOnTqS8pMxK1ADega3AxAa6Yw+lSr5Kti89e/Hp+433Kz6oPHBGFPq9XZBgHVDAREZMpyETPQQc81CwT8NwOMFBhxUIjSVWdj/Z3Xe+KT9zaA+CTxMuT8Pku+yELJIvKZ4SLumoCPH3cxrrnjDBx8zFgcfMTe5MQJKUmlU+1AoS0aJz501nv5K9928xMo0bSmydqPfvJYnHTuRFx724U4ZPyHYCttyAVNUDYnFOhziIkiihKsQqOt6ZdhbR8CORKJCdGoWvDDR+7Ew+plHL5ThJw2yEv2VtjvoAYQFQqsXxtj88aEwz+T+BZ1Cmg9Ewx0EmmZDUAJduu2kmPHgBfOFfpUAj54OLf8qu8lxx+6zmyZerQKexuNyTQKR3wyB14LEFPw0WQhRkiM2D9E788/hg13eeKT2qf0LTt83ubXkzzk5EVWqUbkghEol96Dsy78PH48+wAURwB3zXsVM782B8VsxpJzRba/Vg0x+b3vw94Ht2Ltmh7cf9cihKGCChPxvZm32RWL+7Db/nnMums6Dtj5BKAyArmgARI5cgZJ0/DB+QMR2JicQlDjSA7SFpAVeXzu4ZthdurEXvkIGWERWSBUAo2tElvaDdaujl3t37fJu6SAj5I8A9RryBCorCUGEBu3lRQ7DL2S+gaPmGGDZX/KvHDTFfqkD2yyvQcfqWS5yRrK9LLkN/qDIoUmC0uSv1+A0g/Pwsbbb4AI8gPUPgVWZOdTu++yeKz6ZQ6haEUtOUj813cvwI+vGI9CA3DDb5fg3I/+Ft2VTTTQ5XL5MkIGO+GUM6eyc3XPvBewfONqqMhwsfCFJYvE+SfPxaolVYzbJ8Jv7z4B7975/TDVkcioJtclRBrAJZAgkYe2GxFQcki0ASjYnGyxm8qduPiVeZjQBjSyJ28xbDhQaAKWvBazx8+TSpzxS71/pwnIpeYqdtrYZKzqWmJRgVhFr930T7NP/7e1Q+FLOWU8wwYLr40em/MLc+rJXVJPPFiIatHaMFX9LVQSMDAjgbETA5Qu+yjW33qjIz7NigllHdEjzt6lRR2HMkcSmEUgG2Cxt7jkxx/Ht784DAUJ/OT7S3DB+X9AHK2xCGqccaP316oSe497FyafPAGVKvCnm54CBMGRWpphEGG+gicX/wXnn3Q31q/WGD9RYdbdJ+BdOx8OqRtFIAtpBpGZUSILgxoCaERoQyAahUUOrXKk/dumV3H9lvnYrRCg11hM2DdAT82gu8v1PJDqd0T3JQuPLcrT0oSRw7MC1qJTqq7luvtF1JYQ6af198P9P9cOx68lJqCU8cNXh/f/+crkox8pSbXnJGkrRVjSBFGjRdImMW6vED2XnIHVt9ycEt8TO4T1jp5vLk/jeZITG6gApVKIE046HJde0Iq+vgSXfn0FvvyVOxE1tyNGWcQ65nZtcgJ1XMAJJx4mWkcq/H3+Sixc9BIyWZrgpcAbqCXGZosGC1/+Oz53/HPYskFi/MQQX/3JIUh0IwJKYLAGCP0R8fcKSQOgCQEocmgQBgXRLFtx3da/YY1dx6/Ye4pFRychoVEHdDoX6QZT6yVvr/4lWTe6BDlYrBDoW4PlM2cU2mnWYFsg5nY4A6QpY2KCe38Rzvvb7+Pzzqyo4B37CmMbYeMRAnu/M0D5v87C8ltmQzLxOfPhcml1le9ifJZ+P5hBJRXK14URxGuLt2L9eiCTB96zfytaW5tRo3K0z98LoYTWUrRlJogTzziAv9ctNzyNnmSrtdK19NNnBjIStUSiGeNwyrRxyDdrHmGff08fJDWM8NSXz0F4LUDJonwwnIkvHQNAooAARdSgMLvrMQwfabD74cDm9hiUcCaG44lkHp5x2iDtbeRGEVL/VDNrEMY+A2ztwSJ8m0vA20TTQcEAKRP85jc2nHN5Ztajv44vPreiwpZ3WDNp1wD6gnPx0pwbIYMig0UB1NyZtmi7Nm0n/f7nOJxQbqwiO0oV50XPL8IZ56xC1+YAp57aiFnXnIJsOAnWZCBVBkrlUatkcNh7D8ZeBzVg+fISHvzL88hECRLqx2KrTk5m0TZX34tf/Pjj+Oilw/jcP/xcBX+45hmEUYnsth/xoO9FAX2AQLaiGI5DgDxC0egZgNI/WTQEzXgpXoq9PrIZgrp9emo8/0C4SHxL/X80HuEbpWkegjrLWca5iRDYOp/svniYGOShbezxGDQMQOvTnxbx/Pk2uPE70U/u/XHlW1+vhmHl018xD990A2Q42vXBcQGmX/LTopAvo7tVv0edHAa1uM/m88uxYMGtOPsLndjaAZx0chN+ffV0INkDwhQQBFlk7GhMO/MQ7r69c+5LWNm+EiLSMNCc+jU2g+byJPG7K87FB7/QiHKc4NJPxfjFVfOh8q/Yqq64khVrItLRIbQVojHcA03BeCiWeqoD5pgBlMyhL5bYY+dmHHJmHmtWlbjTiZBRGB+B6v6Ej0RhYGr/ifUVDdZY4h+LtSJcPl+XFyP+q2cA85ZlAFpTvSa49Ye5b8z7Ue2qgjwhgDhKwxZZ+lxad2Col45p+mKRb/3nnBlHTzRQUhHVpBcNuRdwz1234twZJXR2Gpw6rRW/+vUnIDGC5/Am7vpuHH3yeJQqBrfNfcpa2WsTU+O5HYrEMmYMrvjJmZhyUQ6lSoJvfw645ncPWZt7xJb1FmiRsAV2YDYcgYgEeeyan4pAN1iBgnVMkEFAaWMZIbFVXDxjsugsRyj1VBwghqbDST43P5H6Zw0gWPfRtBBqnD01yaNSbFyLhTNVbgUN5vz/dgINWgagAZNPn0+Z7ReiO5ZUWyqTDrMfPvu7wiS7QYY7CSGaB/Tv1fG6+4eu6u00VLh16TOLxBpbseW4Gw3iCdw2ezY+8eUexAlw4KEjkS8UUCsXcMIHD0TjCODxBe1Y9OwyEWWrSLg5lfAJBIrZETjgwyNQqQFf/VSC3/7mfqD4CCqmF7EpwyB2g59UmSe/30oUwv2xz8iDGAMhK4oIWPozCMMIm2u9+NznDsJu++1uV67ooDQQYkZHSZuVLLdB8hgrN0c7Q8c1TCJzFnbLHGAjzO301JR/gZ5vejl4mxbNt31LGDtzeXbvb+0xrzsbHn/v3JXxlAPGq5PO/BnuuPEyqGiJIKcIIP3owHfrbXkDhizcMqD4niDG6Upa02PLNYh8+Dhun1fDB1Ydjs4NT6GztBljC+/EiadPBDUtz/7D8yjF7chERtD7qWebvPuNlWXizFMeQD73Djzy2EM2KLyIalyBsWVhHaQFj7JZhFZJKUrxCJzwrg+hJc5imY5FhiQeEaIgwqpKD045cWeccM6BeP75LRA6Ri3xM4+asKnc9ijaGuqU4J/IeoVyFbEE9bmYxSJ86X7dszQXzya84W1V/4OLAaid+VtCW7OxeMy1w+euHCaPXXerrkb5QvjQQ0tx7GF74siTLsFf75gJFUbQup2CMo+VlKp/FzO7+Ij7aLl33E3zUKuZC62qCQ1sPI6H5i9CpDSSag+O+9C+eNfhWSxZWsV99z6BKNtnE2ob97AvdD9QXfbvi+aCun8yhV5Uk5owPLnU38VD4/tKBqIvbsWeYz6M43cZjwULaohChYpxjZ1r+7bgg8cOx2e+cSCeebYDplZ2QavHGpJGcBcydYZJRbzlRj0Ic5iyhZL6AkYLveV7Uq3oiW+/PCisJaSQ6dh25LDBYQJ8L7s1tumc24b/uXSQPHbZ03E1oxAYVUBYKODeux9FNHI0pn7wG9DxGKhgFE32MEqkW25YxNl/Z/tdnpSG/dMW8xr36FvdbeN4CzKZDVBhB4SqYsn6tfj5V1/F1z/7ADb1LLNWlmGoQ7neNaTZXqtcJ2RuHapJj9AoI5V8F6JTmTmHatyMluYP4IuT34O1z9XQpyV3O2nUsKGvHR8+vRnnXbofnn52K6qlEkc2OiZYPIeGSilpboCmHlFqGKFoVbu5QZW4Kim2QD53LbA6SGaxf/BWRApNx8nnTRfa7tI76j+vzt6+Yj910H13xbXMEhHEG4B4s4Hp2gjRvQrJ5i04+bjJ2PTKi3hswQ+goh7oZLV1ILtpi5hv107LZb4e0P+8rxH45wWnfzPQlazQugAlDDI5kv5e14zK8QUnXzkCSWN7TjwR1ASPmdF9SvXmUE6a0Vh8P754+GHIrtRYtBboThTW9pZQza3Daf+RwUHHt+G5F7ZCV8oOi5ARULlqAWUllJEiKwMbISRvgd3GhjBEa15imABGHyn0ll8H4a3fry1Ya6MjiYrb6vwNCg1QJ/6hpdFfuy533+bJ6qAHn4hr+S4RcMseqUPm0Rx3+gaFLG6/9Q6MmjBBvPew/xS61gQVjHfQEVw1wf/eP0hOIDuC5C2SVqA5hBpoosfScKqlMfQSVKYbueJGhLnNiHU3DHcje2AfXimkg2ssd2hfLt7nljMU0BePxrim43HJpCOgVhq8sF6gqySwobeE3d/Xg6/NGoE9DmvCU0+1Q1f6OMRLgbHo4NQv5TmMtfz7SfUnAjJx3j81SueaAbNRiIW/tujMmG/PlMJsSxv4oPEBJs+YH8ybLhJ7YnnXS78S3b/xEPmOux/XtcJWEVRpSCh2GEFuWjYLQ80eogCVL+DW2++2p594NJLSOVi46FqocLzQeoUPltOQ0PdJeRPh0HhIA/hkmX+tZYAIhl6AcW4Xo3r4aeD/DVQuxZQypPZthBpPITWhEByAo8YehklNo7HutRgbtgrEEmjdr4YPnGIwYp8c1qzvRceqPnIu2eFj7cMzgK7NnFLANG3MkDUegsS1oElITZ0GFi17S/3qJSpc3FV76Msq9wCFfv+K7d+hDEDE/9vMqYn9XHm373wsvGfNgfIdtzyX1PKbENQYRYRgYxztGIadijySxsnysEELVLaG2bfMw+kfeD+S6ofxzEvzoIJxxAQDUAFpMcieI3qaOqMZfz8TCggktVgQAIWjc3rLyVZ6gRsN863e7ij6y9aMALtgRLgHdm/YD+8ZPgHDGgN0Go1wgsJ+H9RonlhGNLKCrV19eOqZMgKlGYGkVvOwobzVGGUYHf4AFaTclAKTHcIoUAcjQ+SUgGETpS09JsSiO3QiWsUl1ATy70j/DmGAadaqeUIk9uvl3b43LXxw/bvVLvOWxnFukwhoRpTwIkjlKQ+P1g/jkoENG2BrZdggD5Up4o/33YnTDjsa1dIxeHnln6GCXaDNKt9O6YvlYoClI4lTCjqJYao0mm6QLY7A2J13x6hRO6G1dTgaG5uRz+XAzSFSCcoAKkkl3gwikUOoCsiqPDKyGQXVjKaGInv2JdGHXtOD0cUEcVBDV62MFV01VJ9PHMgDTcT7LnfOXPgKHxHa0Nwk4xT74VaamuEogBhB8gh5U4NEQxP0wgtVtDVMfvkfHdET/6rnv8MYgG2+ENpeWdnriveH927cXY7744Ykzm+Wqlpyc4PcaU0+HdfyHBPwrm8ygpVZaLa3BLbfApFUMO+h23DygUeiVjsCS9cvgFSjYexar+r9Yp2guI1cVzaJKDsSk485DUcceSh22e2dyBeHoRIrJIkbxqRkDKGWUvKHzABB2RHYA0kp39cGpVqCdtMObdYjqWqGvCNP3myk9J2T7igQCAjeg9xU0mpM6H4kQRpJ5XlWYkUPQCQSBaEVp54DE7B2yMcCuxwG8/L3Rbh4rV4x7rDgGzMesXJbyr47ngGslbcQ8f9Q2evnhwX39U6QO9/YncTZLVBxN4Md8NAoAUg5r9iPfnr4noS7b0OCx+LJIUOAOzRHaHpx5xN34bh3vx/GlLF846PEBMIYmqF2CGGcEqAsXTURx514Js467zw0j9gJnd1lbO3oxdpNG13hhYCotIOrZdg68guM4L9ReKYpPPOwcSmgpccOca3kjDBGySc3iEbOIkHecgUvBZ1KDRSZN7Lt7Jm4XRA19SNrYoDAKmozlQphWWLCwcC6u2Bfu1eJQlvymRMeER0k/duKB7TjGGAGod3Cimv6dv7REer+aLwa+6tyEqstQiXdBBsHTm4QdFwdBshHAGlU78rfVAPIsFNIt5p68gPC56ng3ufuxlH7HIVqXMK6rYsg1U7C2HYGg7SmBGGLYsblP8Wxpx2PV5aswyuvrWY7TPl2+pSAsdodMjlBzLHvQdJPMHV+TJdm9hiKmFC8KTubAlt6K5wCV6eNmqnEM2opweGlzOIRUOlclI6WjENH+9cqC6NoYzkRicCKksCEvQTKK22y+GdBJPPJVadsCu+bDxtMZfCkf39tlzDQXuZQNb48SV25x/hg7KyarsoeoWy3pfl2lnpFiQ4qd5L3X698pXsDpCicbsqHa+2SbnMMoquCVsQo4sEX7sPuI/fHsIYJMDoLpUZTcUXQpM7PrrwW7//wB/H8i0tRLfUhG9L8HzlepPYll3EJO7gf+r2+LawDgfaS66Dq0/DQHYw9TAUcer6OXp6CT9P5jRgIfM3AkwRIaSgPQRjQAWQcWmlCKB0iayKLHoFdxghSXPrJy8JIZPU/3n1gcDFJ/hQX4uCtwQBzCKlVmNY7SwcdNC488TaTJJWKDZNOC9vrYICop50BI6nwYQYcKROkU/nswVNfP1XSspA00EFTIyKHIGhFIhrx2NL7Mb71QLQWCbSpF6Eaj1/P+gMOPmoSXn1tFQJqpSHJJCJpt7kEQ8v6HccIcNKZDE7EpztM+alkt1IgeJcLcJD21LGZQsbX9wxgolO4yPDArrLHpoOITwqcUj+hEDqAjRUxAbImY1FSmDBOUnu4WfDfMixYvaVtdG36rgtE5UUXnP5b+MDbFyy6zX3bKTuFR2abBJYSxB+hw7DkuyQHO35k+33mllOf3PtGxQ9n6ZgZOHNHABDp1A9pAa8JZB4qaEFss3ih/XG05g9AQ3Zv/PLqH+GAI/bB8uXrkQkpa+c3keAcg+WIm/fr4V29aD8gNxnEZjngbT58j5GfHeXRbddw4pBjPZ5P2q/vN511xPe2XZMZIngUmndUpAEEzTzSYeLAiiQQMslAJRmI3gB7TlBIysL85TKIcRqVYtGeNmlZfhVJ/7+a8dvhTuDYSIzrBtBFyotQQjwGlC1bwl2w3N7kVT+FRG6LWIey6VASUgvqmj5d42XaG0CdOjluvgyjYahWVmJV1/O47vqfYa+DG7HktXa24zTg6ShZV/Mi3Z2c7DBDMjE0rUMFk4kRNd7vldI1rhmTuMVBuZAcuqKTLwG7EVZydxhMzAFXMcAUF3pdWMc1Pkv3CLQqgNA0i5C3QmcQ6QD77CGxYTns07OEnaxU0NSszzxoY/jQG2n3d0wUYGRAkXc1ppFwy3afgDhEAktj0ukkeAraUXeUUuL7dmhBMG+sBdy0j2sMoSmgCIHKI672Ihu24ffXn4+JhzZh2dIOnrSp0tZzXnG6TaMsYwdTvw9/BiednMSmqWRNY2KQIiEB9kjgvjTPDiuNfqSov+lOJq6HP0WJ9vaegKbYmlDNwCV4KKmkbBaK4GwqEdqaQ+w6Bnj0L9auulfYEwoqbI70eQdtDP74ZhF/uzJArEk+JeLYQtZ8rM9g0f2Qf9ya7ytfdbBQ3waVlnkMY/65yV5uvPBwcFKFiCuEnhHi99dfgAOn7IYlr21lb57COgcJnyJw8W5hAoEDDpG8QUW9xc41l1JrFrlobudZJDSRW+87dv8xL5KGEkaYOMUx90zgbIZnBKpV0PMOl4icWakz1sZZRCrErmTvq8B1v0qsWKLs9MYgaBDx5w/uiGa9mcTfrgxAm2qx65oSmLx9vurOfnIjBFVsKSzyjMCd2OQTeCbgeJrVqavmcRaN27klqpUEgdC47sYzceCUXfHaa50MshD7saoU9qEOvxbQ8JYL0TR75DrdR442C2JMoQxN59JgO0UofArv1XM2z+EIuA0dFG9L0e+uehPBuXwPVEnaisEvMjaJI2RUiNEjQxRDi+eeiPHU/cbsGkfyxIZAZWV80eTO6Mo3m/jblQEoo8X0JltPxI+tEFpYbn8acLBGoPt0kf9pbx7eN5gzhKmqdQ0S1bKm9kv84cYP4aApu2DJ0i6O02tx2krtwzufEyR7T5ghhsDHGCvA7evjNm9y2EU0qcNqW1EiCFzYoedSsCb+eEPvFQ79nPw63mfAF3LobwxUScN9AQNVahsgnwvRtlPIA6HLFvXh2Yf6UNmc0e/NFMMjGkUl1LVPHt2TuXl7EJ/pgu20tCCXWHKoR/E+G9N04jWdffPmgJnCP+9Lb/VIwHXHktRS8saiXI4R2BpuuPkDOHjyWLy2tIcLLm5WnreOo/1jyfK6PQjSbYJoWYcURzN4Sjkfgfeo1j7pQ69nFe82bqL93gNDW31TMkiyLWdcAZL8mmMA0iYU19PGE+TwBUGAXEGhsTFAhsxRR4IXn+jC4id60LfBolk0JUcXG6L3ZEy7EMm0kzdn/ra9iL9dGUBZ50mntp8JTN0tTHSPCe3tPvnTPKrFUzFuNJpMATOAn5Mn4vf11RCIGDf/8QgcNHkUli4vIQoF5/GRpmdTgfTbwVDs4P7GLiZrJkrYMKsR/Ds3i0hOAcRaosZhqWMEOmLi48QRm4isOJFD35cdRgTU2CEVshGFrM6slTYlePW5Hqx6vhvty3uAkkVjWDAjMsPtEWE+2lPpJ3qQnP2pzdnF25P429kEuOxVXcWnPoD3B1IvjO1rKu1+rz5WHv6Wsi2KmrEqNShbw803HYBDp47A0hV9CMlms9p3xRjeZIHy9o68FNSTA2hZ/VOaN6EoTqKh2IB8LotKtYJKucyDIDWqB9B4ZyARQKHCm0w6zCIiPO/jZkLEiXIwd4R+W9aodFr0bKqiu72CrevK2Lq+G72bywyRmw8VmsICMoWWZKwYHr0vFBijkqtnbV7znwuwa4Xi/O1JfKbLdvskv9cz7xjidw0hZuDOl9hJOBN/oE9A0sfM4PLmrDGERblSJZJg9uyJOPiIFqxYRbV2QbuNuhQtg4hR3K05qmP177CVPPK35CLNsOGtnB9Y/NzTWPDXv+LFF17D1o4SqrR5BXnsDC6VDptmYGUelsI25CFEE2BbYXQDTFyASSIGeOCoQPsOQdolPIyQz+SQzRYg40ZdsE1q32wx2iOjVzWL5OJPrs3Oo8szA/9eY8egZ4AkNoKTIQR7nsZcTHBCvuwH6awjwfsjZQz2xAVQKlcgTQl/vGkC3julCStWVTh+5zm/er9OunVgqvb9c6RBpCvvjh4zEq+9+Dyu+slP8OTjT/hLQbiEVG2kzCJhBntIOUYTJ08+Be0jJiObtRVCVCBUNwh9nPoFKK5n2BhkEZoslM5bqQsmMA3yHdnmcNcAyWhlZq2Jy5f+98aGdlfTh3mjM3yDjgG4g4rSH5RwodCJnCaWfkoHOwYwvv05lXb2xMmZowYRCPSVawhsL268YQwOP6oBK1ZVHZASqf3UxR+As+r2/XGOJEE9ahq6tBK7jB+F2b+/Fj/+7jehkwgi1+aGTmnSmMEkc57olGjKWwhCG6NkE/2NcG4J/IF2BaH5PoKGyUPaLKSNrEJGKJsDdMFoXTQ5FKJx+QY1LgOMlPpuG1cv+8bqwkL6qm9EQ8dbhgFomzbuzWXHz3nxbPsHSL8gQrKTyG3RvjTs+uXLfVQ77cXN17Vi6lFFLF9bY+K7wZ0U4s/jPnPPF0m8cVXEgBw2AxWFaGpuwk++803c8LtZEFEbVKEBGlRaJlw6V1MgwjtsQS47e+SRPASIMTyD0H3eMoZRyS1M3lpTNNrmEMl8MDzTGozOAMOgS0WYO3Vc/fVP1+QX9BMeZkcTf/sygDaCWp6JAcjOU387EZaSPRyP02Pfvk+hYholkLatMrp4CbOvL+CoI7NYtbHGGzVVaDhoQAtguoOrz9VT/Oe2/9MGQSZCQ1MB3/na1/CnP/5Oq+zO1ogce/sOMJJ2JiHJpU0saOie4MmKntAOn46AHYgRGNeLUcXyAqIgQ1lQuUwjmjIRhkdAA0xC3Vs5i1s7+uK581bllqV2nm4HA+F3QBjoa/4+9CMJJ+nl9KC3/X5zDULAdpeI4v0qCX4frv9dBkcdmcG6zVTDJZ+iv25Py20IxfsDcjtGuhcfNXxm8hnkswG+dOGn8eC9f0ZQPCRM0MrYMyJsA4JW112kCJG86LCJqQvZl5qhaHcTt/kEYwgbcJaQkEaIPbLadBaNXZ2tmuczZftIR2f5kQfaG55Pf/ucaVbNncu9+4OG8Ns/DIytDGi8iYju6/4p0dMO4HRzENIEdJ+0Qu+WBDO+HOCYYzLY3EVQ7P376nJLHfdzUNHIkONPDrjfk08giRPR0Fi0wtRw0SfOwWOPLECQfw8SXbwfYtgmyFGEOsVYNFI1GYQtVuSbpcwUrAqzNOZtEhFpSRlnixqMTKRJyjYRPbaGzjhJ1ts+uW7j2tqqvr7ihoG/l/jxG0fYYOYCmOnbsIPH/1gGYMAUA4SkBTweMMfh1ApP84808MnOIDmC5CRSj6DA3hO6cM65rahQ5ZC3COzf1bsO2+uz8Ol2n4StG8cJmlubbG9PBz778U9i0VNPIyjsZhOxs0TvoguA2ayWUwOyrRSiGKB3wGP66NNOs6q9HWLBAmIYYWZu4xZu/7M1gIHOGCDLkZTfES4d0iEUhQRWeJtPyNjFbIh1a5di38P7UCyOxNbu2DVlcibQuD2jvNNHixs3SOtTSFiNMWx4MzauW41PnXUOXn1lCYLCLkgIiTLYHQgrTYi/rIAOCZxvCFXp/7ja/y999yNgQbod04jgdu4glvQdxgCEXT+TfIAYkmw/mQDa8YL2xCWTwHl/YgL2BwSXdAuRgunZiPZ1S/Hu/fbi8yQJpQys5eiBHTyX6SOO4J56qtlb2nA5wchRTVjyymJ8/PRzsXZNO1RxPBLy8sNRQLirQGmlAKZr6lZlHUQ0fJuu7TYbSKqfk0BVy0xAFUF+TNU9Ygay/xWLxpyC7unEiiVruIFi+AhC3fL4iGljpdf/9V03/S5btKXs6DGNeObJpzD9pDOxdk0HVMPO0LTldjAMiIZBZFoB7LRDki5vcwawyGggQx3ARHhiAh/7k2bQZaC5KBF3lbHy1Q5EQZYBF8OQ6v8ULnrItNdpZJf2ZUVgDMaOacCD9zyEj576SWwlh7FxjCN+OAwIaZ+hNoiGFot4pGeAy/B2X9uNAaKY8buRoY2QUwbwTGD7gOYGidpWg+UvlRFlqOuXoVZd08XAbdU9GAyFgg7anRuyMHZMAbOvux0fP+Mi9CU5yOIoGIIZDYfzFBFC2lhqJEQj4XLSHjVDa/vmARKDrAFyPtlDQIiU8SuXgdZmgc5VwNLnNTKZDAw3WripYAf5lm4U1Y+Q7foFKeYDxuxUwE9/+HvM+PoPIPIjIKMmGJb8Jo873+DUf34kkCd0hV3esLbqt/rabgwQaVhiADID1KwRJkCtBLQ1C2xZBix91iCb5ZZpGL+Vi4Nfd926bs8/B9PAvSNUFg4kWpozuPSSn+HnP72a7b0JGmBokwHafICTO0XLt+EwgWwrZFMeGi07HBjjbccAlDWPiAGI8DHQVwJGNAOdy4BlT1sU8lQf4F33OH9POXeqqDHoM4/y+xif8XqIWQLkMiEuOv9S3HDdLVBNu8IQJnB9x4l094mCEFGrtYQ1n22GaooQczv50NquDKASIykSIBNQ6hMY1Syw9TVgyUKDoic+l9J9uyXBrgTUPev353MNnZQFNCgWMzA6wZkf+U/cc/eDCJr3gJZ+00kmfsFvRtnImAKIGgX5AiLfLBicH/khE7DdM4FGWnYCS8C4NoE1T1m8+rhFQ95N3DKUE03s0Ag37S9tqJ+WnECnrTnM0xqNTTl0bu3ER6d/AX9/bBGClr2QKMrpN0HQzqNEfM7dF9gEiLAAZBshaPv6XIF3H+FhkqG1nU1ADZa8/7HDgdVPA0v/AbQ0UGdO/wgATYlxhxgleaih2jgGcMUfjdZhWaxbswkfOulzeOnF5QiG7c3zgLy9LO0u4VQ+hAqd5NNGk1TnZ+z5IkROIWjg7oDt9bMH/dp+cwFdAo05IN8FLF1g0VqkfD1Qo4ZaSv8yFrfgWzcFSFD4bhMmQs5uac1i2ZK1OOmE/8KKFVsQtE1EQiVb3neO9p8r+F1GqYwbQQRZIKLnnCYgzcCFvWx9rHdobVcTkFhRiID1j1g0RwK1BKgQ8SVQ9b0hdMtDG/5xRFBsiUVOZfDC4nU47pgLsWZtD4K2PZFQTx57+g0QJO1hzm0yzQASlPbN8EbTrBGyTRZBJCgtoKiRh1aKJfU2X28+A/hdDHPU0NMONMQCI/ICvSUeEeSjbLitnkGQSfIJrpWhmSy4jt9b6sNpp/431qytIGh7FxKu49NeqSTdeb/XMDFAHoIIT8xAfX2pFshmaOtfSNprMEtOYJTu/Py2X9tNA5h1dlNOwe7cAugeIJ8Bei3QQwUiyRAB9V0AyNsnbUBCWsgH+NIlV2DxK6sQjTwAiWyFSFU9ET4i5LCcU/lh/60Ns8wMNspC0MbUkYUsSEuAToMBIHOwrDc9JbrpJSdrK+41D5XaISYeKTAqtGgrAK0RePvUBtpRW4EjNOqyKTC9DIYV8njk4dW45rqFkMV9YeROQDgSggo7lNoNWyxUsxW0Y1emETKi7J93BEnyM3mITABq7eOtaYu0ofOb/YvfWutNZwDqhrEzrPzEkuxfn/xFbf7oqUE0capNhgdgJhiWAVpCoEG5gxiA5uao+745D8z/6yrUKiOtyu8GqBFMfBG2QoZNkFGjEHy4lK8lT5+YgPaFiSJu5pUZy3sQk2ugslbQDu119MgZb/avH/xru8jDZTO5Kzh5dG7PmZFRCw79brS7iGvx0kel4uitt77BCjuAlPTTvFsmsHF1BITjhQxGwUQk5c7BE1EWJshC0B6/YRaWdvkmML4M3Sru4pYR7SAruAuFmnnDnLCtjAMDyeDhGFrbhQFo6IEgTf9bivUX31I+Rhs8ePj3o10D1OJl/5CKAJODbssNIlQaprhfB65lbM1WUuNjEEQjYDMU0ytYtvMZHsagHaEs4aiTxFOnJgGIUzs/AYdQO3+ODtpsxFmHYeUhsg9c280iEhPMMVZNV2J5/KfKMcJi/mE/iMZIG8crFwlFM3zUK0iOoN9HEYbw8TN5qKQNKmplKScGMD7MY8KHAUykuE2Xtw0k5BW/FSfvHMtb0APUuk9+YROFG0PCX1/b1SWifvgZen4wU2VfK9zWc6y2uQcn/zgcoWwcq6e9JujyzZ9U7qUuIhq3CodDhU3Q5MIHIVQUgNx5E0jYQPJeuw4qyMWONrQ01wGZlbz7OA/zuIAB+R4yAaFLNAyt7Y8VPBNTkxnaBjOVeKF8e+8HjczeN/X7wXAFHa94hnZK8bP5DLVJgE05SN0CGVK4J2ADBREoGNoqOBRuzwie3HJMwJuKESMQAxQokSB42McWBXINQG4z7zA7tPzaIUHRTAjHBIF4uvqnzuNEUHxgyvdlI2bpRL0gZYrjR1jBkcpC6pCBnmREKGsk5ZTQETCRgHX4ULDUOkgHJXoy1mmEnCM+9YOYBiDfJGwDvT/uB5V/u68dFhUzEySsCZ4szO07TqjonsmXq6K4Rmu7SEiqCNK8f542Za8pRJFF4pDVHIGzjviGiO9vKd6nSi8zAzUTUZKQnL9GgbgIO7ZZqKRDl9CXtDMHzNxRv37wrB2aFqlrAiUetbPLHwpkeOf7vq2y4jfa2BelzFF+gBpJq0CGZjRJ2onIGQGqLWtS86QFMoS9RGlDxwQ2S56/5VE/KhdQTigZZc1RWSXuXGgWA/l1Ce3wKXbMSPZgWjs8L0ZMMF/bYGog/hrdVD5BiPDPh35HZfBbnWx6Bmq4EsiWOMrjWJ4knVS9JrufIWKTh+9G+Oi+yAlrqSLcICCJSQpA9zCLC/aA6b4D4Z//Jq4k+CYxhXXJoJ/c+R/PALQIFmV+wkww39zYe1pisrcc/o0wM+yQuLrXQsgnnxGgfs4qEZ4km5pIclYkFN41MMEREyPkLNv8oMGKoCgQ5QRGtsAcG8FW7leZy66K75qx8DvXEnr5zJmDf2xre6xBVRSZATYHyUxdfv/e+0c3T/qUHNYeAS91ATYPVKkxhBJEBLkXuVvKFZDaJ+QuOnhfXcJ2kADt1RBvAp78OzDvCX27zXV8DLcP7/VIj3ZH/97BsAYVA9TBE6TQF5nyrjshuqgrtAcszuhsL6PLSpoXRR9VC4m4gUAioWsEIpSBIvxlzVtuWsJyEjqC7tNYDmvuEM9l/kjnd7uHDRF/UC8GUmCMt38qV4ltP/xugSkY4aBj+B29Bu0F8WgaDA88898J2ad5+r8FJ3eH1tAaWkNraA2toTW0htbQGlpDa2gNraE1tPAGrv8F9+RdD5J7jpUAAAAASUVORK5CYII=";
            } catch (_) {
              titleIcon.src = "data:image/png;base64,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";
            }
          });
        } catch (_) {
          titleIcon.src = "data:image/png;base64,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";
        }
        titleIcon.onerror = function () {
          this.style.display = "none";
        };
        const titleText = document.createElement("span");
        titleText.textContent = t("menu.title", "PieTools - Menu");
        title.appendChild(titleIcon);
        title.appendChild(titleText);

        const iconButtons = document.createElement("div");
        iconButtons.style.cssText = "display:flex;gap:12px;";

        function createIconButton(id, iconClass, titleKey, titleFallback) {
          const btn = document.createElement("a");
          btn.id = id;
          btn.href = "#";
          const btnColors = getThemeColors();
          btn.style.cssText = `display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:rgba(${btnColors.rgbString},0.1);border:1px solid ${btnColors.borderRgba};border-radius:10px;color:${btnColors.accent};font-size:18px;text-decoration:none;transition:all 0.3s ease;cursor:pointer;`;
          btn.innerHTML = '<i class="fa-solid ' + iconClass + '"></i>';
          btn.title = t(titleKey, titleFallback);
          btn.onmouseover = function () {
            this.style.background = `rgba(${btnColors.rgbString},0.25)`;
            this.style.transform = "translateY(-2px) scale(1.05)";
            this.style.boxShadow = `0 8px 16px ${btnColors.shadowRgba}`;
            this.style.borderColor = btnColors.accent;
          };
          btn.onmouseout = function () {
            this.style.background = `rgba(${btnColors.rgbString},0.1)`;
            this.style.transform = "translateY(0) scale(1)";
            this.style.boxShadow = "none";
            this.style.borderColor = btnColors.borderRgba;
          };
          iconButtons.appendChild(btn);
          return btn;
        }

        const body = document.createElement("div");
        body.style.cssText =
          "font-size:14px;line-height:1.6;margin-bottom:12px;";

        // Add mouse mode tip for Big Picture
        if (window.__PieTools_IS_BIG_PICTURE__) {
          const tip = document.createElement("div");
          tip.style.cssText =
            "background:rgba(102,192,244,0.15);border-left:3px solid #31D0FC;padding:12px 16px;border-radius:6px;font-size:13px;color:#c7d5e0;margin-bottom:16px;line-height:1.5;";
          tip.innerHTML =
            '<i class="fa-solid fa-info-circle" style="margin-right:8px;color:#31D0FC;"></i>' +
            t(
              "bigpicture.mouseTip",
              "To use mouse mode in Steam: Guide Button + Right Joystick, click with RB",
            );
          body.appendChild(tip);
        }

        const container = document.createElement("div");
        container.style.cssText =
          "margin-top:16px;display:flex;flex-direction:column;gap:12px;align-items:stretch;";

        function createCardButton(id, key, fallback, iconClass) {
          const btn = document.createElement("a");
          btn.id = id;
          btn.href = "#";
          const btnColors = getThemeColors();
          btn.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1;background:rgba(${btnColors.rgbString},0.06);border:1px solid ${btnColors.borderRgba};border-radius:12px;color:${btnColors.text};font-size:11px;font-weight:500;text-decoration:none;transition:all 0.2s ease;cursor:pointer;text-align:center;padding:14px 6px;min-width:0;`;
          const iconHtml = iconClass
            ? '<i class="fa-solid ' +
            iconClass +
            '" style="font-size:22px;color:' +
            btnColors.accent +
            ';"></i>'
            : "";
          const textSpan =
            '<span style="text-align:center;line-height:1.3;">' +
            t(key, fallback) +
            "</span>";
          btn.innerHTML = iconHtml + textSpan;
          btn.onmouseover = function () {
            const c = getThemeColors();
            this.style.background = `rgba(${c.rgbString},0.15)`;
            this.style.transform = "translateY(-2px)";
            this.style.boxShadow = `0 8px 20px ${c.shadow.replace("0.4", "0.15")}`;
            this.style.borderColor = c.accent;
          };
          btn.onmouseout = function () {
            const c = getThemeColors();
            this.style.background = `rgba(${c.rgbString},0.06)`;
            this.style.transform = "translateY(0)";
            this.style.boxShadow = "none";
            this.style.borderColor = c.borderRgba;
          };
          return btn;
        }

        const discordBtn = createIconButton(
          "lt-settings-discord",
          "fa-brands fa-discord",
          "menu.discord",
          "Discord",
        );
        discordBtn.onclick = function (e) {
          e.preventDefault();
          try { overlay.remove(); } catch (_) {}
          openExternalBrowserUrl("https://discord.gg/SkpMMCp6sv");
        };
        // Donate button removed
        const settingsManagerBtn = createIconButton(
          "lt-settings-open-manager",
          "fa-gear",
          "menu.settings",
          "Settings",
        );
        settingsManagerBtn.onclick = function (e) {
          e.preventDefault();
          try { overlay.remove(); } catch (_) {}
          showSettingsManagerPopup(true, showSettingsPopup);
        };
        const closeBtn = createIconButton(
          "lt-settings-close",
          "fa-xmark",
          "settings.close",
          "Close",
        );

        // Check if we are on a game page
        const isGamePage = window.location.href.includes("/app/");



        const removeBtn = document.createElement("a");
        removeBtn.id = "lt-settings-remove-lua";
        removeBtn.href = "#";
        const removeBtnColors = getThemeColors();
        removeBtn.style.cssText = `display:none;align-items:center;justify-content:center;gap:8px;padding:10px 16px;background:rgba(${removeBtnColors.rgbString},0.06);border:1px solid ${removeBtnColors.borderRgba};border-radius:10px;color:${removeBtnColors.textSecondary};font-size:13px;font-weight:500;text-decoration:none;transition:all 0.2s ease;cursor:pointer;text-align:center;`;
        removeBtn.innerHTML =
          '<i class="fa-solid fa-trash-can" style="font-size:13px;"></i><span>' +
          t("menu.removePieTools", "Remove via PieTools") +
          "</span>";
        removeBtn.onmouseover = function () {
          const c = getThemeColors();
          this.style.background = `rgba(${c.rgbString},0.15)`;
          this.style.borderColor = c.accent;
        };
        removeBtn.onmouseout = function () {
          const c = getThemeColors();
          this.style.background = `rgba(${c.rgbString},0.06)`;
          this.style.borderColor = c.borderRgba;
        };
        container.appendChild(removeBtn);

        // Card button grid
        const cardGrid = document.createElement("div");
        cardGrid.style.cssText =
          "display:flex;gap:10px;justify-content:center;";

// Activation card removed

// Achievements card removed

        const checkBtn = createCardButton(
          "lt-settings-check",
          "menu.checkForUpdates",
          "Check Updates",
          "fa-cloud-arrow-down",
        );
        cardGrid.appendChild(checkBtn);

        const blockUpdatesBtn = createCardButton(
          "lt-settings-block-updates",
          "menu.blockUpdates",
          "Block Updates",
          "fa-shield-halved",
        );
        cardGrid.appendChild(blockUpdatesBtn);

        const restartBtn = createCardButton(
          "lt-settings-restart",
          "menu.restartSteam",
          "Restart Steam",
          "fa-power-off",
        );
        cardGrid.appendChild(restartBtn);

        container.appendChild(cardGrid);

        body.appendChild(container);

        header.appendChild(title);
        header.appendChild(iconButtons);
        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Re-scan elements for gamepad navigation
        setTimeout(function () {
          if (window.GamepadNav) {
            window.GamepadNav.scanElements();
          }
        }, 150);

        if (checkBtn) {
          checkBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              overlay.remove();
            } catch (_) { }
            try {
              Millennium.callServerMethod("PieTools", "CheckForUpdatesNow", {
                contentScriptQuery: "",
              }).then(function (res) {
                try {
                  const payload =
                    typeof res === "string" ? JSON.parse(res) : res;
                  if (!payload || !payload.success) {
                    const errMsg = (payload && payload.message) || lt("Could not check for updates.");
                    ShowPieToolsAlert("PieTools", errMsg);
                    return;
                  }
                  if (payload.updateAvailable) {
                    showPieToolsConfirm(
                      "Update Available",
                      (payload.message || ("A new version of PieTools (" + payload.latestVersion + ") is available!")) + "\n\nWould you like to open the GitHub Release page to download it?",
                      function () {
                        const relUrl = payload.releaseUrl || "https://github.com/Pie7nit/PieTools/releases/latest";
                        Millennium.callServerMethod("PieTools", "OpenExternalUrl", { url: relUrl })
                          .catch(function () { window.open(relUrl, "_blank"); });
                      }
                    );
                  } else {
                    ShowPieToolsAlert("PieTools", payload.message || lt("No updates available. You are on the latest version."));
                  }
                } catch (err) {
                  ShowPieToolsAlert("PieTools", lt("Error checking for updates: ") + String(err));
                }
              });
            } catch (_) { }
          });
        }

        if (discordBtn) {
          discordBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try { overlay.remove(); } catch (_) {}
            openExternalBrowserUrl("https://discord.gg/SkpMMCp6sv");
          });
        }

        if (blockUpdatesBtn) {
          blockUpdatesBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try { overlay.remove(); } catch (_) { }
            showBlockUpdatesPage();
          });
        }

        if (restartBtn) {
          restartBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              overlay.remove();
            } catch (_) { }
            doRestartSteam();
          });
        }

        if (closeBtn) {
          closeBtn.addEventListener("click", function (e) {
            e.preventDefault();
            overlay.remove();
          });
        }

        if (achievementsBtn) {
          achievementsBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              overlay.remove();
            } catch (_) { }
            try {
              const match =
                window.location.href.match(
                  /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
                ) ||
                window.location.href.match(
                  /https:\/\/steamcommunity\.com\/app\/(\d+)/,
                );
              const appid = match
                ? parseInt(match[1], 10)
                : window.__PieToolsCurrentAppId || NaN;
              if (isNaN(appid)) {
                const errText = t(
                  "menu.error.noAppId",
                  "Could not determine game AppID",
                );
                ShowPieToolsAlert("PieTools", errText);
                return;
              }
              showAchievementsPopup(appid);
            } catch (err) {
              backendLog("PieTools: Achievements button error: " + err);
            }
          });
        }

        if (donateBtn) {
          donateBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              overlay.remove();
            } catch (_) { }
            showPieToolsDonateModal();
          });
        }

        if (settingsManagerBtn) {
          // This is the icon button now
          settingsManagerBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              overlay.remove();
            } catch (_) { }
            showSettingsManagerPopup(false, showSettingsPopup);
          });
        }

        if (fixesMenuBtn) {
          fixesMenuBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              const match =
                window.location.href.match(
                  /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
                ) ||
                window.location.href.match(
                  /https:\/\/steamcommunity\.com\/app\/(\d+)/,
                );
              const appid = match
                ? parseInt(match[1], 10)
                : window.__PieToolsCurrentAppId || NaN;
              if (isNaN(appid)) {
                try {
                  overlay.remove();
                } catch (_) { }
                const errText = t(
                  "menu.error.noAppId",
                  "Could not determine game AppID",
                );
                ShowPieToolsAlert("PieTools", errText);
                return;
              }

              try {
                overlay.remove();
              } catch (_) { }
              showFixesLoadingPopupAndCheck(appid);
            } catch (err) {
              backendLog("PieTools: Fixes Menu button error: " + err);
            }
          });
        }

        try {
          const match =
            window.location.href.match(
              /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
            ) ||
            window.location.href.match(
              /https:\/\/steamcommunity\.com\/app\/(\d+)/,
            );
          const appid = match
            ? parseInt(match[1], 10)
            : window.__PieToolsCurrentAppId || NaN;
          if (
            !isNaN(appid) &&
            typeof Millennium !== "undefined" &&
            typeof Millennium.callServerMethod === "function"
          ) {
            Millennium.callServerMethod("PieTools", "HasPieToolsForApp", {
              appid,
              contentScriptQuery: "",
            }).then(function (res) {
              try {
                const payload = typeof res === "string" ? JSON.parse(res) : res;
                const exists = !!(
                  payload &&
                  payload.success &&
                  payload.exists === true
                );
                if (exists) {
                  const doDelete = function () {
                    try {
                      Millennium.callServerMethod(
                        "PieTools",
                        "DeletePieToolsForApp",
                        {
                          appid,
                          contentScriptQuery: "",
                        },
                      )
                        .then(function () {
                          try {
                            window.__PieToolsButtonInserted = false;
                            window.__PieToolsPresenceCheckInFlight = false;
                            window.__PieToolsPresenceCheckAppId = undefined;
                            addPieToolsButton();
                            const successText = t(
                              "menu.remove.success",
                              "PieTools removed for this app.",
                            );
                            ShowPieToolsAlert("PieTools", successText);
                          } catch (err) {
                            backendLog(
                              "PieTools: post-delete cleanup failed: " + err,
                            );
                          }
                        })
                        .catch(function (err) {
                          const failureText = t(
                            "menu.remove.failure",
                            "Failed to remove PieTools.",
                          );
                          const errMsg =
                            err && err.message ? err.message : failureText;
                          ShowPieToolsAlert("PieTools", errMsg);
                        });
                    } catch (err) {
                      backendLog("PieTools: doDelete failed: " + err);
                    }
                  };

                  removeBtn.style.display = "flex";
                  removeBtn.onclick = function (e) {
                    e.preventDefault();
                    try {
                      overlay.remove();
                    } catch (_) { }
                    const confirmMessage = t(
                      "menu.remove.confirm",
                      "Remove via PieTools for this game?",
                    );
                    showPieToolsConfirm(
                      "PieTools",
                      confirmMessage,
                      function () {
                        doDelete();
                      },
                      function () {
                        try {
                          showSettingsPopup();
                        } catch (_) { }
                      },
                    );
                  };
                } else {
                  removeBtn.style.display = "none";
                }
              } catch (_) { }
            });
          }
        } catch (_) { }
      });
  }

  function ensureTranslationsLoaded(forceRefresh, preferredLanguage) {
    try {
      if (
        !forceRefresh &&
        window.__PieToolsI18n &&
        window.__PieToolsI18n.ready
      ) {
        return Promise.resolve(window.__PieToolsI18n);
      }
      if (
        typeof Millennium === "undefined" ||
        typeof Millennium.callServerMethod !== "function"
      ) {
        window.__PieToolsI18n = window.__PieToolsI18n || {
          language: "en",
          locales: [],
          strings: {},
          ready: false,
        };
        return Promise.resolve(window.__PieToolsI18n);
      }
      const settingsVals =
        ((window.__PieToolsSettings || {}).values || {}).general || {};
      const useSteamLang =
        typeof settingsVals.useSteamLanguage === "boolean"
          ? settingsVals.useSteamLanguage
          : true;
      let targetLanguage =
        typeof preferredLanguage === "string" && preferredLanguage
          ? preferredLanguage
          : "";
      if (!targetLanguage) {
        let steamLang = document.documentElement.lang || "en";
        if (steamLang.toLowerCase() === "pt-br") steamLang = "pt-BR";
        if (steamLang.toLowerCase() === "zh-cn") steamLang = "zh-CN";
        if (steamLang.toLowerCase() === "zh-tw") steamLang = "zh-TW";
        if (steamLang.toLowerCase() === "es-419") steamLang = "es";
        targetLanguage = useSteamLang
          ? steamLang
          : (window.__PieToolsI18n && window.__PieToolsI18n.language) || "en";
      }
      return Millennium.callServerMethod("PieTools", "GetTranslations", {
        language: targetLanguage,
        contentScriptQuery: "",
      })
        .then(function (res) {
          const payload = typeof res === "string" ? JSON.parse(res) : res;
          if (!payload || payload.success !== true || !payload.strings) {
            throw new Error("Invalid translation payload");
          }
          applyTranslationBundle(payload);
          // Update button text after translations are loaded
          updateButtonTranslations();
          return window.__PieToolsI18n;
        })
        .catch(function (err) {
          backendLog("PieTools: translation load failed: " + err);
          window.__PieToolsI18n = window.__PieToolsI18n || {
            language: "en",
            locales: [],
            strings: {},
            ready: false,
          };
          return window.__PieToolsI18n;
        });
    } catch (err) {
      backendLog("PieTools: ensureTranslationsLoaded error: " + err);
      window.__PieToolsI18n = window.__PieToolsI18n || {
        language: "en",
        locales: [],
        strings: {},
        ready: false,
      };
      return Promise.resolve(window.__PieToolsI18n);
    }
  }

  function translateText(key, fallback) {
    if (!key) {
      return typeof fallback !== "undefined" ? fallback : "";
    }
    try {
      const store = window.__PieToolsI18n;
      if (
        store &&
        store.strings &&
        Object.prototype.hasOwnProperty.call(store.strings, key)
      ) {
        const value = store.strings[key];
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed && trimmed.toLowerCase() !== TRANSLATION_PLACEHOLDER) {
            return value;
          }
        }
      }
    } catch (_) { }
    return typeof fallback !== "undefined" ? fallback : key;
  }

  function t(key, fallback) {
    return translateText(key, fallback);
  }

  function lt(text) {
    return t(text, text);
  }

  // Translations are loaded by fetchSettingsConfig() in onFrontendReady â€” no separate preload needed.


  // ═══════════════════════════════════════════════════
  // Block Updates Page — Lists ALL installed games with toggle switches
  // ═══════════════════════════════════════════════════
  function showBlockUpdatesPage() {
    ensurePieToolsStyles();
    ensureFontAwesome();
    var colors = getThemeColors();

    var old = document.querySelector(".PieTools-block-updates-overlay");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.className = "PieTools-block-updates-overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:99999;display:flex;justify-content:center;align-items:center;animation:fadeIn 0.15s ease-out;";

    var modal = document.createElement("div");
    modal.style.cssText = "position:relative;background:linear-gradient(135deg, #0b1120 0%, #1e293b 100%);color:#ffffff;border:1px solid rgba(49,208,252,0.3);border-radius:16px;width:680px;max-height:85vh;padding:22px 26px;box-shadow:0 24px 80px rgba(0,0,0,.7), 0 0 30px rgba(49,208,252,0.15);display:flex;flex-direction:column;";

    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid rgba(49,208,252,0.2);flex-shrink:0;";

    var titleDiv = document.createElement("div");
    titleDiv.style.cssText = "display:flex;align-items:center;gap:12px;font-size:20px;font-weight:700;";
    titleDiv.innerHTML = '<i class="fa-solid fa-shield-halved" style="color:#31D0FC;"></i> Update Blocker';

    var closeBtn = document.createElement("button");
    closeBtn.style.cssText = "background:rgba(49,208,252,0.08);border:1px solid rgba(49,208,252,0.25);color:#ffffff;font-size:16px;cursor:pointer;padding:6px 12px;border-radius:8px;transition:all 0.2s;";
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.onclick = function () { overlay.remove(); };
    closeBtn.onmouseover = function () { this.style.background = "rgba(49,208,252,0.2)"; this.style.borderColor = "#31D0FC"; };
    closeBtn.onmouseout = function () { this.style.background = "rgba(49,208,252,0.08)"; this.style.borderColor = "rgba(49,208,252,0.25)"; };

    header.appendChild(titleDiv);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    var listContainer = document.createElement("div");
    listContainer.style.cssText = "overflow-y:auto;flex:1;padding-right:6px;";
    listContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin" style="font-size:26px;color:#31D0FC;margin-bottom:12px;display:block;"></i>Loading installed games...</div>';

    modal.appendChild(listContainer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });

    Millennium.callServerMethod("PieTools", "GetInstalledGames", { contentScriptQuery: "" })
      .then(function (res) {
        var data = typeof res === "string" ? JSON.parse(res) : res;
        if (!data || !data.success || !data.games || data.games.length === 0) {
          listContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;"><i class="fa-solid fa-circle-exclamation" style="font-size:24px;color:#f43f5e;margin-bottom:12px;display:block;"></i>No installed games found.</div>';
          return;
        }

        var games = data.games;
        games.sort(function (a, b) {
          if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
          return (a.name || "").localeCompare(b.name || "");
        });

        listContainer.innerHTML = "";

        var statsBar = document.createElement("div");
        var blockedCount = games.filter(function (g) { return g.blocked; }).length;
        statsBar.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:10px 14px;margin-bottom:14px;background:rgba(49,208,252,0.06);border:1px solid rgba(49,208,252,0.2);border-radius:10px;font-size:13px;color:#94a3b8;";
        statsBar.innerHTML = '<span>' + games.length + ' games installed</span><span style="color:#31D0FC;font-weight:600;">' + blockedCount + ' updates blocked</span>';
        listContainer.appendChild(statsBar);

        for (var i = 0; i < games.length; i++) {
          (function (game) {
            var row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;margin-bottom:8px;background:rgba(15,23,42,0.6);border:1px solid rgba(49,208,252,0.15);border-radius:10px;transition:all 0.2s;";
            row.onmouseover = function () { this.style.background = "rgba(49,208,252,0.08)"; this.style.borderColor = "rgba(49,208,252,0.6)"; };
            row.onmouseout = function () { this.style.background = "rgba(15,23,42,0.6)"; this.style.borderColor = "rgba(49,208,252,0.15)"; };

            var nameDiv = document.createElement("div");
            nameDiv.style.cssText = "display:flex;align-items:center;gap:10px;flex:1;min-width:0;";
            var nameText = document.createElement("span");
            nameText.style.cssText = "font-size:14px;color:#ffffff;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            nameText.textContent = game.name || ("AppID " + game.appid);
            var appidText = document.createElement("span");
            appidText.style.cssText = "font-size:11px;color:#94a3b8;flex-shrink:0;";
            appidText.textContent = "#" + game.appid;
            nameDiv.appendChild(nameText);
            nameDiv.appendChild(appidText);

            var toggleWrap = document.createElement("label");
            toggleWrap.className = "PieTools-toggle";
            toggleWrap.style.cssText = "flex-shrink:0;margin-left:12px;cursor:pointer;";
            var toggleInput = document.createElement("input");
            toggleInput.type = "checkbox";
            toggleInput.checked = !!game.blocked;
            var toggleSlider = document.createElement("span");
            toggleSlider.className = "PieTools-slider";

            toggleInput.addEventListener("change", function () {
              var checked = this.checked;
              var method = checked ? "BlockUpdates" : "UnblockUpdates";
              var inp = this;
              inp.disabled = true;
              Millennium.callServerMethod("PieTools", method, { appId: String(game.appid) })
                .then(function (r) {
                  var d = typeof r === "string" ? JSON.parse(r) : r;
                  inp.disabled = false;
                  if (!d || !d.success) { inp.checked = !checked; }
                  var allToggles = listContainer.querySelectorAll(".PieTools-toggle input[type=checkbox]");
                  var bc = 0;
                  for (var t = 0; t < allToggles.length; t++) { if (allToggles[t].checked) bc++; }
                  var statsSpans = statsBar.querySelectorAll("span");
                  if (statsSpans.length > 1) statsSpans[1].textContent = bc + " updates blocked";
                })
                .catch(function () {
                  inp.disabled = false;
                  inp.checked = !checked;
                });
            });

            toggleWrap.appendChild(toggleInput);
            toggleWrap.appendChild(toggleSlider);

            row.appendChild(nameDiv);
            row.appendChild(toggleWrap);
            listContainer.appendChild(row);
          })(games[i]);
        }
      })
      .catch(function (err) {
        listContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#f43f5e;"><i class="fa-solid fa-circle-exclamation" style="font-size:24px;margin-bottom:12px;display:block;"></i>Error loading games: ' + String(err) + '</div>';
      });
  }

  
  function openExternalBrowserUrl(url) {
    try {
      if (typeof Millennium !== "undefined" && Millennium.callServerMethod) {
        Millennium.callServerMethod("PieTools", "OpenExternalUrl", { url: url });
      }
    } catch (_) {}
    try {
      if (typeof SteamClient !== "undefined" && SteamClient.System && typeof SteamClient.System.OpenInSystemBrowser === "function") {
        SteamClient.System.OpenInSystemBrowser(url);
      }
    } catch (_) {}
    try {
      window.open(url, "_blank");
    } catch (_) {}
  }

function doRestartSteam() {
    var _contexts = [
      window && window.SteamClient,
      window && window.top && window.top.SteamClient,
      window && window.parent && window.parent.SteamClient,
      (typeof top !== "undefined") ? top && top.SteamClient : undefined,
      (typeof parent !== "undefined") ? parent && parent.SteamClient : undefined,
    ];
    for (var _ci = 0; _ci < _contexts.length; _ci++) {
      try {
        var _sc = _contexts[_ci];
        if (_sc && _sc.User && typeof _sc.User.StartRestart === "function") {
          _sc.User.StartRestart(false);
          return;
        }
      } catch (_) {}
    }

    try {
      if (typeof Millennium !== "undefined" && Millennium.callServerMethod) {
        Millennium.callServerMethod("PieTools", "RestartSteam", {});
      }
    } catch (_) { }
  }

  function askRestartConfirmation() {
    showPieToolsConfirm(
      "PieTools",
      lt("Restart Steam now?"),
      function () {
        doRestartSteam();
      },
      function () {
        /* Cancel - do nothing */
      },
    );
  }

  let settingsMenuPending = false;

  // Helper: show a Steam-style popup with a 10s loading bar (custom UI)
  function showTestPopup() {
    // PieTools GLOBAL INTERCEPT - redirect to our download UI
    const _sd_match = window.location.href.match(/\/app\/(\d+)/);
    const _sd_appid = _sd_match ? parseInt(_sd_match[1]) : null;
    if (_sd_appid) {
      showPieToolsUnlockProgress(_sd_appid);
      return;
    }


    // Avoid duplicates
    if (document.querySelector(".PieTools-overlay")) return;
    // Close settings popup if open so modals don't overlap
    try {
      const s = document.querySelector(".PieTools-settings-overlay");
      if (s) s.remove();
    } catch (_) { }

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:520px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const title = document.createElement("div");
    const titleColors = getThemeColors();
    title.style.cssText = `display:flex;align-items:center;gap:10px;font-size:20px;color:${titleColors.text};margin-bottom:16px;font-weight:600;`;
    title.className = "PieTools-title";
    const dlTitleIcon = document.createElement("i");
    dlTitleIcon.className = "fa-solid fa-cloud-arrow-down";
    dlTitleIcon.style.cssText = `color:${titleColors.accent};font-size:20px;`;
    title.appendChild(dlTitleIcon);
    const dlTitleText = document.createElement("span");
    dlTitleText.textContent = lt("Select Download Source");
    title.appendChild(dlTitleText);

    // API list container
    const apiListContainer = document.createElement("div");
    apiListContainer.className = "PieTools-api-list";
    apiListContainer.style.cssText = "margin-bottom:16px;";

    // Placeholder while loading APIs
    const loadingItem = document.createElement("div");
    loadingItem.style.cssText = `text-align:center;padding:10px;color:${colors.textSecondary};font-size:13px;`;
    loadingItem.textContent = lt("Loading APIs...");
    apiListContainer.appendChild(loadingItem);

    // Load APIs dynamically from backend
    if (
      typeof Millennium !== "undefined" &&
      typeof Millennium.callServerMethod === "function"
    ) {
      Millennium.callServerMethod("PieTools", "GetApiList", {
        contentScriptQuery: "",
      })
        .then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (
              payload &&
              payload.success &&
              payload.apis &&
              Array.isArray(payload.apis)
            ) {
              // Clear loading message
              apiListContainer.innerHTML = "";

              // Create API items
              payload.apis.forEach((api, index) => {
                const apiItem = document.createElement("div");
                apiItem.className = `PieTools-api-item PieTools-api-${index}`;
                apiItem.setAttribute("data-api-name", api.name);
                apiItem.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 14px;margin-bottom:8px;background:rgba(${colors.rgbString},0.1);border:1px solid ${colors.borderRgba};border-radius:6px;transition:all 0.2s;`;

                const apiName = document.createElement("div");
                apiName.className = "PieTools-api-name";
                apiName.style.cssText = `font-size:14px;color:${colors.textSecondary};font-weight:500;`;
                apiName.textContent = api.name;

                const apiStatus = document.createElement("div");
                apiStatus.className = "PieTools-api-status";
                apiStatus.style.cssText = `font-size:14px;color:${colors.textSecondary};display:flex;align-items:center;gap:6px;`;
                apiStatus.innerHTML =
                  "<span>" +
                  lt("Waitingâ€¦") +
                  "</span>" +
                  '<i class="fa-solid fa-spinner" style="animation: spin 1.5s linear infinite;"></i>';

                apiItem.appendChild(apiName);
                apiItem.appendChild(apiStatus);
                apiListContainer.appendChild(apiItem);
              });
            }
          } catch (err) {
            backendLog("Failed to parse API list: " + err);
          }
        })
        .catch(function (err) {
          backendLog("Failed to load API list: " + err);
        });
    }

    const body = document.createElement("div");
    body.style.cssText = `display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;line-height:1.4;margin-bottom:12px;color:${colors.textSecondary};`;
    body.className = "PieTools-status";
    body.innerHTML =
      '<i class="fa-solid fa-spinner" style="font-size:14px;animation: spin 1.5s linear infinite;"></i><span>' +
      lt("Checking availabilityâ€¦") +
      "</span>";

    const progressWrap = document.createElement("div");
    progressWrap.style.cssText = `background:rgba(0,0,0,0.3);height:20px;border-radius:4px;overflow:hidden;position:relative;display:none;border:1px solid ${colors.border};margin-top:12px;`;
    progressWrap.className = "PieTools-progress-wrap";
    const progressBar = document.createElement("div");
    progressBar.style.cssText = `height:100%;width:0%;background:${colors.gradient};transition:width 0.3s ease;box-shadow:0 0 10px ${colors.shadow};`;
    progressBar.className = "PieTools-progress-bar";
    progressWrap.appendChild(progressBar);

    const progressInfo = document.createElement("div");
    progressInfo.style.cssText = `display:none;margin-top:8px;font-size:12px;color:${colors.textSecondary};`;
    progressInfo.className = "PieTools-progress-info";

    const percent = document.createElement("span");
    percent.className = "PieTools-percent";
    percent.textContent = "0%";

    const downloadSize = document.createElement("span");
    downloadSize.className = "PieTools-download-size";
    downloadSize.style.cssText = "margin-left:12px;";
    downloadSize.textContent = "";

    progressInfo.appendChild(percent);
    progressInfo.appendChild(downloadSize);

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "margin-top:20px;display:flex;gap:8px;justify-content:center;";
    const cancelBtn = document.createElement("a");
    cancelBtn.className = "PieTools-btn PieTools-cancel-btn";
    cancelBtn.style.cssText =
      "display:none;align-items:center;justify-content:center;text-align:center;";
    cancelBtn.innerHTML = `<span>${lt("Cancel")}</span>`;
    cancelBtn.href = "#";
    cancelBtn.onclick = function (e) {
      e.preventDefault();
      cancelOperation();
    };
    const hideBtn = document.createElement("a");
    hideBtn.className = "PieTools-btn PieTools-hide-btn";
    hideBtn.style.cssText =
      "display:flex;align-items:center;justify-content:center;text-align:center;";
    hideBtn.innerHTML = `<span>${lt("Hide")}</span>`;
    hideBtn.href = "#";
    hideBtn.onclick = function (e) {
      e.preventDefault();
      cleanup();
    };
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(hideBtn);

    modal.appendChild(title);
    modal.appendChild(apiListContainer);
    modal.appendChild(body);
    modal.appendChild(progressWrap);
    modal.appendChild(progressInfo);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);

    function cleanup() {
      overlay.remove();
    }

    function cancelOperation() {
      // Call backend to cancel the operation
      try {
        const match =
          window.location.href.match(
            /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
          ) ||
          window.location.href.match(
            /https:\/\/steamcommunity\.com\/app\/(\d+)/,
          );
        const appid = match
          ? parseInt(match[1], 10)
          : window.__PieToolsCurrentAppId || NaN;
        if (
          !isNaN(appid) &&
          typeof Millennium !== "undefined" &&
          typeof Millennium.callServerMethod === "function"
        ) {
          Millennium.callServerMethod("PieTools", "CancelAddViaPieTools", {
            appid,
            contentScriptQuery: "",
          });
        }
      } catch (_) { }
      // Update UI to show cancelled
      const status = overlay.querySelector(".PieTools-status");
      if (status) status.textContent = lt("Cancelled");
      const cancelBtn = overlay.querySelector(".PieTools-cancel-btn");
      if (cancelBtn) cancelBtn.style.display = "none";
      const hideBtn = overlay.querySelector(".PieTools-hide-btn");
      if (hideBtn) hideBtn.innerHTML = `<span>${lt("Close")}</span>`;
      // Hide progress UI
      const wrap = overlay.querySelector(".PieTools-progress-wrap");
      const progressInfo = overlay.querySelector(".PieTools-progress-info");
      if (wrap) wrap.style.display = "none";
      if (progressInfo) progressInfo.style.display = "none";
      // Reset run state
      runState.inProgress = false;
      runState.appid = null;
    }
  }

  // Fixes Results popup
  function showFixesResultsPopup(data, isGameInstalled) {
    if (document.querySelector(".PieTools-fixes-results-overlay")) return;
    // Close other popups
    try {
      const d = document.querySelector(".PieTools-overlay");
      if (d) d.remove();
    } catch (_) { }
    try {
      const s = document.querySelector(".PieTools-settings-overlay");
      if (s) s.remove();
    } catch (_) { }
    try {
      const f = document.querySelector(".PieTools-fixes-results-overlay");
      if (f) f.remove();
    } catch (_) { }
    try {
      const l = document.querySelector(".PieTools-loading-fixes-overlay");
      if (l) l.remove();
    } catch (_) { }

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-fixes-results-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `position:relative;background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:640px;max-height:80vh;display:flex;flex-direction:column;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const header = document.createElement("div");
    header.style.cssText = `flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${colors.borderRgba};`;

    const title = document.createElement("div");
    title.style.cssText = `display:flex;align-items:center;gap:10px;font-size:22px;color:${colors.text};font-weight:600;`;
    const titleIcon = document.createElement("i");
    titleIcon.className = "fa-solid fa-key";
    titleIcon.style.cssText = `color:${colors.accent};font-size:20px;`;
    const titleText = document.createElement("span");
    titleText.textContent = "PieTools · Activation";
    title.appendChild(titleIcon);
    title.appendChild(titleText);

    const iconButtons = document.createElement("div");
    iconButtons.style.cssText = "display:flex;gap:12px;";

    function createIconButton(id, iconClass, titleKey, titleFallback) {
      const btn = document.createElement("a");
      btn.id = id;
      btn.href = "#";
      const btnColors = getThemeColors();
      btn.style.cssText = `display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:rgba(${btnColors.rgbString},0.1);border:1px solid ${btnColors.borderRgba};border-radius:10px;color:${btnColors.accent};font-size:18px;text-decoration:none;transition:all 0.3s ease;cursor:pointer;`;
      btn.innerHTML = '<i class="fa-solid ' + iconClass + '"></i>';
      btn.title = t(titleKey, titleFallback);
      btn.onmouseover = function () {
        this.style.background = `rgba(${btnColors.rgbString},0.25)`;
        this.style.transform = "translateY(-2px) scale(1.05)";
        this.style.boxShadow = `0 8px 16px ${btnColors.shadowRgba}`;
        this.style.borderColor = btnColors.accent;
      };
      btn.onmouseout = function () {
        this.style.background = `rgba(${btnColors.rgbString},0.1)`;
        this.style.transform = "translateY(0) scale(1)";
        this.style.boxShadow = "none";
        this.style.borderColor = btnColors.borderRgba;
      };
      iconButtons.appendChild(btn);
      return btn;
    }

    const discordBtn = createIconButton(
      "lt-fixes-discord",
      "fa-brands fa-discord",
      "menu.discord",
      "Discord",
    );
    const settingsBtn = createIconButton(
      "lt-fixes-settings",
      "fa-gear",
      "menu.settings",
      "Settings",
    );
    const closeIconBtn = createIconButton(
      "lt-fixes-close",
      "fa-xmark",
      "settings.close",
      "Close",
    );

    const body = document.createElement("div");
    const bodyColors = getThemeColors();
    body.style.cssText = `flex:1 1 auto;overflow-y:auto;padding:20px;border:1px solid ${bodyColors.border};border-radius:12px;background:${bodyColors.bgContainer};`;

    try {
      const bannerImg = document.querySelector(".game_header_image_full");
      if (bannerImg && bannerImg.src) {
        body.style.background = `linear-gradient(to bottom, rgba(15, 15, 15, 0.85), #0f0f0f 70%), url('${bannerImg.src}') no-repeat top center`;
        body.style.backgroundSize = "cover";
      }
    } catch (_) { }

    // Add mouse mode tip for Big Picture
    if (window.__PieTools_IS_BIG_PICTURE__) {
      const tip = document.createElement("div");
      tip.style.cssText =
        "background:rgba(102,192,244,0.15);border-left:3px solid #31D0FC;padding:12px 16px;border-radius:6px;font-size:13px;color:#c7d5e0;margin-bottom:16px;line-height:1.5;";
      tip.innerHTML =
        '<i class="fa-solid fa-info-circle" style="margin-right:8px;color:#31D0FC;"></i>' +
        t(
          "bigpicture.mouseTip",
          "To use mouse mode in Steam: Guide Button + Right Joystick, click with RB",
        );
      body.appendChild(tip);
    }

    const gameHeader = document.createElement("div");
    gameHeader.style.cssText =
      "display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:16px;";

    const gameIcon = document.createElement("img");
    gameIcon.style.cssText =
      "width:32px;height:32px;border-radius:4px;object-fit:cover;display:none;";
    try {
      const iconImg = document.querySelector(".apphub_AppIcon img");
      if (iconImg && iconImg.src) {
        gameIcon.src = iconImg.src;
        gameIcon.style.display = "block";
      }
    } catch (_) { }

    const gameName = document.createElement("div");
    gameName.style.cssText =
      "font-size:22px;color:#fff;font-weight:600;text-align:center;";
    gameName.textContent = data.gameName || lt("Unknown Game");

    if (
      !data.gameName ||
      data.gameName === "Unknown Game" ||
      data.gameName === lt("Unknown Game") ||
      data.gameName.startsWith("Unknown Game")
    ) {
      fetchSteamGameName(data.appid).then(function (name) {
        if (name) {
          data.gameName = name;
          gameName.textContent = name;
        }
      });
    }

    const contentContainer = document.createElement("div");
    contentContainer.style.position = "relative";
    contentContainer.style.zIndex = "1";

    const columnsContainer = document.createElement("div");
    columnsContainer.style.cssText =
      "display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:16px;";

    function createFixButton(label, text, icon, isSuccess, onClick) {
      const btn = document.createElement("a");
      btn.href = "#";
      const btnColors = getThemeColors();
      btn.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1 1 calc(50% - 10px);min-width:140px;box-sizing:border-box;padding:14px 6px;background:rgba(${btnColors.rgbString},0.06);border:1px solid ${btnColors.borderRgba};border-radius:12px;color:${btnColors.text};text-decoration:none;transition:all 0.2s ease;cursor:pointer;text-align:center;`;

      const iconHtml =
        '<i class="fa-solid ' + icon + '" style="font-size:22px;"></i>';
      const labelHtml =
        '<span style="font-weight:600;font-size:13px;line-height:1.2;">' +
        label +
        "</span>";
      const textHtml =
        '<span style="font-size:11px;opacity:0.8;line-height:1.2;">' +
        text +
        "</span>";
      btn.innerHTML = iconHtml + labelHtml + textHtml;

      // If the active theme is light, make certain fix action texts/icons white for readability.
      try {
        const currentThemeKey =
          (((window.__PieToolsSettings || {}).values || {}).general || {})
            .theme || "original";
        // Use localized labels so this works in other languages
        const applyLabel = lt("Apply");
        const onlineUnsteamLabel = lt("Online Fix (Unsteam)");
        const noOnlineLabel = lt("No online-fix");
        const unfixLabel = lt("Un-Fix (verify game)");
        const noGenericLabel = lt("No generic fix");
        const whiteTexts = new Set([
          applyLabel,
          onlineUnsteamLabel,
          noOnlineLabel,
          unfixLabel,
          noGenericLabel,
        ]);
        if (currentThemeKey === "light" && whiteTexts.has(String(text))) {
          btn
            .querySelectorAll("span, i")
            .forEach((el) => (el.style.color = "#ffffff"));
        }
      } catch (_) { }

      if (isSuccess) {
        btn.style.background =
          "linear-gradient(135deg, rgba(92,156,62,0.4) 0%, rgba(92,156,62,0.2) 100%)";
        btn.style.borderColor = "rgba(92,156,62,0.6)";
        btn.onmouseover = function () {
          this.style.background =
            "linear-gradient(135deg, rgba(92,156,62,0.6) 0%, rgba(92,156,62,0.3) 100%)";
          this.style.transform = "translateY(-2px)";
          this.style.boxShadow = "0 8px 20px rgba(92,156,62,0.3)";
          this.style.borderColor = "#79c754";
        };
        btn.onmouseout = function () {
          this.style.background =
            "linear-gradient(135deg, rgba(92,156,62,0.4) 0%, rgba(92,156,62,0.2) 100%)";
          this.style.transform = "translateY(0)";
          this.style.boxShadow = "none";
          this.style.borderColor = "rgba(92,156,62,0.6)";
        };
      } else if (isSuccess === false) {
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
      } else {
        const mutableColors = getThemeColors();
        btn.onmouseover = function () {
          const c = getThemeColors();
          this.style.background = `linear-gradient(135deg, rgba(${c.rgbString},0.3) 0%, rgba(${c.rgbString},0.15) 100%)`;
          this.style.transform = "translateY(-2px)";
          this.style.boxShadow = `0 8px 20px rgba(${c.rgbString},0.25)`;
          this.style.borderColor = c.accent;
        };
        btn.onmouseout = function () {
          const c = getThemeColors();
          this.style.background = `linear-gradient(135deg, rgba(${c.rgbString},0.15) 0%, rgba(${c.rgbString},0.05) 100%)`;
          this.style.transform = "translateY(0)";
          this.style.boxShadow = "none";
          this.style.borderColor = c.border;
        };
      }

      btn.onclick = onClick;
      return btn;
    }

    // PieTools unlock button
    const unlockBtn = createFixButton(
      "PieTools Unlock",
      "Download Game Manifest",
      "fa-key",
      null,
      function (e) {
        e.preventDefault();
        try {
          overlay.remove();
        } catch (_) { }
        showPieToolsUnlockProgress(data.appid);
      }
    );
    // Make it take the full width instead of 50%
    unlockBtn.style.flex = "1 1 100%";
    unlockBtn.style.padding = "24px 6px";
    columnsContainer.appendChild(unlockBtn);



    // body moment
    gameHeader.appendChild(gameIcon);
    gameHeader.appendChild(gameName);
    contentContainer.appendChild(gameHeader);

    contentContainer.appendChild(columnsContainer);

    if (!isGameInstalled) {
      const notInstalledWarning = document.createElement("div");
      notInstalledWarning.style.cssText =
        "margin-top: 16px; padding: 12px; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px; color: #ffc107; font-size: 13px; text-align: center;";
      notInstalledWarning.innerHTML =
        '<i class="fa-solid fa-circle-info" style="margin-right: 8px;"></i>' +
        t("menu.error.notInstalled", "Game is not installed");
      contentContainer.appendChild(notInstalledWarning);
    }

    body.appendChild(contentContainer);

    // header moment
    header.appendChild(title);
    header.appendChild(iconButtons);

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "flex:0 0 auto;margin-top:16px;display:flex;gap:8px;justify-content:space-between;align-items:center;";

    const rightButtons = document.createElement("div");
    rightButtons.style.cssText = "display:flex;gap:8px;";
    const gameFolderBtn = document.createElement("a");
    gameFolderBtn.className = "PieTools-btn";
    gameFolderBtn.innerHTML = `<span><i class="fa-solid fa-folder" style="margin-right: 8px;"></i>${lt("Game folder")}</span>`;
    gameFolderBtn.href = "#";
    gameFolderBtn.onclick = function (e) {
      e.preventDefault();
      if (window.__PieToolsGameInstallPath) {
        try {
          Millennium.callServerMethod("PieTools", "OpenGameFolder", {
            path: window.__PieToolsGameInstallPath,
            contentScriptQuery: "",
          });
        } catch (err) {
          backendLog("PieTools: Failed to open game folder: " + err);
        }
      }
    };
    rightButtons.appendChild(gameFolderBtn);

    const backBtn = document.createElement("a");
    backBtn.className = "PieTools-btn";
    backBtn.innerHTML = '<span><i class="fa-solid fa-arrow-left"></i></span>';
    backBtn.href = "#";
    backBtn.onclick = function (e) {
      e.preventDefault();
      try {
        overlay.remove();
      } catch (_) { }
      showSettingsPopup();
    };
    btnRow.appendChild(backBtn);
    btnRow.appendChild(rightButtons);

    // final modal
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);

    closeIconBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
    };
    discordBtn.onclick = function (e) {
      e.preventDefault();
      try {
        overlay.remove();
      } catch (_) { }
      const url = "https://discord.gg/SkpMMCp6sv";
      try {
        Millennium.callServerMethod("PieTools", "OpenExternalUrl", {
          url,
          contentScriptQuery: "",
        });
      } catch (_) { }
    };
    settingsBtn.onclick = function (e) {
      e.preventDefault();
      try {
        overlay.remove();
      } catch (_) { }
      showSettingsManagerPopup(false, function () {
        showFixesResultsPopup(data, isGameInstalled);
      });
    };

    function startUnfix(appid) {
      try {
        Millennium.callServerMethod("PieTools", "UnFixGame", {
          appid: appid,
          installPath: window.__PieToolsGameInstallPath,
          contentScriptQuery: "",
        })
          .then(function (res) {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (payload && payload.success) {
              showUnfixProgress(appid);
            } else {
              const errorKey =
                payload && payload.error ? String(payload.error) : "";
              const errorMsg =
                errorKey &&
                  (errorKey.startsWith("menu.error.") ||
                    errorKey.startsWith("common."))
                  ? t(errorKey)
                  : errorKey || lt("Failed to start un-fix");
              ShowPieToolsAlert("PieTools", errorMsg);
            }
          })
          .catch(function () {
            const msg = lt("Error starting un-fix");
            ShowPieToolsAlert("PieTools", msg);
          });
      } catch (err) {
        backendLog("PieTools: Un-Fix start error: " + err);
      }
    }
  }

  function showFixesLoadingPopupAndCheck(appid) {
    if (document.querySelector(".PieTools-loading-fixes-overlay")) return;
    try {
      const d = document.querySelector(".PieTools-overlay");
      if (d) d.remove();
    } catch (_) { }
    try {
      const s = document.querySelector(".PieTools-settings-overlay");
      if (s) s.remove();
    } catch (_) { }
    try {
      const f = document.querySelector(".PieTools-fixes-overlay");
      if (f) f.remove();
    } catch (_) { }

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-loading-fixes-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:480px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const title = document.createElement("div");
    const titleColorsLoading = getThemeColors();
    title.style.cssText = `font-size:22px;color:${titleColorsLoading.text};margin-bottom:16px;font-weight:600;`;
    title.innerHTML = '<i class="fa-solid fa-key" style="margin-right:10px;color:' + titleColorsLoading.accent + ';"></i>PieTools \u00b7 Activation';

    const body = document.createElement("div");
    const bodyColorsLoading = getThemeColors();
    body.style.cssText = `font-size:14px;line-height:1.6;margin-bottom:16px;color:${bodyColorsLoading.textSecondary};`;
    body.textContent = "Connecting to server... Please wait.";

    const progressWrap = document.createElement("div");
    const progressColorsLoading = getThemeColors();
    progressWrap.style.cssText = `background:rgba(0,0,0,0.3);height:12px;border-radius:4px;overflow:hidden;position:relative;border:1px solid ${progressColorsLoading.border};`;
    const progressBar = document.createElement("div");
    progressBar.style.cssText = `height:100%;width:0%;background:${progressColorsLoading.gradient};transition:width 0.2s linear;box-shadow:0 0 10px ${progressColorsLoading.shadow};`;
    progressWrap.appendChild(progressBar);

    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(progressWrap);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);

    let progress = 0;
    const progressInterval = setInterval(function () {
      if (progress < 95) {
        progress += Math.random() * 5;
        progressBar.style.width = Math.min(progress, 95) + "%";
      }
    }, 150);

    setTimeout(function () {
      clearInterval(progressInterval);
      progressBar.style.width = "100%";
      setTimeout(function () {
        try {
          const l = document.querySelector(".PieTools-loading-fixes-overlay");
          if (l) l.remove();
        } catch (_) { }

        const isGameInstalled = window.__PieToolsGameIsInstalled === true;
        const payload = {
          success: true,
          appid: appid,
          gameName: "Unknown Game",
          genericFix: { status: 404 },
          onlineFix: { status: 404 }
        };
        showFixesResultsPopup(payload, isGameInstalled);
      }, 300);
    }, 1200);
  }

  // Apply Fix function
  function applyFix(appid, downloadUrl, fixType, gameName, resultsOverlay) {
    try {
      // Close results overlay
      if (resultsOverlay) {
        resultsOverlay.remove();
      }

      // Check if we have the game install path
      if (!window.__PieToolsGameInstallPath) {
        const msg = lt("Game install path not found");
        ShowPieToolsAlert("PieTools", msg);
        return;
      }

      backendLog("PieTools: Applying fix " + fixType + " for appid " + appid);

      // Start the download and extraction process
      Millennium.callServerMethod("PieTools", "ApplyGameFix", {
        appid: appid,
        downloadUrl: downloadUrl,
        installPath: window.__PieToolsGameInstallPath,
        fixType: fixType,
        gameName: gameName || "",
        contentScriptQuery: "",
      })
        .then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (payload && payload.success) {
              // Show download progress popup similar to Add to Library
              showFixDownloadProgress(appid, fixType);
            } else {
              const errorKey =
                payload && payload.error ? String(payload.error) : "";
              const errorMsg =
                errorKey &&
                  (errorKey.startsWith("menu.error.") ||
                    errorKey.startsWith("common."))
                  ? t(errorKey)
                  : errorKey || lt("Failed to start fix download");
              ShowPieToolsAlert("PieTools", errorMsg);
            }
          } catch (err) {
            backendLog("PieTools: ApplyGameFix response error: " + err);
            const msg = lt("Error applying fix");
            ShowPieToolsAlert("PieTools", msg);
          }
        })
        .catch(function (err) {
          backendLog("PieTools: ApplyGameFix error: " + err);
          const msg = lt("Error applying fix");
          ShowPieToolsAlert("PieTools", msg);
        });
    } catch (err) {
      backendLog("PieTools: applyFix error: " + err);
    }
  }

  // Show fix download progress popup
  function showFixDownloadProgress(appid, fixType) {
    // Reuse the download popup UI from Add to Library
    if (document.querySelector(".PieTools-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:480px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const title = document.createElement("div");
    const applyFixTitleColors = getThemeColors();
    title.style.cssText = `font-size:22px;color:${applyFixTitleColors.text};margin-bottom:16px;font-weight:600;`;
    title.textContent = lt("Applying {fix}").replace("{fix}", fixType);

    const body = document.createElement("div");
    const applyFixBodyColors = getThemeColors();
    body.style.cssText = `font-size:15px;line-height:1.6;margin-bottom:20px;color:${applyFixBodyColors.textSecondary};`;
    body.innerHTML =
      '<div id="lt-fix-progress-msg">' + lt("Downloading...") + "</div>";

    const btnRow = document.createElement("div");
    btnRow.className = "lt-fix-btn-row";
    btnRow.style.cssText =
      "margin-top:16px;display:flex;gap:12px;justify-content:center;";

    const hideBtn = document.createElement("a");
    hideBtn.href = "#";
    hideBtn.className = "PieTools-btn";
    hideBtn.style.flex = "1";
    hideBtn.innerHTML = `<span>${lt("Hide")}</span>`;
    hideBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
    };
    btnRow.appendChild(hideBtn);

    const cancelBtn = document.createElement("a");
    cancelBtn.href = "#";
    cancelBtn.className = "PieTools-btn primary";
    cancelBtn.style.flex = "1";
    cancelBtn.innerHTML = `<span>${lt("Cancel")}</span>`;
    cancelBtn.onclick = function (e) {
      e.preventDefault();
      if (cancelBtn.dataset.pending === "1") return;
      cancelBtn.dataset.pending = "1";
      const span = cancelBtn.querySelector("span");
      if (span) span.textContent = lt("Cancelling...");
      const msgEl = document.getElementById("lt-fix-progress-msg");
      if (msgEl) msgEl.textContent = lt("Cancelling...");
      Millennium.callServerMethod("PieTools", "CancelApplyFix", {
        appid: appid,
        contentScriptQuery: "",
      })
        .then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (!payload || payload.success !== true) {
              throw new Error(
                (payload && payload.error) || lt("Cancellation failed"),
              );
            }
          } catch (err) {
            cancelBtn.dataset.pending = "0";
            if (span) span.textContent = lt("Cancel");
            const msgEl2 = document.getElementById("lt-fix-progress-msg");
            if (msgEl2 && msgEl2.dataset.last)
              msgEl2.textContent = msgEl2.dataset.last;
            backendLog("PieTools: CancelApplyFix response error: " + err);
            const msg = lt("Failed to cancel fix download");
            ShowPieToolsAlert("PieTools", msg);
          }
        })
        .catch(function (err) {
          cancelBtn.dataset.pending = "0";
          const span2 = cancelBtn.querySelector("span");
          if (span2) span2.textContent = lt("Cancel");
          const msgEl2 = document.getElementById("lt-fix-progress-msg");
          if (msgEl2 && msgEl2.dataset.last)
            msgEl2.textContent = msgEl2.dataset.last;
          backendLog("PieTools: CancelApplyFix error: " + err);
          const msg = lt("Failed to cancel fix download");
          ShowPieToolsAlert("PieTools", msg);
        });
    };
    btnRow.appendChild(cancelBtn);

    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);

    // Start polling for progress
    pollFixProgress(appid, fixType);
  }

  function replaceFixButtonsWithClose(overlayEl) {
    if (!overlayEl) return;
    const btnRow = overlayEl.querySelector(".lt-fix-btn-row");
    if (!btnRow) return;
    btnRow.innerHTML = "";
    btnRow.style.cssText =
      "margin-top:16px;display:flex;justify-content:flex-end;";
    const closeBtn = document.createElement("a");
    closeBtn.href = "#";
    closeBtn.className = "PieTools-btn primary";
    closeBtn.style.minWidth = "140px";
    closeBtn.innerHTML = `<span>${lt("Close")}</span>`;
    closeBtn.onclick = function (e) {
      e.preventDefault();
      overlayEl.remove();
    };
    btnRow.appendChild(closeBtn);
  }

  // Poll fix download and extraction progress
  function pollFixProgress(appid, fixType) {
    const poll = function () {
      try {
        const overlayEl = document.querySelector(".PieTools-overlay");
        if (!overlayEl) return; // Stop if overlay was closed

        Millennium.callServerMethod("PieTools", "GetApplyFixStatus", {
          appid: appid,
          contentScriptQuery: "",
        }).then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (payload && payload.success && payload.state) {
              const state = payload.state;
              const msgEl = document.getElementById("lt-fix-progress-msg");

              if (state.status === "downloading") {
                const pct =
                  state.totalBytes > 0
                    ? Math.floor((state.bytesRead / state.totalBytes) * 100)
                    : 0;
                if (msgEl) {
                  msgEl.textContent = lt("Downloading: {percent}%").replace(
                    "{percent}",
                    pct,
                  );
                  msgEl.dataset.last = msgEl.textContent;
                }
                setTimeout(poll, 500);
              } else if (state.status === "extracting") {
                if (msgEl) {
                  msgEl.textContent = lt("Extracting to game folder...");
                  msgEl.dataset.last = msgEl.textContent;
                }
                setTimeout(poll, 500);
              } else if (state.status === "cancelled") {
                if (msgEl)
                  msgEl.textContent = lt("Cancelled: {reason}").replace(
                    "{reason}",
                    state.error || lt("Cancelled by user"),
                  );
                replaceFixButtonsWithClose(overlayEl);
                return;
              } else if (state.status === "done") {
                if (msgEl)
                  msgEl.textContent = lt("{fix} applied successfully!").replace(
                    "{fix}",
                    fixType,
                  );
                replaceFixButtonsWithClose(overlayEl);
                return; // Stop polling
              } else if (state.status === "failed") {
                if (msgEl)
                  msgEl.textContent = lt("Failed: {error}").replace(
                    "{error}",
                    state.error || lt("Unknown error"),
                  );
                replaceFixButtonsWithClose(overlayEl);
                return; // Stop polling
              } else {
                // Continue polling for unknown states
                setTimeout(poll, 500);
              }
            }
          } catch (err) {
            backendLog("PieTools: GetApplyFixStatus error: " + err);
          }
        });
      } catch (err) {
        backendLog("PieTools: pollFixProgress error: " + err);
      }
    };
    setTimeout(poll, 500);
  }

  // Show un-fix progress popup
  function showUnfixProgress(appid) {
    // Remove any existing popup
    try {
      const old = document.querySelector(".PieTools-unfix-overlay");
      if (old) old.remove();
    } catch (_) { }

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-unfix-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:480px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const title = document.createElement("div");
    const unfixTitleColors = getThemeColors();
    title.style.cssText = `font-size:22px;color:${unfixTitleColors.text};margin-bottom:16px;font-weight:600;`;
    title.textContent = lt("Un-Fixing game");

    const body = document.createElement("div");
    body.style.cssText =
      "font-size:15px;line-height:1.6;margin-bottom:20px;color:#c7d5e0;";
    body.innerHTML =
      '<div id="lt-unfix-progress-msg">' +
      lt("Removing fix files...") +
      "</div>";

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "margin-top:16px;display:flex;justify-content:center;";
    const hideBtn = document.createElement("a");
    hideBtn.href = "#";
    hideBtn.className = "PieTools-btn";
    hideBtn.style.minWidth = "140px";
    hideBtn.innerHTML = `<span>${lt("Hide")}</span>`;
    hideBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
    };
    btnRow.appendChild(hideBtn);

    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);

    // Start polling for progress
    pollUnfixProgress(appid);
  }

  // Poll un-fix progress
  function pollUnfixProgress(appid) {
    const poll = function () {
      try {
        const overlayEl = document.querySelector(".PieTools-unfix-overlay");
        if (!overlayEl) return; // Stop if overlay was closed

        Millennium.callServerMethod("PieTools", "GetUnfixStatus", {
          appid: appid,
          contentScriptQuery: "",
        }).then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (payload && payload.success && payload.state) {
              const state = payload.state;
              const msgEl = document.getElementById("lt-unfix-progress-msg");

              if (state.status === "removing") {
                if (msgEl)
                  msgEl.textContent =
                    state.progress || lt("Removing fix files...");
                // Continue polling
                setTimeout(poll, 500);
              } else if (state.status === "done") {
                const filesRemoved = state.filesRemoved || 0;
                if (msgEl)
                  msgEl.textContent = lt(
                    "Removed {count} files. Running Steam verification...",
                  ).replace("{count}", filesRemoved);
                // Change Hide button to Close button
                try {
                  const btnRow = overlayEl.querySelector(
                    'div[style*="justify-content:center"]',
                  );
                  if (btnRow) {
                    btnRow.innerHTML = "";
                    const closeBtn = document.createElement("a");
                    closeBtn.href = "#";
                    closeBtn.className = "PieTools-btn primary";
                    closeBtn.style.minWidth = "140px";
                    closeBtn.innerHTML = `<span>${lt("Close")}</span>`;
                    closeBtn.onclick = function (e) {
                      e.preventDefault();
                      overlayEl.remove();
                    };
                    btnRow.appendChild(closeBtn);
                  }
                } catch (_) { }

                // Trigger Steam verification after a short delay
                setTimeout(function () {
                  try {
                    const verifyUrl = "steam://validate/" + appid;
                    window.location.href = verifyUrl;
                    backendLog("PieTools: Running verify for appid " + appid);
                  } catch (_) { }
                }, 1000);

                return; // Stop polling
              } else if (state.status === "failed") {
                if (msgEl)
                  msgEl.textContent = lt("Failed: {error}").replace(
                    "{error}",
                    state.error || lt("Unknown error"),
                  );
                // Change Hide button to Close button
                try {
                  const btnRow = overlayEl.querySelector(
                    'div[style*="justify-content:center"]',
                  );
                  if (btnRow) {
                    btnRow.innerHTML = "";
                    const closeBtn = document.createElement("a");
                    closeBtn.href = "#";
                    closeBtn.className = "PieTools-btn primary";
                    closeBtn.style.minWidth = "140px";
                    closeBtn.innerHTML = `<span>${lt("Close")}</span>`;
                    closeBtn.onclick = function (e) {
                      e.preventDefault();
                      overlayEl.remove();
                    };
                    btnRow.appendChild(closeBtn);
                  }
                } catch (_) { }
                return; // Stop polling
              } else {
                // Continue polling for unknown states
                setTimeout(poll, 500);
              }
            }
          } catch (err) {
            backendLog("PieTools: GetUnfixStatus error: " + err);
          }
        });
      } catch (err) {
        backendLog("PieTools: pollUnfixProgress error: " + err);
      }
    };
    setTimeout(poll, 500);
  }

  function fetchSettingsConfig(forceRefresh) {
    try {
      if (
        !forceRefresh &&
        window.__PieToolsSettings &&
        Array.isArray(window.__PieToolsSettings.schema)
      ) {
        return Promise.resolve(window.__PieToolsSettings);
      }
    } catch (_) { }

    if (
      typeof Millennium === "undefined" ||
      typeof Millennium.callServerMethod !== "function"
    ) {
      return Promise.reject(new Error(lt("PieTools backend unavailable")));
    }

    return Millennium.callServerMethod("PieTools", "GetSettingsConfig", {
      contentScriptQuery: "",
    }).then(function (res) {
      const payload = typeof res === "string" ? JSON.parse(res) : res;
      if (!payload || payload.success !== true) {
        const errorMsg =
          payload && payload.error
            ? String(payload.error)
            : t("settings.error", "Failed to load settings.");
        throw new Error(errorMsg);
      }
      const config = {
        schemaVersion: payload.schemaVersion || 0,
        schema: Array.isArray(payload.schema) ? payload.schema : [],
        values:
          payload && payload.values && typeof payload.values === "object"
            ? payload.values
            : {},
        language: payload && payload.language ? String(payload.language) : "en",
        locales: Array.isArray(payload && payload.locales)
          ? payload.locales
          : [],
        translations:
          payload &&
            payload.translations &&
            typeof payload.translations === "object"
            ? payload.translations
            : {},
        lastFetched: Date.now(),
      };
      applyTranslationBundle({
        language: config.language,
        locales: config.locales,
        strings: config.translations,
      });
      window.__PieToolsSettings = config;
      return config;
    });
  }

  function initialiseSettingsDraft(config) {
    const values = JSON.parse(JSON.stringify((config && config.values) || {}));
    if (!config || !Array.isArray(config.schema)) {
      return values;
    }
    for (let i = 0; i < config.schema.length; i++) {
      const group = config.schema[i];
      if (!group || !group.key) continue;
      if (
        typeof values[group.key] !== "object" ||
        values[group.key] === null ||
        Array.isArray(values[group.key])
      ) {
        values[group.key] = {};
      }
      const options = Array.isArray(group.options) ? group.options : [];
      for (let j = 0; j < options.length; j++) {
        const option = options[j];
        if (!option || !option.key) continue;
        if (typeof values[group.key][option.key] === "undefined") {
          values[group.key][option.key] = option.default;
        }
      }
    }
    return values;
  }

  function showSettingsManagerPopup(forceRefresh, onBack) {
    try {
      document.querySelectorAll(".PieTools-settings-manager-overlay, .PieTools-settings-overlay").forEach(function (el) { el.remove(); });
    } catch (_) { }

    ensurePieToolsStyles();
    ensureFontAwesome();

    const overlay = document.createElement("div");
    overlay.className = "PieTools-settings-manager-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:100000;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const settingsModalColors = getThemeColors();
    modal.style.cssText = `position:relative;background:${settingsModalColors.modalBg};color:${settingsModalColors.text};border:1px solid ${settingsModalColors.border};border-radius:16px;width:750px;max-height:88vh;padding:0;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${settingsModalColors.shadowRgba};animation:slideUp 0.12s ease-out;overflow:hidden;`;

    const header = document.createElement("div");
    const settingsHeaderColors = getThemeColors();
    header.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:20px 24px 16px;border-bottom:1px solid ${settingsHeaderColors.border.replace("0.3", "0.15")};`;

    const title = document.createElement("div");
    const settingsTitleColors = getThemeColors();
    title.style.cssText = `font-size:22px;color:${settingsTitleColors.text};font-weight:600;`;
    title.textContent = t("settings.title", "PieTools - Settings");

    const iconButtons = document.createElement("div");
    iconButtons.style.cssText = "display:flex;gap:12px;";

    const discordIconBtn = document.createElement("a");
    discordIconBtn.href = "#";
    const discordBtnColors = getThemeColors();
    discordIconBtn.style.cssText = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:rgba(${discordBtnColors.rgbString},0.08);border:1px solid ${discordBtnColors.border};border-radius:8px;color:${discordBtnColors.accent};font-size:16px;text-decoration:none;transition:all 0.2s ease;cursor:pointer;`;
    discordIconBtn.innerHTML = '<i class="fa-brands fa-discord"></i>';
    discordIconBtn.title = t("menu.discord", "Discord");
    discordIconBtn.onclick = function (e) { e.preventDefault(); openExternalBrowserUrl("https://discord.gg/SkpMMCp6sv"); };
    discordIconBtn.onmouseover = function () {
      const c = getThemeColors();
      this.style.background = `rgba(${c.rgbString},0.18)`;
      this.style.transform = "translateY(-1px)";
      this.style.boxShadow = `0 4px 12px ${c.shadow}`;
      this.style.borderColor = c.accent;
    };
    discordIconBtn.onmouseout = function () {
      const c = getThemeColors();
      this.style.background = `rgba(${c.rgbString},0.08)`;
      this.style.transform = "translateY(0)";
      this.style.boxShadow = "none";
      this.style.borderColor = c.border;
    };
    iconButtons.appendChild(discordIconBtn);

    const manageLuaIconBtn = document.createElement("a");
    manageLuaIconBtn.href = "#";
    const manageLuaBtnColors = getThemeColors();
    manageLuaIconBtn.style.cssText = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:rgba(${manageLuaBtnColors.rgbString},0.08);border:1px solid ${manageLuaBtnColors.border};border-radius:8px;color:${manageLuaBtnColors.accent};font-size:16px;text-decoration:none;transition:all 0.2s ease;cursor:pointer;`;
    manageLuaIconBtn.innerHTML = '<i class="fa-solid fa-file-code"></i>';
    manageLuaIconBtn.title = t("settings.manageLuas", "Manage Luas");
    manageLuaIconBtn.onclick = function (e) {
      e.preventDefault();
      const section = document.getElementById("PieTools-installed-lua-section");
      if (section) section.scrollIntoView({ behavior: "smooth" });
    };
    manageLuaIconBtn.onmouseover = function () {
      const c = getThemeColors();
      this.style.background = `rgba(${c.rgbString},0.18)`;
      this.style.transform = "translateY(-1px)";
      this.style.boxShadow = `0 4px 12px ${c.shadow}`;
      this.style.borderColor = c.accent;
    };
    manageLuaIconBtn.onmouseout = function () {
      const c = getThemeColors();
      this.style.background = `rgba(${c.rgbString},0.08)`;
      this.style.transform = "translateY(0)";
      this.style.boxShadow = "none";
      this.style.borderColor = c.border;
    };
    iconButtons.appendChild(manageLuaIconBtn);

    const closeIconBtn = document.createElement("a");
    closeIconBtn.href = "#";
    const closeBtnColors = getThemeColors();
    closeIconBtn.style.cssText = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:rgba(${closeBtnColors.rgbString},0.08);border:1px solid ${closeBtnColors.border};border-radius:8px;color:${closeBtnColors.accent};font-size:16px;text-decoration:none;transition:all 0.2s ease;cursor:pointer;`;
    closeIconBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeIconBtn.title = t("settings.close", "Close");
    closeIconBtn.onmouseover = function () {
      const c = getThemeColors();
      this.style.background = `rgba(${c.rgbString},0.18)`;
      this.style.transform = "translateY(-1px)";
      this.style.boxShadow = `0 4px 12px ${c.shadow}`;
      this.style.borderColor = c.accent;
    };
    closeIconBtn.onmouseout = function () {
      const c = getThemeColors();
      this.style.background = `rgba(${c.rgbString},0.08)`;
      this.style.transform = "translateY(0)";
      this.style.boxShadow = "none";
      this.style.borderColor = c.border;
    };
    iconButtons.appendChild(closeIconBtn);

    // Search bar container
    const searchContainer = document.createElement("div");
    const searchColors = getThemeColors();
    searchContainer.style.cssText =
      "padding:16px 24px;border-bottom:1px solid rgba(255,255,255,0.06);";

    const searchWrap = document.createElement("div");
    searchWrap.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 14px;background:${searchColors.bgTertiary};border:1px solid ${searchColors.border};border-radius:10px;transition:all 0.2s ease;`;

    const searchIcon = document.createElement("i");
    searchIcon.className = "fa-solid fa-magnifying-glass";
    searchIcon.style.cssText = `color:${searchColors.textSecondary};font-size:14px;flex-shrink:0;`;

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.id = "PieTools-settings-search";
    searchInput.placeholder = t(
      "settings.search.placeholder",
      "Search settings, games, fixes...",
    );
    searchInput.style.cssText = `flex:1;background:transparent;border:none;outline:none;color:${searchColors.text};font-size:14px;`;
    searchInput.setAttribute("autocomplete", "off");

    const searchClear = document.createElement("a");
    searchClear.href = "#";
    searchClear.style.cssText = `display:none;color:${searchColors.textSecondary};font-size:14px;text-decoration:none;padding:4px;flex-shrink:0;`;
    searchClear.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    searchClear.title = t("settings.search.clear", "Clear search");

    searchWrap.onfocus = function () {
      searchWrap.style.borderColor = searchColors.accent;
    };
    searchInput.onfocus = function () {
      const c = getThemeColors();
      searchWrap.style.borderColor = c.accent;
      searchWrap.style.boxShadow = `0 0 0 2px rgba(${c.rgbString},0.2)`;
    };
    searchInput.onblur = function () {
      const c = getThemeColors();
      searchWrap.style.borderColor = c.border;
      searchWrap.style.boxShadow = "none";
    };

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchClear);
    searchContainer.appendChild(searchWrap);

    const contentWrap = document.createElement("div");
    contentWrap.id = "PieTools-content-wrap";
    const contentColors = getThemeColors();
    contentWrap.style.cssText = `flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:24px;margin:0;background:transparent;`;

    // Add mouse mode tip for Big Picture
    if (window.__PieTools_IS_BIG_PICTURE__) {
      const tip = document.createElement("div");
      const tipColors = getThemeColors();
      tip.style.cssText = `background:rgba(${tipColors.rgbString},0.08);border:1px solid ${tipColors.border};padding:12px 16px;border-radius:8px;font-size:13px;color:${tipColors.textSecondary};margin-bottom:20px;line-height:1.5;display:flex;align-items:center;gap:10px;`;
      tip.innerHTML =
        '<i class="fa-solid fa-info-circle" style="color:#31D0FC;font-size:14px;flex-shrink:0;"></i>' +
        t(
          "bigpicture.mouseTip",
          "To use mouse mode in Steam: Guide Button + Right Joystick, click with RB",
        );
      contentWrap.appendChild(tip);
    }

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "padding:16px 24px 20px;display:flex;gap:10px;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.06);";

    const backBtn = createSettingsButton(
      "back",
      "",
      false,
      '<i class="fa-solid fa-arrow-left"></i>',
    );
    const rightButtons = document.createElement("div");
    rightButtons.style.cssText = "display:flex;gap:10px;";
    const refreshBtn = createSettingsButton(
      "refresh",
      "",
      false,
      '<i class="fa-solid fa-arrow-rotate-right"></i>',
    );
    const saveBtn = createSettingsButton(
      "save",
      "",
      true,
      '<i class="fa-solid fa-floppy-disk"></i>',
    );

    modal.appendChild(header);
    modal.appendChild(searchContainer);
    modal.appendChild(contentWrap);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);

    const state = {
      config: null,
      draft: {},
      searchQuery: "",
      fixes: [],
      fixesPage: 1,
      luas: [],
      luasPage: 1,
      luasPerPage: 10
    };

    // Search functionality
    let searchDebounceTimer = null;
    searchInput.addEventListener("input", function () {
      const query = searchInput.value.trim().toLowerCase();
      searchClear.style.display = query ? "block" : "none";

      // Debounce the search
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        state.searchQuery = query;
        applySearchFilter();
      }, 150);
    });

    searchClear.addEventListener("click", function (e) {
      e.preventDefault();
      searchInput.value = "";
      searchClear.style.display = "none";
      state.searchQuery = "";
      applySearchFilter();
      searchInput.focus();
    });

    function applySearchFilter() {
      const query = state.searchQuery;

      // Filter settings options
      const optionEls = contentWrap.querySelectorAll("[data-setting-option]");
      optionEls.forEach(function (el) {
        const searchText = (el.dataset.searchText || "").toLowerCase();
        if (!query || searchText.includes(query)) {
          el.style.display = "";
        } else {
          el.style.display = "none";
        }
      });

      // Filter settings groups (hide if all options hidden)
      const groupEls = contentWrap.querySelectorAll("[data-setting-group]");
      groupEls.forEach(function (groupEl) {
        const visibleOptions = groupEl.querySelectorAll(
          '[data-setting-option]:not([style*="display: none"])',
        );
        if (!query || visibleOptions.length > 0) {
          groupEl.style.display = "";
        } else {
          groupEl.style.display = "none";
        }
      });

      // Filter installed fixes via pagination
      state.fixesPage = 1;
      if (typeof renderFixesList === "function") {
        renderFixesList();
      }

      // Filter installed lua scripts via pagination
      state.luasPage = 1;
      if (typeof renderLuaList === "function") {
        renderLuaList();
      }
    }

    let refreshDefaultLabel = "";
    let saveDefaultLabel = "";
    let closeDefaultLabel = "";
    let backDefaultLabel = "";

    function createSettingsButton(id, text, isPrimary, iconHtml) {
      const btn = document.createElement("a");
      btn.id = "lt-settings-" + id;
      btn.href = "#";
      const btnColors = getThemeColors();
      const hasText = text && text.trim().length > 0;
      if (iconHtml) {
        btn.innerHTML = hasText
          ? iconHtml + "<span>" + text + "</span>"
          : iconHtml;
      } else {
        btn.innerHTML = "<span>" + text + "</span>";
      }

      const btnSize = hasText
        ? "padding:9px 16px;"
        : "width:38px;height:38px;padding:0;";
      btn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;${btnSize}background:rgba(${btnColors.rgbString},0.1);border:1px solid ${btnColors.border};border-radius:8px;color:${btnColors.text};font-size:14px;text-decoration:none;transition:all 0.2s ease;cursor:pointer;`;

      if (isPrimary) {
        btn.style.background = `linear-gradient(135deg, rgba(${btnColors.rgbString},0.25) 0%, rgba(${btnColors.rgbString},0.15) 100%)`;
        btn.style.borderColor = btnColors.accent;
      }

      btn.onmouseover = function () {
        if (this.dataset.disabled === "1") {
          this.style.opacity = "0.6";
          this.style.cursor = "not-allowed";
          return;
        }
        const c = getThemeColors();
        if (isPrimary) {
          this.style.background = `linear-gradient(135deg, rgba(${c.rgbString},0.35) 0%, rgba(${c.rgbString},0.2) 100%)`;
        } else {
          this.style.background = `rgba(${c.rgbString},0.18)`;
        }
        this.style.transform = "translateY(-1px)";
        this.style.boxShadow = `0 4px 12px ${c.shadow}`;
      };

      btn.onmouseout = function () {
        if (this.dataset.disabled === "1") {
          this.style.opacity = "0.5";
          this.style.transform = "none";
          this.style.boxShadow = "none";
          return;
        }
        const c = getThemeColors();
        if (isPrimary) {
          this.style.background = `linear-gradient(135deg, rgba(${c.rgbString},0.25) 0%, rgba(${c.rgbString},0.15) 100%)`;
        } else {
          this.style.background = `rgba(${c.rgbString},0.1)`;
        }
        this.style.transform = "translateY(0)";
        this.style.boxShadow = "none";
      };

      if (isPrimary) {
        btn.dataset.disabled = "1";
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
      }

      return btn;
    }

    header.appendChild(title);
    header.appendChild(iconButtons);

    // Inject scrollbar styles for content area
    const scrollbarStyle = document.createElement("style");
    scrollbarStyle.textContent =
      "#PieTools-content-wrap::-webkit-scrollbar { width: 8px; } " +
      "#PieTools-content-wrap::-webkit-scrollbar-track { background: transparent; } " +
      "#PieTools-content-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; } " +
      "#PieTools-content-wrap::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }";
    modal.appendChild(scrollbarStyle);

    function applyStaticTranslations() {
      title.textContent = t("settings.title", "PieTools - Settings");
      refreshBtn.title = t("settings.refresh", "Refresh");
      saveBtn.title = t("settings.save", "Save Settings");
      backBtn.title = t("Back", "Back");
      discordIconBtn.title = t("menu.discord", "Discord");
      closeIconBtn.title = t("settings.close", "Close");
    }
    applyStaticTranslations();

    function setStatus(text, color) {
      let statusLine = contentWrap.querySelector(".PieTools-settings-status");
      if (!statusLine) {
        statusLine = document.createElement("div");
        statusLine.className = "PieTools-settings-status";
        statusLine.style.cssText =
          "font-size:13px;margin-bottom:16px;color:#c7d5e0;text-align:center;padding:6px 12px;background:rgba(255,255,255,0.03);border-radius:6px;";
        contentWrap.insertBefore(statusLine, contentWrap.firstChild);
      }
      if (!text || text.trim() === "") {
        statusLine.style.display = "none";
        return;
      }
      statusLine.style.display = "";
      statusLine.textContent = text;
      statusLine.style.color = color || "#c7d5e0";
    }

    function ensureDraftGroup(groupKey) {
      if (!state.draft[groupKey] || typeof state.draft[groupKey] !== "object") {
        state.draft[groupKey] = {};
      }
      return state.draft[groupKey];
    }

    function collectChanges() {
      if (!state.config || !Array.isArray(state.config.schema)) {
        return {};
      }
      const changes = {};
      for (let i = 0; i < state.config.schema.length; i++) {
        const group = state.config.schema[i];
        if (!group || !group.key) continue;
        const options = Array.isArray(group.options) ? group.options : [];
        const draftGroup = state.draft[group.key] || {};
        const originalGroup =
          (state.config.values && state.config.values[group.key]) || {};
        const groupChanges = {};
        for (let j = 0; j < options.length; j++) {
          const option = options[j];
          if (!option || !option.key) continue;
          const newValue = draftGroup.hasOwnProperty(option.key)
            ? draftGroup[option.key]
            : option.default;
          const oldValue = originalGroup.hasOwnProperty(option.key)
            ? originalGroup[option.key]
            : option.default;
          if (newValue !== oldValue) {
            groupChanges[option.key] = newValue;
          }
        }
        if (Object.keys(groupChanges).length > 0) {
          changes[group.key] = groupChanges;
        }
      }
      return changes;
    }

    function updateSaveState() {
      const hasChanges = Object.keys(collectChanges()).length > 0;
      const isBusy = saveBtn.dataset.busy === "1";

      let hubcapKey = "";
      let foundHubcapKey = false;
      for (const group in state.draft) {
        if (
          state.draft[group] &&
          state.draft[group].hasOwnProperty("morrenusApiKey")
        ) {
          hubcapKey = state.draft[group].morrenusApiKey;
          foundHubcapKey = true;
          break;
        }
      }

      let isValid = true;
      if (foundHubcapKey && hubcapKey) {
        isValid = /^smm_[0-9a-f]{96}$/.test(hubcapKey);
      }

      if (hasChanges && !isBusy && isValid) {
        saveBtn.dataset.disabled = "0";
        saveBtn.style.opacity = "";
        saveBtn.style.cursor = "pointer";
      } else {
        saveBtn.dataset.disabled = "1";
        saveBtn.style.opacity = "0.6";
        saveBtn.style.cursor = "not-allowed";
      }

      if (foundHubcapKey && hubcapKey && !isValid) {
        setStatus(lt("Invalid Morrenus API Key format"), "#ff5c5c");
      }
    }

    function optionLabelKey(groupKey, optionKey) {
      if (groupKey === "general") {
        if (optionKey === "language") return "settings.language.label";
        if (optionKey === "useSteamLanguage")
          return "settings.useSteamLanguage.label";
        if (optionKey === "donateKeys") return "settings.donateKeys.label";
        if (optionKey === "theme") return "settings.theme.label";
        if (optionKey === "fastDownload") return "settings.fastDownload.label";
        if (optionKey === "morrenusApiKey")
          return "settings.morrenusApiKey.label";
      }
      return null;
    }

    function optionDescriptionKey(groupKey, optionKey) {
      if (groupKey === "general") {
        if (optionKey === "language") return "settings.language.description";
        if (optionKey === "useSteamLanguage")
          return "settings.useSteamLanguage.description";
        if (optionKey === "donateKeys")
          return "settings.donateKeys.description";
        if (optionKey === "theme") return "settings.theme.description";
        if (optionKey === "fastDownload")
          return "settings.fastDownload.description";
        if (optionKey === "morrenusApiKey")
          return "settings.morrenusApiKey.description";
      }
      return null;
    }

    function optionPlaceholderKey(groupKey, optionKey) {
      if (groupKey === "general") {
        if (optionKey === "morrenusApiKey")
          return "settings.morrenusApiKey.placeholder";
      }
      return null;
    }

    function renderSettings() {
      contentWrap.innerHTML = "";
      if (
        !state.config ||
        !Array.isArray(state.config.schema) ||
        state.config.schema.length === 0
      ) {
        const emptyState = document.createElement("div");
        const emptyColors = getThemeColors();
        emptyState.style.cssText = `padding:14px;background:${emptyColors.bgTertiary};border:1px solid ${emptyColors.border};border-radius:4px;color:${emptyColors.textSecondary};`;
        emptyState.textContent = t(
          "settings.empty",
          "No settings available yet.",
        );
        contentWrap.appendChild(emptyState);
        updateSaveState();
        return;
      }

      for (let i = 0; i < state.config.schema.length; i++) {
        const group = state.config.schema[i];
        if (!group || !group.key) continue;

        const groupEl = document.createElement("div");
        const groupCardColors = getThemeColors();
        groupEl.style.cssText = `background:rgba(${groupCardColors.rgbString},0.04);border:1px solid ${groupCardColors.border};border-radius:10px;padding:18px 20px;margin-bottom:16px;`;
        groupEl.dataset.settingGroup = group.key;

        const groupTitle = document.createElement("div");
        const titleText = t("settings." + group.key, group.label || group.key);
        if (group.key === "general") {
          const generalTitleColors = getThemeColors();
          groupTitle.innerHTML = `<i class="fa-solid fa-gear" style="margin-right:10px;color:${generalTitleColors.textSecondary};font-size:20px;"></i>${titleText}`;
          groupTitle.style.cssText = `font-size:19px;color:${generalTitleColors.text};margin-bottom:14px;font-weight:600;display:flex;align-items:center;`;
        } else {
          const otherTitleColors = getThemeColors();
          groupTitle.style.cssText = `font-size:15px;font-weight:600;color:${otherTitleColors.accent};margin-bottom:6px;`;
        }
        groupEl.appendChild(groupTitle);

        if (group.description && group.key !== "general") {
          const groupDesc = document.createElement("div");
          const descColors = getThemeColors();
          groupDesc.style.cssText = `margin-bottom:14px;font-size:12px;color:${descColors.textSecondary};line-height:1.5;`;
          groupDesc.textContent = t(
            "settings." + group.key + "Description",
            group.description,
          );
          groupEl.appendChild(groupDesc);
        }

        const options = Array.isArray(group.options) ? group.options : [];
        for (let j = 0; j < options.length; j++) {
          const option = options[j];
          if (!option || !option.key) continue;

          ensureDraftGroup(group.key);
          if (!state.draft[group.key].hasOwnProperty(option.key)) {
            const sourceGroup =
              (state.config.values && state.config.values[group.key]) || {};
            const initialValue = sourceGroup.hasOwnProperty(option.key)
              ? sourceGroup[option.key]
              : option.default;
            state.draft[group.key][option.key] = initialValue;
          }

          const optionEl = document.createElement("div");
          const optionColors = getThemeColors();
          const alignItems =
            option.type === "select" || option.type === "text"
              ? "center"
              : "flex-start";
          optionEl.style.cssText =
            j === 0
              ? `padding-top:0;display:flex;justify-content:space-between;align-items:${alignItems};gap:16px;`
              : `margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:${alignItems};gap:16px;`;
          optionEl.dataset.settingOption = option.key;

          const labelWrap = document.createElement("div");
          labelWrap.className = "PieTools-toggle-label-wrap";
          labelWrap.style.flex = "1";

          const optionLabel = document.createElement("div");
          const optLabelColors = getThemeColors();
          optionLabel.style.cssText = `font-size:14px;font-weight:500;color:${optLabelColors.text};`;
          const labelKey = optionLabelKey(group.key, option.key);
          const labelText = t(
            labelKey || "settings." + group.key + "." + option.key + ".label",
            option.label || option.key,
          );
          optionLabel.textContent = labelText;

          // Dynamically fetch and update the official Steam game name for pinning options!
          if (option.key.startsWith("game_")) {
            const appidStr = option.key.substring(5);
            if (appidStr) {
              fetchSteamGameName(appidStr).then(function (name) {
                if (name) {
                  optionLabel.textContent = name;
                  // Update search text with the real name
                  optionEl.dataset.searchText = (
                    name + " " + descText + " " + option.key + " " + group.key
                  ).toLowerCase();
                }
              });
            }
          }

          // Build search text from label, description, and key
          const descText = option.description || "";
          optionEl.dataset.searchText = (
            labelText +
            " " +
            descText +
            " " +
            option.key +
            " " +
            group.key
          ).toLowerCase();
          labelWrap.appendChild(optionLabel);

          if (option.description) {
            const optionDesc = document.createElement("div");
            const optDescColors = getThemeColors();
            optionDesc.style.cssText = `margin-top:3px;font-size:12px;color:${optDescColors.textSecondary};line-height:1.45;`;
            const descKey = optionDescriptionKey(group.key, option.key);
            let descTextVal = t(
              descKey ||
              "settings." + group.key + "." + option.key + ".description",
              option.description,
            );

            // Special handling for hubcap link
            if (
              descTextVal.includes("hubcapmanifest.com") ||
              descTextVal.includes("{link}")
            ) {
              const url = "https://hubcapmanifest.com";
              const linkHtml = `<a href="${url}" id="lt-hubcap-link" style="color:${optDescColors.accent};text-decoration:underline;">hubcapmanifest.com</a>`;
              if (descTextVal.includes("{link}")) {
                descTextVal = descTextVal.replace("{link}", linkHtml);
              } else {
                descTextVal = descTextVal.replace(
                  "hubcapmanifest.com",
                  linkHtml,
                );
              }
              optionDesc.innerHTML = descTextVal;

              // Add event listener after appending to document or wait?
              // Better: use a selector later or add it now if possible.
              setTimeout(() => {
                const link = document.getElementById("lt-hubcap-link");
                if (link) {
                  link.onclick = (e) => {
                    e.preventDefault();
                    Millennium.callServerMethod("PieTools", "OpenExternalUrl", {
                      url,
                      contentScriptQuery: "",
                    });
                  };
                }
              }, 0);
            } else {
              optionDesc.textContent = descTextVal;
            }
            labelWrap.appendChild(optionDesc);
          }

          if (option.type === "toggle") {
            optionEl.classList.add("PieTools-toggle-container");
            optionEl.appendChild(labelWrap);

            const toggleWrap = document.createElement("div");
            toggleWrap.style.cssText =
              "display:flex;align-items:center;flex-shrink:0;";

            const toggleLabel = document.createElement("label");
            toggleLabel.className = "PieTools-toggle";

            const toggleInput = document.createElement("input");
            toggleInput.type = "checkbox";
            toggleInput.checked = state.draft[group.key][option.key] === true;

            const slider = document.createElement("span");
            slider.className = "PieTools-slider";

            toggleInput.addEventListener("change", function () {
              state.draft[group.key][option.key] = toggleInput.checked;
              updateSaveState();
              if (option.key === "useSteamLanguage") refreshDependencies();
              setStatus(t("settings.unsaved", "Unsaved changes"), "#c7d5e0");
            });

            toggleLabel.appendChild(toggleInput);
            toggleLabel.appendChild(slider);
            toggleWrap.appendChild(toggleLabel);
            optionEl.appendChild(toggleWrap);
          } else {
            optionEl.appendChild(labelWrap);
            const controlWrap = document.createElement("div");

            // If it's a select or any text input, align right like toggles
            const isRightAligned =
              option.type === "select" || option.type === "text";
            if (isRightAligned) {
              optionEl.classList.add("PieTools-toggle-container");
              optionEl.style.width = "100%";
              controlWrap.style.setProperty("width", "180px", "important");
              controlWrap.style.setProperty("flex-shrink", "0", "important");
            } else {
              controlWrap.style.cssText = "margin-top:8px;";
            }

            optionEl.appendChild(controlWrap);

            if (option.type === "select") {
              const selectEl = document.createElement("select");
              const selectColors = getThemeColors();
              selectEl.style.cssText = `width:100%;padding:7px 32px 7px 10px !important;background:${selectColors.bgTertiary} !important;color:${selectColors.text} !important;border:1px solid ${selectColors.border} !important;border-radius:6px !important;font-size:13px !important;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='${encodeURIComponent(selectColors.textSecondary)}' stroke-width='1.5' fill='none'/%3E%3C/svg%3E") !important;background-repeat:no-repeat !important;background-position:right 10px center !important;transition:border-color 0.2s ease,box-shadow 0.2s ease;`;
              selectEl.onfocus = function () {
                const c = getThemeColors();
                this.style.borderColor = c.accent + " !important";
                this.style.boxShadow = `0 0 0 2px rgba(${c.rgbString},0.2)`;
              };
              selectEl.onblur = function () {
                const c = getThemeColors();
                this.style.borderColor = c.border + " !important";
                this.style.boxShadow = "none";
              };

              const choices = Array.isArray(option.choices)
                ? option.choices
                : [];
              for (let c = 0; c < choices.length; c++) {
                const choice = choices[c];
                if (!choice) continue;
                const choiceOption = document.createElement("option");
                choiceOption.value = String(choice.value);
                choiceOption.textContent = choice.label || choice.value;
                selectEl.appendChild(choiceOption);
              }

              const currentValue = state.draft[group.key][option.key];
              if (typeof currentValue !== "undefined") {
                selectEl.value = String(currentValue);
              }

              selectEl.addEventListener("change", function () {
                state.draft[group.key][option.key] = selectEl.value;
                try {
                  backendLog(
                    "PieTools: " +
                    option.key +
                    " select changed to " +
                    selectEl.value,
                  );
                } catch (_) { }

                // If theme changed, apply it immediately
                if (group.key === "general" && option.key === "theme") {
                  try {
                    backendLog(
                      "PieTools: Theme change detected, new value: " +
                      selectEl.value,
                    );
                  } catch (_) { }
                  // Update the settings cache so getCurrentTheme() returns the new value
                  if (
                    window.__PieToolsSettings &&
                    window.__PieToolsSettings.values
                  ) {
                    if (!window.__PieToolsSettings.values.general) {
                      window.__PieToolsSettings.values.general = {};
                    }
                    window.__PieToolsSettings.values.general.theme =
                      selectEl.value;
                    try {
                      backendLog(
                        "PieTools: Updated cache, theme is now: " +
                        window.__PieToolsSettings.values.general.theme,
                      );
                    } catch (_) { }
                  }
                  // Reload styles immediately
                  ensurePieToolsStyles();

                  // Update all modal elements with new theme colors
                  setTimeout(function () {
                    const colors = getThemeColors();

                    // Update modal background and border
                    const modalEl =
                      overlay &&
                      overlay.querySelector(
                        '[style*="background:linear-gradient"]',
                      );
                    if (modalEl) {
                      modalEl.style.background = colors.modalBg;
                      modalEl.style.borderColor = colors.border;
                    }

                    // Update header border
                    const headerEl =
                      overlay &&
                      overlay.querySelector('[style*="border-bottom"]');
                    if (headerEl) {
                      headerEl.style.borderBottomColor = colors.border.replace(
                        "0.3",
                        "0.2",
                      );
                    }

                    // Update all title and text colors
                    const titles =
                      overlay &&
                      overlay.querySelectorAll('[style*="text-shadow"]');
                    if (titles) {
                      titles.forEach(function (title) {
                        title.style.backgroundImage = colors.gradientLight;
                      });
                    }

                    // Update content wrapper border
                    const contentWrapEl =
                      overlay &&
                      overlay.querySelector("#PieTools-content-wrap");
                    if (contentWrapEl) {
                      contentWrapEl.style.borderColor = colors.border;
                      contentWrapEl.style.background = colors.bgContainer;
                    }

                    // Re-render the settings content
                    renderSettings();
                  }, 50);

                  // Auto-save theme changes after a brief delay
                  setTimeout(function () {
                    if (
                      saveBtn &&
                      saveBtn.dataset.disabled !== "1" &&
                      saveBtn.dataset.busy !== "1"
                    ) {
                      saveBtn.click();
                    }
                  }, 150);
                }

                updateSaveState();
                setStatus(t("settings.unsaved", "Unsaved changes"), "#c7d5e0");
              });

              controlWrap.appendChild(selectEl);
            } else if (option.type === "text") {
              const textInput = document.createElement("input");
              textInput.type =
                option.key === "morrenusApiKey" ? "password" : "text";
              const textColors = getThemeColors();
              const placeholderKey = optionPlaceholderKey(
                group.key,
                option.key,
              );
              const placeholder = t(
                placeholderKey || "",
                option.metadata && option.metadata.placeholder
                  ? String(option.metadata.placeholder)
                  : "",
              );
              textInput.placeholder = placeholder;
              textInput.style.cssText = `width:180px !important;padding:7px 12px !important;background:${textColors.bgTertiary} !important;color:${textColors.text} !important;border:1px solid ${textColors.border} !important;border-radius:6px !important;font-size:13px !important;box-sizing:border-box !important;transition:border-color 0.2s ease, box-shadow 0.2s ease;`;

              const currentValue = state.draft[group.key][option.key];
              if (
                typeof currentValue !== "undefined" &&
                currentValue !== null
              ) {
                textInput.value = String(currentValue);
              }

              textInput.addEventListener("input", function () {
                state.draft[group.key][option.key] = textInput.value;
                updateSaveState();
                setStatus(t("settings.unsaved", "Unsaved changes"), "#c7d5e0");
              });

              textInput.addEventListener("focus", function () {
                textInput.style.borderColor = textColors.accent + " !important";
                textInput.style.boxShadow = `0 0 0 2px rgba(${textColors.rgbString},0.2)`;
                textInput.style.outline = "none";
              });

              textInput.addEventListener("blur", function () {
                textInput.style.borderColor = textColors.border + " !important";
                textInput.style.boxShadow = "none";
              });

              controlWrap.appendChild(textInput);

              if (option.key === "morrenusApiKey") {
                const statsDiv = document.createElement("div");
                statsDiv.style.cssText =
                  "margin-top:8px;font-size:12px;color:" +
                  textColors.textSecondary +
                  ";width:180px;word-break:break-word;";
                controlWrap.appendChild(statsDiv);

                const updateStats = function (key) {
                  if (!key || key.trim() === "") {
                    statsDiv.innerHTML = "";
                    return;
                  }
                  if (!/^smm_[0-9a-f]{96}$/.test(key)) {
                    statsDiv.innerHTML =
                      "<span style='color:#ff5c5c;'>" +
                      lt("Invalid key format") +
                      "</span>";
                    return;
                  }
                  statsDiv.innerHTML =
                    "<i class='fa-solid fa-spinner' style='animation:spin 1s linear infinite;margin-right:6px;'></i>" +
                    lt("Checking key...");
                  Millennium.callServerMethod("PieTools", "GetMorrenusStats", {
                    api_key: key,
                    contentScriptQuery: "",
                  })
                    .then((r) => (typeof r === "string" ? JSON.parse(r) : r))
                    .then((res) => {
                      if (res && res.username) {
                        let expiryText = "";
                        if (res.api_key_expires_at) {
                          const expiry = new Date(res.api_key_expires_at);
                          const now = new Date();
                          const days = Math.max(
                            0,
                            Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)),
                          );
                          expiryText = days + " " + lt("days left");
                        }
                        const usage =
                          typeof res.daily_usage !== "undefined"
                            ? res.daily_usage
                            : "?";
                        const limit =
                          typeof res.daily_limit !== "undefined"
                            ? res.daily_limit
                            : "?";

                        const usageColor =
                          typeof res.daily_usage !== "undefined" &&
                            typeof res.daily_limit !== "undefined" &&
                            res.daily_usage >= res.daily_limit
                            ? "#ff5c5c"
                            : textColors.accent;

                        statsDiv.innerHTML = `
                          <div style="padding:10px;background:rgba(255,255,255,0.04);border:1px solid ${textColors.borderRgba || "rgba(255,255,255,0.1)"};border-radius:8px;">
                            <div style="font-weight:600;margin-bottom:6px;color:${textColors.text};"><i class="fa-solid fa-user" style="margin-right:6px;opacity:0.8;"></i>${res.username}</div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:${usageColor};font-weight:500;">
                                <span><i class="fa-solid fa-chart-pie" style="margin-right:6px;"></i>${lt("Usage")}</span>
                                <span>${usage} / ${limit}</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;color:${textColors.textSecondary};">
                                <span><i class="fa-solid fa-clock" style="margin-right:6px;"></i>${lt("Expires")}</span>
                                <span>${expiryText}</span>
                            </div>
                          </div>
                        `;
                      } else {
                        statsDiv.innerHTML =
                          "<span style='color:#ff5c5c;'>" +
                          lt("Invalid or rejected key") +
                          "</span>";
                      }
                    })
                    .catch((e) => {
                      statsDiv.innerHTML =
                        "<span style='color:#ff5c5c;'>" +
                        lt("Failed to verify key") +
                        "</span>";
                    });
                };

                updateStats(textInput.value);

                textInput.addEventListener("input", function () {
                  if (textInput.apiDebounce)
                    clearTimeout(textInput.apiDebounce);
                  textInput.apiDebounce = setTimeout(() => {
                    updateStats(this.value);
                  }, 800);
                });
              }
            } else if (option.type === "button") {
              const btnEl = document.createElement("a");
              btnEl.href = "#";
              const btnColors = getThemeColors();
              btnEl.style.cssText = `display:inline-block;padding:7px 16px;background:rgba(${btnColors.rgbString},0.15);border:1px solid ${btnColors.border};border-radius:6px;color:${btnColors.text};font-size:13px;font-weight:500;text-decoration:none;transition:all 0.2s ease;`;
              btnEl.textContent = t(
                "settings." + group.key + "." + option.key + ".button",
                option.label || option.key
              );

              btnEl.onmouseover = function () {
                this.style.background = `rgba(${btnColors.rgbString},0.25)`;
                this.style.transform = "translateY(-1px)";
              };
              btnEl.onmouseout = function () {
                this.style.background = `rgba(${btnColors.rgbString},0.15)`;
                this.style.transform = "none";
              };

              btnEl.addEventListener("click", function (e) {
                e.preventDefault();
                if (option.action) {
                  const originalText = btnEl.textContent;
                  btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                  btnEl.style.pointerEvents = "none";

                  Millennium.callServerMethod("PieTools", option.action, option.payload || {
                    contentScriptQuery: "",
                  }).then(function (res) {
                    btnEl.textContent = "Success";
                    btnEl.style.background = "rgba(46, 204, 113, 0.2)";
                    btnEl.style.borderColor = "#2ecc71";
                    setTimeout(() => {
                      btnEl.textContent = originalText;
                      btnEl.style.background = `rgba(${btnColors.rgbString},0.15)`;
                      btnEl.style.borderColor = btnColors.border;
                      btnEl.style.pointerEvents = "auto";
                    }, 2000);
                  }).catch(function (err) {
                    btnEl.textContent = "Error";
                    btnEl.style.background = "rgba(231, 76, 60, 0.2)";
                    btnEl.style.borderColor = "#e74c3c";
                    setTimeout(() => {
                      btnEl.textContent = originalText;
                      btnEl.style.background = `rgba(${btnColors.rgbString},0.15)`;
                      btnEl.style.borderColor = btnColors.border;
                      btnEl.style.pointerEvents = "auto";
                    }, 2000);
                  });
                }
              });

              controlWrap.appendChild(btnEl);
            } else {
              const unsupported = document.createElement("div");
              unsupported.style.cssText = "font-size:12px;color:#ffb347;";
              unsupported.textContent = lt(
                "common.error.unsupportedOption",
              ).replace("{type}", option.type);
              controlWrap.appendChild(unsupported);
            }
          }
          groupEl.appendChild(optionEl);
        }

        contentWrap.appendChild(groupEl);
      }
      // Removed unused PieTools sections to keep settings simple and fix GetAllApis errors
      renderInstalledLuaSection();

      updateSaveState();
      refreshDependencies();
    }

    function refreshDependencies() {
      try {
        const languageEl = overlay.querySelector(
          '[data-setting-option="language"]',
        );
        if (languageEl) {
          const useSteam =
            state.draft &&
            state.draft.general &&
            state.draft.general.useSteamLanguage;
          if (useSteam !== false) {
            languageEl.style.display = "none";
          } else {
            languageEl.style.display = "flex";
          }
        }
      } catch (_) { }
    }

    function renderInstalledFixesSection() {
      const sectionEl = document.createElement("div");
      sectionEl.id = "PieTools-installed-fixes-section";
      const sectionColors = getThemeColors();
      sectionEl.style.cssText = `margin-top:28px;padding:20px;background:rgba(${sectionColors.rgbString},0.04);border:1px solid ${sectionColors.border};border-radius:10px;`;

      const sectionTitle = document.createElement("div");
      const titleColors = getThemeColors();
      sectionTitle.style.cssText = `font-size:16px;color:${titleColors.text};margin-bottom:14px;font-weight:600;`;
      sectionTitle.innerHTML =
        '<i class="fa-solid fa-wrench" style="margin-right:8px;color:#31D0FC;"></i>' +
        t("settings.installedFixes.title", "Installed Fixes");
      sectionEl.appendChild(sectionTitle);

      const listContainer = document.createElement("div");
      listContainer.id = "PieTools-fixes-list";
      listContainer.style.cssText = "min-height:50px;";
      sectionEl.appendChild(listContainer);

      contentWrap.appendChild(sectionEl);

      loadInstalledFixes(listContainer);
    }

    function renderFixesList() {
      const container = document.getElementById("PieTools-fixes-list");
      if (!container) return;

      const query = state.searchQuery || "";
      const filteredFixes = state.fixes.filter(function (fix) {
        if (!query) return true;
        const gameNameText = fix.gameName || "Unknown Game";
        const searchText = (gameNameText + " " + fix.appid + " " + (fix.fixType || "") + " fix").toLowerCase();
        return searchText.includes(query);
      });

      const itemsPerPage = 10;
      const totalPages = Math.max(1, Math.ceil(filteredFixes.length / itemsPerPage));
      if (state.fixesPage < 1) state.fixesPage = 1;
      if (state.fixesPage > totalPages) state.fixesPage = totalPages;

      container.innerHTML = "";

      if (filteredFixes.length === 0) {
        const emptyColors = getThemeColors();
        const msg = query ? t("settings.search.noResults", "No matches found") : t("settings.installedFixes.empty", "No fixes installed yet.");
        container.innerHTML = `<div class="search-empty-state" style="padding:16px;background:rgba(${emptyColors.rgbString},0.03);border:1px solid ${emptyColors.border};border-radius:8px;color:${emptyColors.textSecondary};text-align:center;font-size:13px;">${msg}</div>`;
        return;
      }

      const startIndex = (state.fixesPage - 1) * itemsPerPage;
      const pageItems = filteredFixes.slice(startIndex, startIndex + itemsPerPage);

      for (let i = 0; i < pageItems.length; i++) {
        const fix = pageItems[i];
        const fixEl = createFixListItem(fix, container);
        container.appendChild(fixEl);
      }

      if (totalPages > 1) {
        const paginationDiv = document.createElement("div");
        paginationDiv.style.cssText = "display:flex;justify-content:center;align-items:center;margin-top:14px;gap:15px;margin-bottom:10px;";

        const btnColors = getThemeColors();

        const prevBtn = document.createElement("a");
        prevBtn.href = "#";
        prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
        prevBtn.style.cssText = `padding:5px 12px;color:${btnColors.accent};text-decoration:none;border-radius:4px;background:rgba(${btnColors.rgbString},0.1);transition:all 0.15s ease;`;
        if (state.fixesPage <= 1) {
          prevBtn.style.opacity = "0.5";
          prevBtn.style.pointerEvents = "none";
        }
        prevBtn.onclick = function (e) { e.preventDefault(); state.fixesPage--; renderFixesList(); };

        const pageInfo = document.createElement("span");
        pageInfo.style.cssText = `color:${btnColors.textSecondary};font-size:13px;`;
        pageInfo.textContent = t("settings.pagination", "Page {page} of {total}").replace("{page}", state.fixesPage).replace("{total}", totalPages);

        const nextBtn = document.createElement("a");
        nextBtn.href = "#";
        nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        nextBtn.style.cssText = `padding:5px 12px;color:${btnColors.accent};text-decoration:none;border-radius:4px;background:rgba(${btnColors.rgbString},0.1);transition:all 0.15s ease;`;
        if (state.fixesPage >= totalPages) {
          nextBtn.style.opacity = "0.5";
          nextBtn.style.pointerEvents = "none";
        }
        nextBtn.onclick = function (e) { e.preventDefault(); state.fixesPage++; renderFixesList(); };

        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(pageInfo);
        paginationDiv.appendChild(nextBtn);
        container.appendChild(paginationDiv);
      }
    }

    function loadInstalledFixes(container) {
      const loadingColors = getThemeColors();
      container.innerHTML = `<div style="padding:16px;text-align:center;color:${loadingColors.textSecondary};font-size:13px;">${t("settings.installedFixes.loading", "Scanning for installed fixes...")}</div>`;

      Millennium.callServerMethod("PieTools", "GetInstalledFixes", {
        contentScriptQuery: "",
      })
        .then(function (res) {
          const response = typeof res === "string" ? JSON.parse(res) : res;
          backendLog(
            "PieTools: GetInstalledFixes response: " +
            JSON.stringify(response).substring(0, 200),
          );
          if (!response || !response.success) {
            backendLog(
              "PieTools: GetInstalledFixes failed - response: " +
              JSON.stringify(response),
            );
            const errColors = getThemeColors();
            container.innerHTML = `<div style="padding:14px;background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.3);border-radius:8px;color:#ff5c5c;text-align:center;font-size:13px;">${t("settings.installedFixes.error", "Failed to load installed fixes.")}</div>`;
            return;
          }

          state.fixes = Array.isArray(response.fixes) ? response.fixes : [];
          state.fixesPage = 1;
          renderFixesList();
        })
        .catch(function (err) {
          backendLog("PieTools: GetInstalledFixes catch error: " + err);
          const catchColors = getThemeColors();
          container.innerHTML = `<div style="padding:14px;background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.3);border-radius:8px;color:#ff5c5c;text-align:center;font-size:13px;">${t("settings.installedFixes.error", "Failed to load installed fixes.")}</div>`;
        });
    }

    function createFixListItem(fix, container) {
      const itemEl = document.createElement("div");
      const itemColors = getThemeColors();
      const accentColor = itemColors.accent || "#31D0FC";
      itemEl.style.cssText = `padding:14px 16px;background:rgba(${itemColors.rgbString},0.04);border:1px solid ${itemColors.border};border-radius:8px;display:flex;justify-content:space-between;align-items:center;transition:all 0.15s ease;`;

      itemEl.onmouseover = function () {
        const c = getThemeColors();
        this.style.borderColor = c.accent;
        this.style.background = `rgba(${c.rgbString},0.08)`;
      };
      itemEl.onmouseout = function () {
        const c = getThemeColors();
        this.style.borderColor = c.border;
        this.style.background = `rgba(${c.rgbString},0.04)`;
      };

      // Add search data attributes
      itemEl.dataset.fixItem = fix.appid;
      const gameNameText = fix.gameName || "Unknown Game";
      itemEl.dataset.searchText = (
        gameNameText +
        " " +
        fix.appid +
        " " +
        (fix.fixType || "") +
        " fix"
      ).toLowerCase();

      const infoDiv = document.createElement("div");
      infoDiv.style.cssText = "flex:1;padding-right:15px;";

      const gameName = document.createElement("div");
      const nameColors = getThemeColors();
      gameName.style.cssText = `font-size:15px;font-weight:600;color:${nameColors.text};margin-bottom:3px;`;
      gameName.textContent = gameNameText;
      infoDiv.appendChild(gameName);

      if (!fix.gameName || fix.gameName.startsWith("Unknown Game")) {
        fetchSteamGameName(fix.appid).then(function (name) {
          if (name) {
            fix.gameName = name;
            gameName.textContent = name;
            itemEl.dataset.searchText = (
              name +
              " " +
              fix.appid +
              " " +
              (fix.fixType || "") +
              " fix"
            ).toLowerCase();
          }
        });
      }

      const detailsDiv = document.createElement("div");
      const detailsColors = getThemeColors();
      detailsDiv.style.cssText = `font-size:12px;color:${detailsColors.textSecondary};display:flex;flex-wrap:wrap;gap:10px;`;

      if (fix.fixType) {
        const typeSpan = document.createElement("div");
        const typeColors = getThemeColors();
        typeSpan.innerHTML = `<i class="fa-solid fa-layer-group" style="margin-right:4px;color:${typeColors.accent};opacity:0.6;"></i>${fix.fixType}`;
        detailsDiv.appendChild(typeSpan);
      }

      if (fix.date) {
        const dateSpan = document.createElement("div");
        const dateColors = getThemeColors();
        dateSpan.innerHTML = `<i class="fa-solid fa-calendar-days" style="margin-right:5px;color:${dateColors.accent};opacity:0.7;"></i>${fix.date}`;
        detailsDiv.appendChild(dateSpan);
      }

      if (fix.filesCount > 0) {
        const filesSpan = document.createElement("div");
        const filesColors = getThemeColors();
        filesSpan.innerHTML = `<i class="fa-solid fa-file-code" style="margin-right:5px;color:${filesColors.accent};opacity:0.7;"></i>${t("settings.installedFixes.files", "{count} files").replace("{count}", fix.filesCount)}`;
        detailsDiv.appendChild(filesSpan);
      }

      infoDiv.appendChild(detailsDiv);
      itemEl.appendChild(infoDiv);

      const fixDeleteBtn = document.createElement("a");
      fixDeleteBtn.href = "#";
      fixDeleteBtn.style.cssText =
        "display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);border-radius:8px;color:#ff5050;font-size:15px;text-decoration:none;transition:all 0.15s ease;cursor:pointer;flex-shrink:0;";
      fixDeleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      fixDeleteBtn.title = t("settings.installedFixes.delete", "Remove");
      fixDeleteBtn.onmouseover = function () {
        this.style.background = "rgba(255,80,80,0.2)";
        this.style.borderColor = "rgba(255,80,80,0.5)";
        this.style.color = "#ff6b6b";
      };
      fixDeleteBtn.onmouseout = function () {
        this.style.background = "rgba(255,80,80,0.1)";
        this.style.borderColor = "rgba(255,80,80,0.3)";
        this.style.color = "#ff5050";
      };

      fixDeleteBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (fixDeleteBtn.dataset.busy === "1") return;

        showPieToolsConfirm(
          fix.gameName || "PieTools",
          t(
            "settings.installedFixes.deleteConfirm",
            "Are you sure you want to remove this fix? This will delete fix files and run Steam verification.",
          ),
          function () {
            // User confirmed
            fixDeleteBtn.dataset.busy = "1";
            fixDeleteBtn.style.opacity = "0.6";
            fixDeleteBtn.innerHTML =
              '<i class="fa-solid fa-spinner fa-spin"></i>';

            Millennium.callServerMethod("PieTools", "UnFixGame", {
              appid: fix.appid,
              installPath: fix.installPath || "",
              fixDate: fix.date || "",
              contentScriptQuery: "",
            })
              .then(function (res) {
                const response =
                  typeof res === "string" ? JSON.parse(res) : res;
                if (!response || !response.success) {
                  alert(
                    t(
                      "settings.installedFixes.deleteError",
                      "Failed to remove fix.",
                    ),
                  );
                  fixDeleteBtn.dataset.busy = "0";
                  fixDeleteBtn.style.opacity = "1";
                  fixDeleteBtn.innerHTML =
                    '<span><i class="fa-solid fa-trash"></i> ' +
                    t("settings.installedFixes.delete", "Delete") +
                    "</span>";
                  return;
                }

                // Poll for unfix status
                pollUnfixStatus(fix.appid, itemEl, fixDeleteBtn, container);
              })
              .catch(function (err) {
                alert(
                  t(
                    "settings.installedFixes.deleteError",
                    "Failed to remove fix.",
                  ) +
                  " " +
                  (err && err.message ? err.message : ""),
                );
                fixDeleteBtn.dataset.busy = "0";
                fixDeleteBtn.style.opacity = "1";
                fixDeleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
              });
          },
          function () {
            // User cancelled - do nothing
          },
        );
      });

      itemEl.appendChild(fixDeleteBtn);
      return itemEl;
    }

    function pollUnfixStatus(appid, itemEl, deleteBtn, container) {
      let pollCount = 0;
      const maxPolls = 60;

      function checkStatus() {
        if (pollCount >= maxPolls) {
          alert(
            t("settings.installedFixes.deleteError", "Failed to remove fix.") +
            " (Timeout)",
          );
          deleteBtn.dataset.busy = "0";
          deleteBtn.style.opacity = "1";
          deleteBtn.innerHTML =
            '<span><i class="fa-solid fa-trash"></i> ' +
            t("settings.installedFixes.delete", "Delete") +
            "</span>";
          return;
        }

        pollCount++;

        Millennium.callServerMethod("PieTools", "GetUnfixStatus", {
          appid: appid,
          contentScriptQuery: "",
        })
          .then(function (res) {
            const response = typeof res === "string" ? JSON.parse(res) : res;
            if (!response || !response.success) {
              setTimeout(checkStatus, 500);
              return;
            }

            const state = response.state || {};
            const status = state.status;

            if (status === "done" && state.success) {
              // Success - remove item from list with animation
              itemEl.style.transition = "all 0.3s ease";
              itemEl.style.opacity = "0";
              itemEl.style.transform = "translateX(-20px)";
              setTimeout(function () {
                itemEl.remove();
                // Check if list is now empty
                if (container.children.length === 0) {
                  const emptyFixesColors = getThemeColors();
                  container.innerHTML = `<div style="padding:14px;background:${emptyFixesColors.bgTertiary};border:1px solid ${emptyFixesColors.border};border-radius:4px;color:${emptyFixesColors.textSecondary};text-align:center;">${t("settings.installedFixes.empty", "No fixes installed yet.")}</div>`;
                }
              }, 300);

              // Trigger Steam verification after a short delay
              setTimeout(function () {
                try {
                  const verifyUrl = "steam://validate/" + appid;
                  window.location.href = verifyUrl;
                  backendLog("PieTools: Running verify for appid " + appid);
                } catch (_) { }
              }, 1000);

              return;
            } else if (
              status === "failed" ||
              (status === "done" && !state.success)
            ) {
              alert(
                t(
                  "settings.installedFixes.deleteError",
                  "Failed to remove fix.",
                ) +
                " " +
                (state.error || ""),
              );
              fixDeleteBtn.dataset.busy = "1";
              fixDeleteBtn.style.opacity = "0.6";
              fixDeleteBtn.innerHTML =
                '<span><i class="fa-solid fa-trash"></i> ' +
                t("settings.installedFixes.delete", "Delete") +
                "</span>";
              return;
            } else {
              // Still in progress
              setTimeout(checkStatus, 500);
            }
          })
          .catch(function (err) {
            setTimeout(checkStatus, 500);
          });
      }

      checkStatus();
    }

    function renderApiTogglesSection() {
      const c = getThemeColors();
      const sectionEl = document.createElement("div");
      sectionEl.id = "PieTools-api-toggles-section";
      sectionEl.style.cssText = `margin-top:28px;padding:20px;background:rgba(${c.rgbString},0.04);border:1px solid ${c.border};border-radius:10px;`;

      const sectionTitle = document.createElement("div");
      sectionTitle.style.cssText = `font-size:16px;color:${c.text};margin-bottom:6px;font-weight:600;`;
      sectionTitle.innerHTML = '<i class="fa-solid fa-plug" style="margin-right:8px;color:' + c.accent + ';"></i>' + t("settings.apiToggles.title", "Download Sources");
      sectionEl.appendChild(sectionTitle);

      const sectionDesc = document.createElement("div");
      sectionDesc.style.cssText = `font-size:12px;color:${c.textSecondary};margin-bottom:14px;`;
      sectionDesc.textContent = t("settings.apiToggles.desc", "Toggle which download sources are active. Click a name to rename. Disabled sources will be skipped.");
      sectionEl.appendChild(sectionDesc);

      const listEl = document.createElement("div");
      listEl.id = "PieTools-api-list";
      listEl.innerHTML = `<div style="padding:10px;text-align:center;color:${c.textSecondary};font-size:13px;">Loading...</div>`;
      sectionEl.appendChild(listEl);

      contentWrap.appendChild(sectionEl);

      Millennium.callServerMethod("PieTools", "GetAllApis", { contentScriptQuery: "" })
        .then(function (res) {
          const payload = typeof res === "string" ? JSON.parse(res) : res;
          if (!payload || !payload.success || !Array.isArray(payload.apis)) {
            alert("Payload error in GetAllApis: " + JSON.stringify(payload));
            listEl.innerHTML = `<div style="color:#ff5c5c;font-size:13px;padding:10px;">${t("settings.apiToggles.error", "Failed to load APIs.")}</div>`;
            return;
          }
          listEl.innerHTML = "";
          if (payload.apis.length === 0) {
            listEl.innerHTML = `<div style="color:${getThemeColors().textSecondary};font-size:13px;padding:10px;">${t("settings.apiToggles.empty", "No APIs configured.")}</div>`;
          } else {
            payload.apis.forEach(function (api) {
              // currentName tracks renames so other ops reference the right key
              let currentName = api.name;

              const row = document.createElement("div");
              const rc = getThemeColors();
              row.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(${rc.rgbString},0.04);border:1px solid ${rc.border};border-radius:8px;margin-bottom:8px;transition:all 0.2s ease;`;
              row.draggable = false;

              // Reorder tracking
              // Since currentName can change if the user renames the API, we update dataset.apiName on rename
              row.dataset.apiName = currentName;

              // Drag Events
              row.addEventListener('dragstart', function (e) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', currentName);
                row.classList.add('PieTools-dragging');
                row.style.opacity = '0.5';
              });
              row.addEventListener('dragend', function () {
                row.classList.remove('PieTools-dragging');
                row.style.opacity = '1';
                row.draggable = false;
                Array.from(listEl.children).forEach(function (c) {
                  if (c.dataset.apiName) {
                    c.style.borderTopColor = rc.border;
                    c.style.borderBottomColor = rc.border;
                  }
                });

                // Collect new order and save ONLY once drag is completed
                const newOrder = Array.from(listEl.children)
                  .filter(function (c) { return c.dataset.apiName; })
                  .map(function (c) { return c.dataset.apiName; });

                Millennium.callServerMethod("PieTools", "ReorderApis", { apiNames: JSON.stringify(newOrder), contentScriptQuery: "" })
                  .then(function (r) {
                    const rp = typeof r === "string" ? JSON.parse(r) : r;
                    if (!rp || !rp.success) {
                      alert("ReorderApis Failed: " + JSON.stringify(rp));
                    }
                  })
                  .catch(function (err) { alert("ReorderApis Error: " + err); });
              });
              row.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const dragging = listEl.querySelector('.PieTools-dragging');
                if (dragging && dragging !== row) {
                  const bounding = row.getBoundingClientRect();
                  const offset = bounding.y + (bounding.height / 2);
                  if (e.clientY - offset > 0) {
                    row.style.borderBottomColor = rc.accent;
                    row.style.borderTopColor = rc.border;
                  } else {
                    row.style.borderTopColor = rc.accent;
                    row.style.borderBottomColor = rc.border;
                  }
                }
                return false;
              });
              row.addEventListener('dragleave', function (e) {
                row.style.borderTopColor = rc.border;
                row.style.borderBottomColor = rc.border;
              });
              row.addEventListener('drop', function (e) {
                e.stopPropagation();
                row.style.borderTopColor = rc.border;
                row.style.borderBottomColor = rc.border;

                const dragging = listEl.querySelector('.PieTools-dragging');
                if (dragging && dragging !== row) {
                  const bounding = row.getBoundingClientRect();
                  const offset = bounding.y + (bounding.height / 2);
                  if (e.clientY - offset > 0) {
                    row.after(dragging);
                  } else {
                    row.before(dragging);
                  }
                }
                return false;
              });

              // â”€â”€ Drag handle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              const handle = document.createElement("div");
              handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
              handle.style.cssText = `color:${rc.textSecondary};cursor:grab;padding:0 5px;font-size:14px;opacity:0.5;transition:opacity 0.2s;`;
              handle.onmouseover = function () { this.style.opacity = "1"; };
              handle.onmouseout = function () { this.style.opacity = "0.5"; };
              handle.onmousedown = function () { row.draggable = true; };
              handle.onmouseup = function () { row.draggable = false; };
              handle.onmouseleave = function () { row.draggable = false; };
              row.appendChild(handle);

              // â”€â”€ Editable name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              const nameWrap = document.createElement("div");
              nameWrap.style.cssText = "flex:1;min-width:0;";

              const nameDisplay = document.createElement("span");
              nameDisplay.style.cssText = `font-size:14px;color:${rc.text};font-weight:500;cursor:pointer;border-bottom:1px dashed transparent;transition:border-color 0.15s;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
              nameDisplay.title = t("settings.apiToggles.clickToRename", "Click to rename");
              nameDisplay.textContent = currentName;
              nameDisplay.onmouseover = function () { this.style.borderBottomColor = getThemeColors().accent; };
              nameDisplay.onmouseout = function () { this.style.borderBottomColor = "transparent"; };

              nameDisplay.onclick = function () {
                // Switch to input
                const input = document.createElement("input");
                input.type = "text";
                input.value = currentName;
                const ic = getThemeColors();
                input.style.cssText = `font-size:14px;font-weight:500;color:${ic.text};background:rgba(${ic.rgbString},0.12);border:1px solid ${ic.accent};border-radius:4px;padding:2px 8px;outline:none;width:100%;box-sizing:border-box;`;
                nameWrap.replaceChild(input, nameDisplay);
                input.focus();
                input.select();

                function commitRename() {
                  const newVal = input.value.trim();
                  if (newVal && newVal !== currentName) {
                    Millennium.callServerMethod("PieTools", "RenameApi", { old_name: currentName, new_name: newVal, contentScriptQuery: "" })
                      .then(function (r) {
                        const rp = typeof r === "string" ? JSON.parse(r) : r;
                        if (rp && rp.success) {
                          currentName = newVal;
                          row.dataset.apiName = newVal;
                          nameDisplay.textContent = newVal;
                        }
                      }).catch(function () { });
                  }
                  nameDisplay.textContent = currentName;
                  nameWrap.replaceChild(nameDisplay, input);
                }

                input.onblur = commitRename;
                input.onkeydown = function (e) {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") { nameWrap.replaceChild(nameDisplay, input); }
                };
              };

              nameWrap.appendChild(nameDisplay);
              row.appendChild(nameWrap);

              // â”€â”€ Toggle pill â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              const pill = document.createElement("div");
              const isEnabled = api.enabled !== false;
              pill.style.cssText = `width:42px;height:22px;border-radius:11px;cursor:pointer;transition:background 0.2s ease;background:${isEnabled ? rc.accent : "rgba(255,255,255,0.15)"};position:relative;flex-shrink:0;`;
              const knob = document.createElement("div");
              knob.style.cssText = `position:absolute;top:3px;left:${isEnabled ? "22px" : "3px"};width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.2s ease;box-shadow:0 1px 3px rgba(0,0,0,0.4);`;
              pill.appendChild(knob);
              pill.dataset.enabled = isEnabled ? "1" : "0";
              pill.title = t("settings.apiToggles.toggle", "Enable / disable");

              pill.onclick = function () {
                const nowEnabled = pill.dataset.enabled !== "1";
                pill.dataset.enabled = nowEnabled ? "1" : "0";
                const tc = getThemeColors();
                pill.style.background = nowEnabled ? tc.accent : "rgba(255,255,255,0.15)";
                knob.style.left = nowEnabled ? "22px" : "3px";
                Millennium.callServerMethod("PieTools", "ToggleApi", { apiName: currentName, contentScriptQuery: "" })
                  .then(function (r) {
                    const rp = typeof r === "string" ? JSON.parse(r) : r;
                    if (!rp || !rp.success) {
                      alert("ToggleApi Failed: " + JSON.stringify(rp));
                      pill.dataset.enabled = nowEnabled ? "0" : "1";
                      pill.style.background = nowEnabled ? "rgba(255,255,255,0.15)" : getThemeColors().accent;
                      knob.style.left = nowEnabled ? "3px" : "22px";
                    }
                  }).catch(function (err) {
                    alert("ToggleApi Error: " + err);
                    pill.dataset.enabled = nowEnabled ? "0" : "1";
                    pill.style.background = nowEnabled ? "rgba(255,255,255,0.15)" : getThemeColors().accent;
                    knob.style.left = nowEnabled ? "3px" : "22px";
                  });
              };

              row.appendChild(pill);

              // â”€â”€ Delete button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              const delBtn = document.createElement("a");
              delBtn.href = "#";
              const dc = getThemeColors();
              delBtn.style.cssText = `display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.25);color:#ff5c5c;font-size:12px;text-decoration:none;flex-shrink:0;transition:all 0.15s ease;cursor:pointer;`;
              delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
              delBtn.title = t("settings.apiToggles.remove", "Remove source");
              delBtn.onmouseover = function () { this.style.background = "rgba(255,92,92,0.2)"; this.style.borderColor = "rgba(255,92,92,0.6)"; };
              delBtn.onmouseout = function () { this.style.background = "rgba(255,92,92,0.08)"; this.style.borderColor = "rgba(255,92,92,0.25)"; };

              delBtn.onclick = function (e) {
                e.preventDefault();
                if (delBtn.dataset.busy === "1") return;
                delBtn.dataset.busy = "1";
                delBtn.style.opacity = "0.5";
                Millennium.callServerMethod("PieTools", "RemoveApi", { apiName: currentName, contentScriptQuery: "" })
                  .then(function (r) {
                    const rp = typeof r === "string" ? JSON.parse(r) : r;
                    if (rp && rp.success) {
                      row.style.opacity = "0";
                      row.style.transform = "translateX(10px)";
                      setTimeout(function () { row.remove(); }, 200);
                    } else {
                      alert("RemoveApi Failed: " + JSON.stringify(rp));
                      delBtn.dataset.busy = "0";
                      delBtn.style.opacity = "1";
                    }
                  }).catch(function (err) {
                    alert("RemoveApi Error: " + err);
                    delBtn.dataset.busy = "0";
                    delBtn.style.opacity = "1";
                  });
              };

              row.appendChild(delBtn);
              listEl.appendChild(row);
            }); // end forEach
          } // end else

          // â”€â”€ Add Source button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          const addBtnRow = document.createElement("div");
          addBtnRow.style.cssText = "display:flex;justify-content:flex-end;margin-top:10px;";
          const addBtn = document.createElement("a");
          addBtn.href = "#";
          const abc = getThemeColors();
          addBtn.style.cssText = `display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:8px;background:rgba(${abc.rgbString},0.12);border:1px solid ${abc.border};color:${abc.accent};font-size:13px;font-weight:500;text-decoration:none;transition:all 0.15s ease;cursor:pointer;`;
          addBtn.innerHTML = '<i class="fa-solid fa-plus"></i><span>' + t("settings.apiToggles.addSource", "Add Source") + '</span>';
          addBtn.onmouseover = function () { const c = getThemeColors(); this.style.background = `rgba(${c.rgbString},0.22)`; this.style.borderColor = c.accent; };
          addBtn.onmouseout = function () { const c = getThemeColors(); this.style.background = `rgba(${c.rgbString},0.12)`; this.style.borderColor = c.border; };
          addBtn.onclick = function (e) {
            e.preventDefault();
            showCustomApiModal(function () {
              // Reload the API list in-place after a successful add
              listEl.innerHTML = `<div style="padding:10px;text-align:center;color:${getThemeColors().textSecondary};font-size:13px;">Loading...</div>`;
              Millennium.callServerMethod("PieTools", "GetAllApis", { contentScriptQuery: "" })
                .then(function (r2) {
                  const p2 = typeof r2 === "string" ? JSON.parse(r2) : r2;
                  if (!p2 || !p2.success || !Array.isArray(p2.apis)) { return; }
                  listEl.innerHTML = "";
                  p2.apis.forEach(function (a2) {
                    // Simple read-only rows for the reload (user can reopen settings to get full interactive rows)
                    const r = document.createElement("div");
                    const rc = getThemeColors();
                    r.style.cssText = `padding:10px 12px;background:rgba(${rc.rgbString},0.04);border:1px solid ${rc.border};border-radius:8px;margin-bottom:8px;font-size:14px;color:${rc.text};`;
                    r.textContent = a2.name;
                    listEl.insertBefore(r, addBtnRow);
                  });
                }).catch(function () { });
              ShowPieToolsAlert("Success", lt("Custom API added successfully!"));
            });
          };
          addBtnRow.appendChild(addBtn);
          sectionEl.appendChild(addBtnRow);
        })
        .catch(function (err) {
          alert("GetAllApis Catch Error: " + err);
          listEl.innerHTML = `<div style="color:#ff5c5c;font-size:13px;padding:10px;">${t("settings.apiToggles.error", "Failed to load APIs.")}</div>`;
        });
    }

    function renderLuaList() {
      const container = document.getElementById("PieTools-lua-list");
      if (!container) return;

      const query = state.searchQuery || "";
      const filteredLuas = state.luas.filter(function (s) {
        if (!query) return true;
        const gameNameText = s.gameName || "Unknown Game";
        const searchText = (gameNameText + " " + s.appid + " lua script").toLowerCase();
        return searchText.includes(query);
      });

      const itemsPerPage = state.luasPerPage || 10;
      const totalPages = Math.max(1, Math.ceil(filteredLuas.length / itemsPerPage));
      if (state.luasPage < 1) state.luasPage = 1;
      if (state.luasPage > totalPages) state.luasPage = totalPages;

      container.innerHTML = "";

      if (filteredLuas.length === 0) {
        const ec = getThemeColors();
        const msg = query ? t("settings.search.noResults", "No matches found") : t("settings.installedLua.empty", "No Lua scripts installed yet.");
        container.innerHTML = `<div class="search-empty-state" style="padding:16px;background:rgba(${ec.rgbString},0.03);border:1px solid ${ec.border};border-radius:8px;color:${ec.textSecondary};text-align:center;font-size:13px;">${msg}</div>`;
        return;
      }

      const startIndex = (state.luasPage - 1) * itemsPerPage;
      const pageItems = filteredLuas.slice(startIndex, startIndex + itemsPerPage);

      for (let i = 0; i < pageItems.length; i++) {
        container.appendChild(createLuaListItem(pageItems[i], container));
      }

      if (totalPages > 1) {
        const paginationDiv = document.createElement("div");
        paginationDiv.style.cssText = "display:flex;justify-content:center;align-items:center;margin-top:14px;gap:15px;margin-bottom:10px;";
        const bc = getThemeColors();

        const prevBtn = document.createElement("a");
        prevBtn.href = "#";
        prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
        prevBtn.style.cssText = `padding:5px 12px;color:${bc.accent};text-decoration:none;border-radius:4px;background:rgba(${bc.rgbString},0.1);transition:all 0.15s ease;`;
        if (state.luasPage <= 1) { prevBtn.style.opacity = "0.5"; prevBtn.style.pointerEvents = "none"; }
        prevBtn.onclick = function (e) { e.preventDefault(); state.luasPage--; renderLuaList(); };

        const pageInfo = document.createElement("span");
        pageInfo.style.cssText = `color:${bc.textSecondary};font-size:13px;`;
        pageInfo.textContent = t("settings.pagination", "Page {page} of {total}").replace("{page}", state.luasPage).replace("{total}", totalPages);

        const nextBtn = document.createElement("a");
        nextBtn.href = "#";
        nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        nextBtn.style.cssText = `padding:5px 12px;color:${bc.accent};text-decoration:none;border-radius:4px;background:rgba(${bc.rgbString},0.1);transition:all 0.15s ease;`;
        if (state.luasPage >= totalPages) { nextBtn.style.opacity = "0.5"; nextBtn.style.pointerEvents = "none"; }
        nextBtn.onclick = function (e) { e.preventDefault(); state.luasPage++; renderLuaList(); };

        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(pageInfo);
        paginationDiv.appendChild(nextBtn);
        container.appendChild(paginationDiv);
      }
    }

    function renderInstalledLuaSection() {
      const sectionEl = document.createElement("div");
      sectionEl.id = "PieTools-installed-lua-section";
      const sectionLuaColors = getThemeColors();
      sectionEl.style.cssText = `margin-top:28px;padding:20px;background:rgba(${sectionLuaColors.rgbString},0.04);border:1px solid ${sectionLuaColors.border};border-radius:10px;`;

      const sectionTitleContainer = document.createElement("div");
      sectionTitleContainer.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;";

      const sectionTitle = document.createElement("div");
      const luaTitleColors = getThemeColors();
      sectionTitle.style.cssText = `font-size:16px;color:${luaTitleColors.text};font-weight:600;`;
      sectionTitle.innerHTML =
        '<i class="fa-solid fa-code" style="margin-right:8px;color:#ffc107;"></i>' +
        t("settings.installedLua.title", "Installed Lua Scripts");
      sectionTitleContainer.appendChild(sectionTitle);

      const perPageSelect = document.createElement("select");
      perPageSelect.style.cssText = `background:rgba(${luaTitleColors.rgbString},0.08);color:${luaTitleColors.text};border:1px solid ${luaTitleColors.border};border-radius:6px;padding:4px 8px;font-size:12px;outline:none;cursor:pointer;width:fit-content;`;
      [5, 10, 25, 50, 100].forEach(function (val) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val + " " + t("settings.perPage", "per page");
        if (val === state.luasPerPage) opt.selected = true;
        opt.style.background = luaTitleColors.bgTertiary || "#1a1a1a";
        opt.style.color = luaTitleColors.text;
        perPageSelect.appendChild(opt);
      });
      perPageSelect.onchange = function (e) {
        state.luasPerPage = parseInt(e.target.value, 10);
        state.luasPage = 1;
        renderLuaList();
      };
      sectionTitleContainer.appendChild(perPageSelect);

      sectionEl.appendChild(sectionTitleContainer);

      const listContainer = document.createElement("div");
      listContainer.id = "PieTools-lua-list";
      listContainer.style.cssText = "min-height:50px;";
      sectionEl.appendChild(listContainer);

      contentWrap.appendChild(sectionEl);

      loadInstalledLuaScripts(listContainer);
    }

    function loadInstalledLuaScripts(container) {
      const loadingLuaColors = getThemeColors();
      container.innerHTML =
        `<div style="padding:16px;text-align:center;color:${loadingLuaColors.textSecondary};font-size:13px;">` +
        t("settings.installedLua.loading", "Scanning for installed Lua scripts...") +
        "</div>";

      Millennium.callServerMethod("PieTools", "GetInstalledLuaScripts", {
        contentScriptQuery: "",
      })
        .then(function (res) {
          const response = typeof res === "string" ? JSON.parse(res) : res;
          if (!response || !response.success) {
            container.innerHTML = `<div style="padding:14px;background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.3);border-radius:8px;color:#ff5c5c;text-align:center;font-size:13px;">${t("settings.installedLua.error", "Failed to load installed Lua scripts.")}</div>`;
            return;
          }

          state.luas = Array.isArray(response.scripts) ? response.scripts : [];
          state.luasPage = 1;
          renderLuaList();
        })
        .catch(function (err) {
          container.innerHTML = `<div style="padding:14px;background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.3);border-radius:8px;color:#ff5c5c;text-align:center;font-size:13px;">${t("settings.installedLua.error", "Failed to load installed Lua scripts.")}</div>`;
        });
    }

    function createLuaListItem(script, container) {
      const itemEl = document.createElement("div");
      const itemLuaColors = getThemeColors();
      itemEl.style.cssText = `padding:14px 16px;background:rgba(${itemLuaColors.rgbString},0.04);border:1px solid ${itemLuaColors.border};border-radius:8px;display:flex;justify-content:space-between;align-items:center;transition:all 0.15s ease;`;

      itemEl.onmouseover = function () {
        const c = getThemeColors();
        this.style.borderColor = c.accent;
        this.style.background = `rgba(${c.rgbString},0.08)`;
      };
      itemEl.onmouseout = function () {
        const c = getThemeColors();
        this.style.borderColor = c.border;
        this.style.background = `rgba(${c.rgbString},0.04)`;
      };

      // Add search data attributes
      itemEl.dataset.luaItem = script.appid;
      const gameNameText = script.gameName || "Unknown Game";
      itemEl.dataset.searchText = (
        gameNameText +
        " " +
        script.appid +
        " lua script" +
        (script.isDisabled ? " disabled" : "")
      ).toLowerCase();

      const infoDiv = document.createElement("div");
      infoDiv.style.cssText = "flex:1;padding-right:15px;";

      const gameName = document.createElement("div");
      const gameNameLuaColors = getThemeColors();
      gameName.style.cssText = `font-size:15px;font-weight:600;color:${gameNameLuaColors.text};margin-bottom:3px;display:flex;align-items:center;flex-wrap:wrap;`;
      gameName.textContent = gameNameText;

      if (!script.gameName || script.gameName.startsWith("Unknown Game")) {
        fetchSteamGameName(script.appid).then(function (name) {
          if (name) {
            script.gameName = name;
            gameName.textContent = name;
            itemEl.dataset.searchText = (
              name +
              " " +
              script.appid +
              " lua script" +
              (script.isDisabled ? " disabled" : "")
            ).toLowerCase();
          }
        });
      }

      if (script.isDisabled) {
        const disabledBadge = document.createElement("span");
        disabledBadge.style.cssText =
          "margin-left:10px;padding:3px 10px;background:rgba(255,193,7,0.15);border:1px solid rgba(255,193,7,0.4);border-radius:20px;font-size:11px;color:#ffc107;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;";
        disabledBadge.textContent = t(
          "settings.installedLua.disabled",
          "Disabled",
        );
        gameName.appendChild(disabledBadge);
      }

      infoDiv.appendChild(gameName);

      const detailsDiv = document.createElement("div");
      const detailsLuaColors = getThemeColors();
      detailsDiv.style.cssText = `font-size:12px;color:${detailsLuaColors.textSecondary};display:flex;flex-wrap:wrap;gap:10px;`;

      if (script.modifiedDate) {
        const dateSpan = document.createElement("div");
        const dateLuaColors = getThemeColors();
        dateSpan.innerHTML = `<i class="fa-solid fa-pen-to-square" style="margin-right:4px;color:${dateLuaColors.accent};opacity:0.6;"></i><strong style="font-weight:500;">${t("settings.installedLua.modified", "Modified:")}</strong> ${script.modifiedDate}`;
        detailsDiv.appendChild(dateSpan);
      }

      infoDiv.appendChild(detailsDiv);
      itemEl.appendChild(infoDiv);

      const luaDeleteBtn = document.createElement("a");
      luaDeleteBtn.href = "#";
      luaDeleteBtn.style.cssText =
        "display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);border-radius:8px;color:#ff5050;font-size:15px;text-decoration:none;transition:all 0.15s ease;cursor:pointer;flex-shrink:0;";
      luaDeleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      luaDeleteBtn.title = t("settings.installedLua.delete", "Remove");
      luaDeleteBtn.onmouseover = function () {
        this.style.background = "rgba(255,80,80,0.2)";
        this.style.borderColor = "rgba(255,80,80,0.5)";
        this.style.color = "#ff6b6b";
      };
      luaDeleteBtn.onmouseout = function () {
        this.style.background = "rgba(255,80,80,0.1)";
        this.style.borderColor = "rgba(255,80,80,0.3)";
        this.style.color = "#ff5050";
        this.style.transform = "translateY(0) scale(1)";
        this.style.boxShadow = "none";
      };

      luaDeleteBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (luaDeleteBtn.dataset.busy === "1") return;

        showPieToolsConfirm(
          script.gameName || "PieTools",
          t(
            "settings.installedLua.deleteConfirm",
            "Remove via PieTools for this game?",
          ),
          function () {
            // User confirmed
            luaDeleteBtn.dataset.busy = "1";
            luaDeleteBtn.style.opacity = "0.6";
            luaDeleteBtn.innerHTML =
              '<i class="fa-solid fa-spinner fa-spin"></i>';

            Millennium.callServerMethod("PieTools", "DeletePieToolsForApp", {
              appid: script.appid,
              contentScriptQuery: "",
            })
              .then(function (res) {
                const response =
                  typeof res === "string" ? JSON.parse(res) : res;
                if (!response || !response.success) {
                  alert(
                    t(
                      "settings.installedLua.deleteError",
                      "Failed to remove Lua script.",
                    ),
                  );
                  luaDeleteBtn.dataset.busy = "0";
                  luaDeleteBtn.style.opacity = "1";
                  luaDeleteBtn.innerHTML =
                    '<span><i class="fa-solid fa-trash"></i> ' +
                    t("settings.installedLua.delete", "Delete") +
                    "</span>";
                  return;
                }

                // Success - remove item from list with animation
                itemEl.style.transition = "all 0.3s ease";
                itemEl.style.opacity = "0";
                itemEl.style.transform = "translateX(-20px)";
                setTimeout(function () {
                  itemEl.remove();
                  // Check if list is now empty
                  if (container.children.length === 0) {
                    const emptyLuaColors = getThemeColors();
                    container.innerHTML = `<div style="padding:14px;background:${emptyLuaColors.bgTertiary};border:1px solid ${emptyLuaColors.border};border-radius:4px;color:${emptyLuaColors.textSecondary};text-align:center;">${t("settings.installedLua.empty", "No Lua scripts installed yet.")}</div>`;
                  }
                }, 300);
              })
              .catch(function (err) {
                alert(
                  t(
                    "settings.installedLua.deleteError",
                    "Failed to remove Lua script.",
                  ) +
                  " " +
                  (err && err.message ? err.message : ""),
                );
                luaDeleteBtn.dataset.busy = "0";
                luaDeleteBtn.style.opacity = "1";
                luaDeleteBtn.innerHTML =
                  '<span><i class="fa-solid fa-trash"></i> ' +
                  t("settings.installedLua.delete", "Delete") +
                  "</span>";
              });
          },
          function () {
            // User cancelled - do nothing
          },
        );
      });

      itemEl.appendChild(luaDeleteBtn);
      return itemEl;
    }

    function handleLoad(force) {
      setStatus(t("settings.loading", "Loading settings..."), "#c7d5e0");
      saveBtn.dataset.disabled = "1";
      saveBtn.style.opacity = "0.6";
      contentWrap.innerHTML =
        '<div style="padding:20px;color:#c7d5e0;">' +
        t("common.status.loading", "Loading...") +
        "</div>";

      return fetchSettingsConfig(force)
        .then(function (config) {
          state.config = {
            schemaVersion: config.schemaVersion,
            schema: Array.isArray(config.schema) ? config.schema : [],
            values: initialiseSettingsDraft(config),
            language: config.language,
            locales: config.locales,
          };
          state.draft = initialiseSettingsDraft(config);
          applyStaticTranslations();
          renderSettings();
          setStatus("", "#c7d5e0");
        })
        .catch(function (err) {
          const message =
            err && err.message
              ? err.message
              : t("settings.error", "Failed to load settings.");
          contentWrap.innerHTML =
            '<div style="padding:20px;color:#ff5c5c;">' + message + "</div>";
          setStatus(
            t("common.status.error", "Error") + ": " + message,
            "#ff5c5c",
          );
        });
    }

    backBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (typeof onBack === "function") {
        overlay.remove();
        onBack();
      }
    });

    rightButtons.appendChild(refreshBtn);
    rightButtons.appendChild(saveBtn);
    btnRow.appendChild(backBtn);
    btnRow.appendChild(rightButtons);

    refreshBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (refreshBtn.dataset.busy === "1") return;
      refreshBtn.dataset.busy = "1";
      handleLoad(true).finally(function () {
        refreshBtn.dataset.busy = "0";
        refreshBtn.style.opacity = "1";
        applyStaticTranslations();
      });
    });

    saveBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (saveBtn.dataset.disabled === "1" || saveBtn.dataset.busy === "1")
        return;

      const changes = collectChanges();
      try {
        backendLog(
          "PieTools: collectChanges payload " + JSON.stringify(changes),
        );
      } catch (_) { }
      if (!changes || Object.keys(changes).length === 0) {
        setStatus(t("settings.noChanges", "No changes to save."), "#c7d5e0");
        updateSaveState();
        return;
      }

      saveBtn.dataset.busy = "1";
      saveBtn.style.opacity = "0.6";
      setStatus(t("settings.saving", "Saving..."), "#c7d5e0");
      saveBtn.style.opacity = "0.6";

      const payloadToSend = JSON.parse(JSON.stringify(changes));
      try {
        backendLog(
          "PieTools: sending settings payload " + JSON.stringify(payloadToSend),
        );
      } catch (_) { }
      // Pass flattened keys so Millennium handles the RPC arguments as expected.
      Millennium.callServerMethod("PieTools", "ApplySettingsChanges", {
        contentScriptQuery: "",
        changesJson: JSON.stringify(payloadToSend),
      })
        .then(function (res) {
          const response = typeof res === "string" ? JSON.parse(res) : res;
          if (!response || response.success !== true) {
            if (response && response.errors) {
              const errorParts = [];
              for (const groupKey in response.errors) {
                if (
                  !Object.prototype.hasOwnProperty.call(
                    response.errors,
                    groupKey,
                  )
                )
                  continue;
                const optionErrors = response.errors[groupKey];
                for (const optionKey in optionErrors) {
                  if (
                    !Object.prototype.hasOwnProperty.call(
                      optionErrors,
                      optionKey,
                    )
                  )
                    continue;
                  const errorMsg = optionErrors[optionKey];
                  errorParts.push(groupKey + "." + optionKey + ": " + errorMsg);
                }
              }
              const errText = errorParts.length
                ? errorParts.join("\n")
                : "Validation failed.";
              setStatus(errText, "#ff5c5c");
            } else {
              const message =
                response && response.error
                  ? response.error
                  : t("settings.saveError", "Failed to save settings.");
              setStatus(message, "#ff5c5c");
            }
            return;
          }

          const newValues =
            response && response.values && typeof response.values === "object"
              ? response.values
              : state.draft;
          state.config.values = initialiseSettingsDraft({
            schema: state.config.schema,
            values: newValues,
          });
          state.draft = initialiseSettingsDraft({
            schema: state.config.schema,
            values: newValues,
          });

          try {
            if (window.__PieToolsSettings) {
              window.__PieToolsSettings.values = JSON.parse(
                JSON.stringify(state.config.values),
              );
              window.__PieToolsSettings.schemaVersion =
                state.config.schemaVersion;
              window.__PieToolsSettings.lastFetched = Date.now();
              if (
                response &&
                response.translations &&
                typeof response.translations === "object"
              ) {
                window.__PieToolsSettings.translations = response.translations;
              }
              if (response && response.language) {
                window.__PieToolsSettings.language = response.language;
              }
            }
          } catch (_) { }

          // Invalidate the settings cache to force a fresh fetch on next settings load
          // This ensures any changes persist across page navigations
          try {
            if (window.__PieToolsSettings) {
              window.__PieToolsSettings.schema = null;
            }
          } catch (_) { }

          if (
            response &&
            response.translations &&
            typeof response.translations === "object"
          ) {
            applyTranslationBundle({
              language:
                response.language ||
                (window.__PieToolsI18n && window.__PieToolsI18n.language) ||
                "en",
              locales:
                (window.__PieToolsI18n && window.__PieToolsI18n.locales) ||
                (state.config && state.config.locales) ||
                [],
              strings: response.translations,
            });
            applyStaticTranslations();
            updateButtonTranslations();
          }

          renderSettings();
          setStatus(
            t("settings.saveSuccess", "Settings saved successfully."),
            "#8bc34a",
          );

          // Reload theme if it changed
          const oldTheme = state.config.values?.general?.theme;
          const newTheme = state.draft?.general?.theme;
          if (oldTheme !== newTheme) {
            ensurePieToolsStyles();
          }
        })
        .catch(function (err) {
          const message =
            err && err.message
              ? err.message
              : t("settings.saveError", "Failed to save settings.");
          setStatus(message, "#ff5c5c");
        })
        .finally(function () {
          saveBtn.dataset.busy = "0";
          applyStaticTranslations();
          updateSaveState();
        });
    });

    closeIconBtn.addEventListener("click", function (e) {
      e.preventDefault();
      overlay.remove();
    });

    discordIconBtn.addEventListener("click", function (e) {
      e.preventDefault();
      const url = "https://discord.gg/SkpMMCp6sv";
      try {
        Millennium.callServerMethod("PieTools", "OpenExternalUrl", {
          url,
          contentScriptQuery: "",
        });
      } catch (_) { }
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    handleLoad(!!forceRefresh);
  }

  // Force-close any open settings overlays to avoid stacking
  function closeSettingsOverlay() {
    try {
      // Remove all settings overlays (robust against older NodeList forEach support)
      var list = document.getElementsByClassName("PieTools-settings-overlay");
      while (list && list.length > 0) {
        try {
          list[0].remove();
        } catch (_) {
          break;
        }
      }
      // Also remove any download/progress overlays if present
      var list2 = document.getElementsByClassName("PieTools-overlay");
      while (list2 && list2.length > 0) {
        try {
          list2[0].remove();
        } catch (_) {
          break;
        }
      }
    } catch (_) { }
  }

  // Custom modern alert dialog
  function showPieToolsAlert(title, message, onClose) {
    if (document.querySelector(".PieTools-alert-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-alert-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:100001;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const alertModalColors = getThemeColors();
    modal.style.cssText = `background:${alertModalColors.modalBg};color:${alertModalColors.text};border:1px solid ${alertModalColors.border};border-radius:16px;width:420px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${alertModalColors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const alertIconWrap = document.createElement("div");
    alertIconWrap.style.cssText = "text-align:center;margin-bottom:12px;";
    const alertIcon = document.createElement("i");
    alertIcon.className = "fa-solid fa-circle-info";
    alertIcon.style.cssText = `color:${alertModalColors.accent};font-size:32px;`;
    alertIconWrap.appendChild(alertIcon);

    const titleEl = document.createElement("div");
    titleEl.style.cssText = `font-size:20px;color:${alertModalColors.text};margin-bottom:12px;font-weight:600;text-align:center;`;
    titleEl.textContent = String(title || "PieTools");

    const messageEl = document.createElement("div");
    messageEl.style.cssText = `font-size:14px;line-height:1.6;margin-bottom:24px;color:${alertModalColors.textSecondary};text-align:center;`;
    messageEl.textContent = String(message || "");

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:center;";

    const okBtn = document.createElement("a");
    okBtn.href = "#";
    okBtn.className = "PieTools-btn primary";
    okBtn.style.cssText =
      "min-width:140px;display:flex;align-items:center;justify-content:center;text-align:center;";
    okBtn.innerHTML = `<span>${lt("Close")}</span>`;
    okBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
      try {
        onClose && onClose();
      } catch (_) { }
    };

    btnRow.appendChild(okBtn);

    modal.appendChild(alertIconWrap);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        overlay.remove();
        try {
          onClose && onClose();
        } catch (_) { }
      }
    });

    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);
  }

  // Helper to show alert with fallback
  function ShowPieToolsAlert(title, message) {
    try {
      showPieToolsAlert(title, message);
    } catch (err) {
      backendLog("PieTools: Alert error, falling back: " + err);
      try {
        alert(String(title) + "\n\n" + String(message));
      } catch (_) { }
    }
  }

  // Steam-style confirm helper (ShowConfirmDialog only)
  function showPieToolsConfirm(title, message, onConfirm, onCancel) {
    // Always close settings popup first so the confirm is visible on top
    closeSettingsOverlay();

    // Create custom modern confirmation dialog
    if (document.querySelector(".PieTools-confirm-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();
    const overlay = document.createElement("div");
    overlay.className = "PieTools-confirm-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:100001;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const confirmColors = getThemeColors();
    modal.style.cssText = `background:${confirmColors.modalBg};color:${confirmColors.text};border:1px solid ${confirmColors.border};border-radius:16px;width:420px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${confirmColors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const confirmIconWrap = document.createElement("div");
    confirmIconWrap.style.cssText = "text-align:center;margin-bottom:12px;";
    const confirmIcon = document.createElement("i");
    confirmIcon.className = "fa-solid fa-circle-question";
    confirmIcon.style.cssText = `color:${confirmColors.accent};font-size:32px;`;
    confirmIconWrap.appendChild(confirmIcon);

    const titleEl = document.createElement("div");
    titleEl.style.cssText = `font-size:20px;color:${confirmColors.text};margin-bottom:12px;font-weight:600;text-align:center;`;
    titleEl.textContent = String(title || "PieTools");

    const messageEl = document.createElement("div");
    messageEl.style.cssText = `font-size:14px;line-height:1.6;margin-bottom:24px;color:${confirmColors.textSecondary};text-align:center;`;
    messageEl.textContent = String(message || lt("Are you sure?"));

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";

    const cancelBtn = document.createElement("a");
    cancelBtn.href = "#";
    cancelBtn.className = "PieTools-btn";
    cancelBtn.style.cssText =
      "flex:1;display:flex;align-items:center;justify-content:center;text-align:center;";
    cancelBtn.innerHTML = `<span>${lt("Cancel")}</span>`;
    cancelBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
      try {
        onCancel && onCancel();
      } catch (_) { }
    };
    const confirmBtn = document.createElement("a");
    confirmBtn.href = "#";
    confirmBtn.className = "PieTools-btn primary";
    confirmBtn.style.cssText =
      "flex:1;display:flex;align-items:center;justify-content:center;text-align:center;";
    confirmBtn.innerHTML = `<span>${lt("Confirm")}</span>`;
    confirmBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
      try {
        onConfirm && onConfirm();
      } catch (_) { }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);

    modal.appendChild(confirmIconWrap);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        overlay.remove();
        try {
          onCancel && onCancel();
        } catch (_) { }
      }
    });

    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);
  }

  // DLC warning modal
  function showDlcWarning(appid, fullgameAppid, fullgameName) {
    // Close settings so modal is visible
    closeSettingsOverlay();
    if (document.querySelector(".PieTools-dlc-warning-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();

    const overlay = document.createElement("div");
    overlay.className = "PieTools-dlc-warning-overlay PieTools-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:100001;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:420px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const header = document.createElement("div");
    header.style.cssText = "text-align:center;margin-bottom:16px;";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-circle-info";
    icon.style.cssText = `color:${colors.accent};font-size:32px;`;
    header.appendChild(icon);

    const titleEl = document.createElement("div");
    titleEl.style.cssText = `font-size:20px;font-weight:600;text-align:center;margin-bottom:12px;color:${colors.text};`;
    titleEl.textContent = lt("DLC Detected");

    const messageEl = document.createElement("div");
    messageEl.style.cssText = `font-size:14px;line-height:1.6;margin-bottom:24px;color:${colors.textSecondary};text-align:center;`;
    messageEl.innerHTML = lt(
      "DLCs are added together with the base game. To add fixes for this DLC, please go to the base game page: <br><br><b>{gameName}</b>",
    ).replace("{gameName}", fullgameName || lt("Base Game"));

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";

    const cancelBtn = document.createElement("a");
    cancelBtn.href = "#";
    cancelBtn.className = "PieTools-btn";
    cancelBtn.style.cssText =
      "flex:1;display:flex;align-items:center;justify-content:center;text-align:center;";
    cancelBtn.innerHTML = `<span>${lt("Cancel")}</span>`;
    cancelBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
    };

    const goBtn = document.createElement("a");
    goBtn.href = "https://store.steampowered.com/app/" + fullgameAppid;
    goBtn.className = "PieTools-btn primary";
    goBtn.style.cssText =
      "flex:1.5;display:flex;align-items:center;justify-content:center;text-align:center;";
    goBtn.innerHTML = `<span>${lt("Go to Base Game")}</span>`;
    goBtn.onclick = function (e) {
      // Let the default link behavior happen (navigation)
      // But we can also remove the overlay
      setTimeout(() => overlay.remove(), 100);
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(goBtn);

    modal.appendChild(header);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    setTimeout(function () {
      if (window.GamepadNav) window.GamepadNav.scanElements();
    }, 150);
  }

  function showPieToolsPlayableWarning(message, onProceed, onCancel) {
    // Close settings so modal is visible
    closeSettingsOverlay();
    if (document.querySelector(".PieTools-playable-warning-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();

    const overlay = document.createElement("div");
    overlay.className = "PieTools-playable-warning-overlay PieTools-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:100001;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const playableColors = getThemeColors();
    modal.style.cssText = `background:${playableColors.modalBg};color:${playableColors.text};border:1px solid ${playableColors.border};border-radius:16px;width:420px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${playableColors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;gap:12px;margin-bottom:14px;justify-content:center;";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-triangle-exclamation";
    icon.style.cssText = `color:${playableColors.accent};font-size:22px;`;
    const titleEl = document.createElement("div");
    titleEl.style.cssText = `font-size:18px;font-weight:600;text-align:center;color:${playableColors.text};`;
    titleEl.textContent = t("common.warning", "Warning");
    header.appendChild(icon);
    header.appendChild(titleEl);

    const messageEl = document.createElement("div");
    messageEl.style.cssText = `font-size:14px;line-height:1.5;margin-bottom:20px;color:${playableColors.textSecondary};text-align:center;padding:0 6px;`;
    messageEl.textContent = String(
      message ||
      "This game may not work, support for it wont be given in our discord",
    );

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:12px;justify-content:center;";

    const cancelBtn = document.createElement("a");
    cancelBtn.href = "#";
    cancelBtn.className = "PieTools-btn";
    cancelBtn.style.cssText =
      "flex:1;display:flex;align-items:center;justify-content:center;text-align:center;";
    cancelBtn.innerHTML = `<span>${lt("Cancel")}</span>`;
    cancelBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
      try {
        onCancel && onCancel();
      } catch (_) { }
    };

    const proceedBtn = document.createElement("a");
    proceedBtn.href = "#";
    proceedBtn.className = "PieTools-btn primary";
    proceedBtn.style.cssText =
      "flex:1;display:flex;align-items:center;justify-content:center;text-align:center;";
    proceedBtn.innerHTML = `<span>${lt("Proceed")}</span>`;
    proceedBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
      try {
        onProceed && onProceed();
      } catch (_) { }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(proceedBtn);

    modal.appendChild(header);
    modal.appendChild(messageEl);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        overlay.remove();
        try {
          onCancel && onCancel();
        } catch (_) { }
      }
    });

    document.body.appendChild(overlay);

    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);
  }

  // Millennium disclaimer modal
  function showMillenniumDisclaimerModal() {
    if (document.querySelector(".PieTools-disclaimer-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();

    const overlay = document.createElement("div");
    overlay.className = "PieTools-disclaimer-overlay PieTools-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(9, 10, 15, 0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);z-index:100005;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.3s ease-out;";

    const modal = document.createElement("div");
    modal.style.cssText = `background:linear-gradient(145deg, rgba(30, 32, 40, 0.95), rgba(20, 22, 28, 0.98));border:1px solid rgba(255, 255, 255, 0.08);border-radius:24px;width:480px;padding:40px;box-shadow:0 30px 60px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,0.1);animation:slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1);position:relative;overflow:hidden;`;

    // Decorative glow background
    const glow = document.createElement("div");
    glow.style.cssText = "position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 50% 0%, rgba(255, 87, 87, 0.12) 0%, transparent 60%);pointer-events:none;z-index:0;";
    modal.appendChild(glow);

    const contentContainer = document.createElement("div");
    contentContainer.style.cssText = "position:relative;z-index:1;";

    const iconContainer = document.createElement("div");
    iconContainer.style.cssText = "display:flex;justify-content:center;margin-bottom:24px;";
    const iconWrapper = document.createElement("div");
    iconWrapper.style.cssText = "width:64px;height:64px;border-radius:50%;background:rgba(255, 87, 87, 0.1);display:flex;align-items:center;justify-content:center;border:1px solid rgba(255, 87, 87, 0.2);box-shadow:0 0 20px rgba(255, 87, 87, 0.2);";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-triangle-exclamation";
    icon.style.cssText = `color:#FF5757;font-size:28px;`;
    iconWrapper.appendChild(icon);
    iconContainer.appendChild(iconWrapper);

    const titleEl = document.createElement("h2");
    titleEl.style.cssText = `font-size:24px;font-family:'Inter', sans-serif;font-weight:700;text-align:center;margin:0 0 16px 0;color:#ffffff;letter-spacing:-0.5px;`;
    titleEl.textContent = t("disclaimer.title", "Important Notice");

    const messageEl = document.createElement("div");
    messageEl.style.cssText = `background:rgba(0, 0, 0, 0.3);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.05);margin-bottom:28px;`;

    const line1 = document.createElement("div");
    line1.style.cssText = `display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;`;
    line1.innerHTML = `<i class="fa-solid fa-xmark" style="color:#FF5757;margin-top:3px;font-size:14px;"></i><span style="color:#e2e8f0;font-size:14px;line-height:1.5;font-family:'Inter',sans-serif;"><b>PieTools</b> is an independent project and is <b>NOT affiliated</b> with Millennium.</span>`;

    const line2 = document.createElement("div");
    line2.style.cssText = `display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;`;
    line2.innerHTML = `<i class="fa-solid fa-ban" style="color:#FF5757;margin-top:3px;font-size:14px;"></i><span style="color:#e2e8f0;font-size:14px;line-height:1.5;font-family:'Inter',sans-serif;">Millennium provides <b>zero support</b> for this plugin on their servers.</span>`;

    const line3 = document.createElement("div");
    line3.style.cssText = `display:flex;align-items:flex-start;gap:12px;`;
    line3.innerHTML = `<i class="fa-brands fa-discord" style="color:#5865F2;margin-top:3px;font-size:14px;"></i><span style="color:#94a3b8;font-size:14px;line-height:1.5;font-family:'Inter',sans-serif;">Direct all inquiries to our Discord. <span style="color:#FF5757;font-weight:600;">Asking in Millennium servers may result in a ban.</span></span>`;

    messageEl.appendChild(line1);
    messageEl.appendChild(line2);
    messageEl.appendChild(line3);

    const inputGroup = document.createElement("div");
    inputGroup.style.cssText = "margin-bottom:28px;position:relative;";

    const inputLabel = document.createElement("div");
    inputLabel.style.cssText = `font-size:12px;color:#94a3b8;margin-bottom:10px;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;font-family:'Inter',sans-serif;`;
    inputLabel.textContent = t(
      "disclaimer.inputLabel",
      'Type "I Understand" to proceed'
    );

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("disclaimer.inputPlaceholder", "I Understand");
    input.style.cssText = `width:100%;box-sizing:border-box;background:rgba(0, 0, 0, 0.4);border:1px solid rgba(255, 255, 255, 0.1);border-radius:12px;padding:14px 16px;color:#ffffff;font-size:15px;font-family:'Inter',sans-serif;outline:none;transition:all 0.25s cubic-bezier(0.4, 0, 0.2, 1);`;
    input.onfocus = function () {
      this.style.borderColor = "#FF5757";
      this.style.boxShadow = `0 0 0 3px rgba(255, 87, 87, 0.15), inset 0 0 0 1px rgba(255, 87, 87, 0.1)`;
      this.style.background = "rgba(0, 0, 0, 0.6)";
    };
    input.onblur = function () {
      this.style.borderColor = "rgba(255, 255, 255, 0.1)";
      this.style.boxShadow = "none";
      this.style.background = "rgba(0, 0, 0, 0.4)";
    };

    inputGroup.appendChild(inputLabel);
    inputGroup.appendChild(input);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:12px;";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "PieTools-btn primary";
    confirmBtn.style.cssText = "background:#FF5757;color:#ffffff;border:none;border-radius:10px;padding:12px 24px;font-size:15px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;transition:all 0.2s ease;opacity:0.5;pointer-events:none;display:flex;align-items:center;gap:8px;";
    confirmBtn.innerHTML = `<span>${lt("Confirm")}</span><i class="fa-solid fa-arrow-right"></i>`;

    var expectedPhrase = t("disclaimer.inputPlaceholder", "I Understand")
      .trim()
      .toLowerCase();
    input.oninput = function () {
      if (this.value.trim().toLowerCase() === expectedPhrase) {
        confirmBtn.style.opacity = "1";
        confirmBtn.style.pointerEvents = "auto";
        confirmBtn.style.boxShadow = `0 4px 15px rgba(255, 87, 87, 0.3)`;
        confirmBtn.style.transform = "translateY(-1px)";
      } else {
        confirmBtn.style.opacity = "0.5";
        confirmBtn.style.pointerEvents = "none";
        confirmBtn.style.boxShadow = "none";
        confirmBtn.style.transform = "none";
      }
    };

    confirmBtn.onmouseenter = function () {
      if (this.style.pointerEvents === "auto") {
        this.style.background = "#ff6b6b";
      }
    };
    confirmBtn.onmouseleave = function () {
      if (this.style.pointerEvents === "auto") {
        this.style.background = "#FF5757";
      }
    };

    confirmBtn.onclick = function (e) {
      e.preventDefault();
      if (input.value.trim().toLowerCase() === expectedPhrase) {
        localStorage.setItem("PieTools millennium disclaimer accepted", "1");
        overlay.style.animation = "fadeOut 0.2s ease-in forwards";
        modal.style.animation = "slideDownFade 0.2s ease-in forwards";
        setTimeout(() => overlay.remove(), 200);
      }
    };

    // Add keyframe styles for smooth animations
    const styleSheet = document.createElement("style");
    styleSheet.textContent = `
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
      @keyframes slideUpFade { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes slideDownFade { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(20px); } }
    `;
    document.head.appendChild(styleSheet);

    btnRow.appendChild(confirmBtn);

    contentContainer.appendChild(iconContainer);
    contentContainer.appendChild(titleEl);
    contentContainer.appendChild(messageEl);
    contentContainer.appendChild(inputGroup);
    contentContainer.appendChild(btnRow);

    modal.appendChild(contentContainer);
    overlay.appendChild(modal);

    document.body.appendChild(overlay);

    // Focus input after a short delay
    setTimeout(() => input.focus(), 300);

    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);
  }

  // Ensure consistent spacing for our buttons
  function ensureStyles() {
    if (!document.getElementById("PieTools-spacing-styles")) {
      const style = document.createElement("style");
      style.id = "PieTools-spacing-styles";
      style.textContent = `
                .PieTools-restart-button { margin-left: 6px !important; margin-right: 6px !important; }
                .PieTools-patch-button { margin-left: 6px !important; margin-right: 6px !important; }
                .PieTools-button { margin-right: 0 !important; position: relative !important; }
                .PieTools-pills-container {
                    position: absolute !important;
                    top: -25px !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                    display: inline-flex;
                    gap: 4px;
                    align-items: center;
                    pointer-events: none;
                    z-index: 10;
                    white-space: nowrap;
                }
                .PieTools-pill {
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 9px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    display: inline-flex;
                    align-items: center;
                    height: 16px;
                    line-height: 1;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    cursor: default;
                }
                .PieTools-pill.red { background: rgba(255, 80, 80, 0.15); color: #ff5050; border: 1px solid rgba(255, 80, 80, 0.3); }
                .PieTools-pill.green { background: rgba(92, 184, 92, 0.15); color: #5cb85c; border: 1px solid rgba(92, 184, 92, 0.3); }
                .PieTools-pill.yellow { background: rgba(255, 193, 7, 0.15); color: #ffc107; border: 1px solid rgba(255, 193, 7, 0.3); }
                .PieTools-pill.orange { background: rgba(255, 136, 0, 0.15); color: #ff8800; border: 1px solid rgba(255, 136, 0, 0.3); }
                .PieTools-pill.blue { background: rgba(0, 112, 255, 0.15); color: #0070ff; border: 1px solid rgba(0, 112, 255, 0.3); }
                .PieTools-pill.gray { background: rgba(150, 150, 150, 0.15); color: #a0a0a0; border: 1px solid rgba(150, 150, 150, 0.3); }
            `;
      document.head.appendChild(style); // This is now separate from the main style block
    }
  }

  // Function to update button text with current translations
  function updateButtonTranslations() {
    try {
      // Update Restart Steam button
      const restartBtn = document.querySelector(".PieTools-restart-button");
      if (restartBtn) {
        const restartText = lt("Restart Steam");
        restartBtn.title = restartText;
        restartBtn.setAttribute("data-tooltip-text", restartText);
        const rspan = restartBtn.querySelector("span");
        if (rspan) {
          rspan.textContent = restartText;
        }
      }

      // Update Add to Library button
      const PieToolsBtn = document.querySelector(".PieTools-button");
      if (PieToolsBtn) {
        const addViaText = lt("Add to Library");
        PieToolsBtn.title = addViaText;
        PieToolsBtn.setAttribute("data-tooltip-text", addViaText);
        const span = PieToolsBtn.querySelector("span");
        if (span) {
          span.textContent = addViaText;
        }
      }
    } catch (err) {
      backendLog("PieTools: updateButtonTranslations error: " + err);
    }
  }

  // ── Advanced Semantic Target Discovery & Scoped MutationObserver Lifecycle ──

  function findCommunityHubReference(appid) {
    if (!appid) return null;
    const anchors = Array.from(
      document.querySelectorAll('a[href*="steamcommunity.com/app/"]'),
    );
    return (
      anchors.find(function (anchor) {
        try {
          const url = new URL(anchor.href, window.location.href);
          return (
            url.hostname.toLowerCase() === "steamcommunity.com" &&
            new RegExp("^/app/" + String(appid) + "(?:/|$)").test(url.pathname)
          );
        } catch (_) {
          return false;
        }
      }) || null
    );
  }

  function findPieToolsStoreTarget() {
    const match = window.location.href.match(/\/app\/(\d+)/);
    const appid = match ? parseInt(match[1], 10) : null;

    if (window.__PieTools_IS_BIG_PICTURE__) {
      const queueBtn = document.querySelector("#queueBtnFollow");
      if (queueBtn && queueBtn.parentElement) {
        return {
          container: queueBtn.parentElement,
          referenceBtn: queueBtn,
          kind: "big-picture-queue",
        };
      }
    }

    const knownContainer =
      document.querySelector(".steamdb-buttons") ||
      document.querySelector("[data-steamdb-buttons]") ||
      document.querySelector(".apphub_OtherSiteInfo");
    if (knownContainer) {
      return {
        container: knownContainer,
        referenceBtn: knownContainer.querySelector("a:not(.PieTools-button)"),
        kind: "known-store-actions",
      };
    }

    if (appid) {
      const communityHubButton = findCommunityHubReference(appid);
      if (communityHubButton && communityHubButton.parentElement) {
        return {
          container: communityHubButton.parentElement,
          referenceBtn: communityHubButton,
          kind: "community-hub-link",
        };
      }
    }

    const wishlistParent = (function () {
      const w = document.querySelector("[class*='wishlist'], [data-tooltip-text*='ishlist']");
      return w ? w.parentElement : null;
    })();
    const fallbackContainer =
      document.querySelector(".queue_actions_ctn") ||
      document.querySelector(".game_purchase_action") ||
      wishlistParent;
    if (fallbackContainer) {
      return {
        container: fallbackContainer,
        referenceBtn: fallbackContainer.querySelector("a") || fallbackContainer.firstElementChild,
        kind: "fallback-container",
      };
    }

    return null;
  }

  // ── Left Store Action Buttons (Remove Lua & Go to Library) ──
  function findLeftStoreHeaderHost() {
    const headerStandard = document.querySelector(".apphub_HeaderStandard");
    if (headerStandard && headerStandard.parentElement) {
      return { host: headerStandard.parentElement, referenceEl: headerStandard.nextSibling };
    }
    const title = document.querySelector(".apphub_AppName");
    if (title && title.parentElement && title.parentElement.parentElement) {
      return { host: title.parentElement.parentElement, referenceEl: title.parentElement.nextSibling };
    }
    const pageTitleArea = document.querySelector(".page_title_area");
    if (pageTitleArea && pageTitleArea.parentElement) {
      return { host: pageTitleArea.parentElement, referenceEl: pageTitleArea.nextSibling };
    }
    const highlight = document.querySelector("#game_highlights");
    if (highlight && highlight.parentElement) {
      return { host: highlight.parentElement, referenceEl: highlight };
    }
    const pageContent = document.querySelector(".page_content");
    if (pageContent) {
      return { host: pageContent, referenceEl: pageContent.firstElementChild };
    }
    return null;
  }

  function syncLeftStoreActionButtons(appid) {
    if (!appid || isNaN(appid)) {
      const existingLeftBar = document.getElementById("pietools-lua-left-bar");
      if (existingLeftBar) existingLeftBar.remove();
      return;
    }

    if (!window.Millennium || typeof window.Millennium.callServerMethod !== "function") return;

    window.Millennium.callServerMethod("PieTools", "HasPieToolsForApp", { appid: appid })
      .then(function (rawRes) {
        let res = rawRes;
        if (typeof rawRes === "string") {
          try { res = JSON.parse(rawRes); } catch (_) { }
        }

        const hasLua = res && res.success === true && res.exists === true;
        const leftHostObj = findLeftStoreHeaderHost();
        let bar = document.getElementById("pietools-lua-left-bar");

        if (!hasLua) {
          if (bar) bar.remove();
          return;
        }

        if (!leftHostObj || !leftHostObj.host) return;

        if (!bar) {
          bar = document.createElement("div");
          bar.id = "pietools-lua-left-bar";
          bar.style.cssText = "display: flex; align-items: center; gap: 6px; margin: 8px 0 12px 0; position: relative; z-index: 1000; clear: both;";

          const removeBtn = document.createElement("a");
          removeBtn.href = "#";
          removeBtn.id = "pietools-left-remove-lua-btn";
          removeBtn.className = "btnv6_blue_hoverfade btn_small_thin pietools-left-remove-lua-btn";

          const removeSpan = document.createElement("span");
          removeSpan.textContent = lt("Remove Lua");
          removeBtn.appendChild(removeSpan);

          removeBtn.style.cssText = "background: linear-gradient(135deg, #74b843, #549429) !important; color: #ffffff !important; font-family: 'Motiva Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important; font-size: 11px !important; line-height: 18px !important; padding: 2px 8px !important; font-weight: 700 !important; letter-spacing: 0.2px !important; min-width: 92px !important; display: inline-flex !important; justify-content: center !important; align-items: center !important; text-align: center !important; box-shadow: 0 0 8px rgba(116, 184, 67, 0.4), 0 2px 6px rgba(0, 0, 0, 0.25) !important; border: 1px solid rgba(255, 255, 255, 0.25) !important; border-radius: 2px !important; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important; text-shadow: none !important;";
          removeBtn.onmouseover = function () {
            this.style.setProperty("box-shadow", "0 0 14px rgba(116, 184, 67, 0.7), 0 4px 12px rgba(0, 0, 0, 0.3)", "important");
            this.style.setProperty("transform", "scale(1.05)", "important");
          };
          removeBtn.onmouseout = function () {
            this.style.setProperty("box-shadow", "0 0 8px rgba(116, 184, 67, 0.4), 0 2px 6px rgba(0, 0, 0, 0.25)", "important");
            this.style.setProperty("transform", "scale(1)", "important");
          };

          removeBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            removeSpan.textContent = lt("Removing...");

            window.Millennium.callServerMethod("PieTools", "DeletePieToolsForApp", { appid: appid })
              .then(function (rawDelRes) {
                let delRes = rawDelRes;
                if (typeof rawDelRes === "string") {
                  try { delRes = JSON.parse(rawDelRes); } catch (_) { }
                }

                if (delRes && delRes.success) {
                  removeSpan.textContent = lt("Removed!");
                  removeBtn.style.background = "linear-gradient(135deg, #10b981, #059669) !important";
                  setTimeout(function () {
                    if (bar && bar.parentElement) bar.remove();
                    window.__PieToolsButtonInserted = false;
                    if (typeof addPieToolsButton === "function") addPieToolsButton();
                  }, 1200);
                } else {
                  removeSpan.textContent = lt("Remove Failed");
                  setTimeout(function () {
                    removeSpan.textContent = lt("Remove Lua");
                  }, 1800);
                }
              })
              .catch(function () {
                removeSpan.textContent = lt("Remove Lua");
              });
          });

          const libBtn = document.createElement("a");
          libBtn.href = "#";
          libBtn.id = "pietools-left-go-library-btn";
          libBtn.className = "btnv6_blue_hoverfade btn_small_thin pietools-left-go-library-btn";

          const libSpan = document.createElement("span");
          libSpan.textContent = lt("Go to Library");
          libBtn.appendChild(libSpan);

          libBtn.style.cssText = "background: linear-gradient(135deg, #9d70e6, #7943cc) !important; color: #ffffff !important; font-family: 'Motiva Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important; font-size: 11px !important; line-height: 18px !important; padding: 2px 8px !important; font-weight: 600 !important; letter-spacing: 0.2px !important; min-width: 92px !important; display: inline-flex !important; justify-content: center !important; align-items: center !important; text-align: center !important; box-shadow: 0 0 8px rgba(157, 112, 230, 0.4), 0 2px 6px rgba(0, 0, 0, 0.25) !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; border-radius: 2px !important; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important; text-shadow: none !important;";
          libBtn.onmouseover = function () {
            this.style.setProperty("box-shadow", "0 0 14px rgba(157, 112, 230, 0.7), 0 4px 12px rgba(0, 0, 0, 0.3)", "important");
            this.style.setProperty("transform", "scale(1.05)", "important");
          };
          libBtn.onmouseout = function () {
            this.style.setProperty("box-shadow", "0 0 8px rgba(157, 112, 230, 0.4), 0 2px 6px rgba(0, 0, 0, 0.25)", "important");
            this.style.setProperty("transform", "scale(1)", "important");
          };

          libBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = "steam://nav/games/details/" + appid;
          });

          bar.appendChild(removeBtn);
          bar.appendChild(libBtn);
        }

        if (leftHostObj.referenceEl && leftHostObj.referenceEl.parentElement === leftHostObj.host) {
          leftHostObj.host.insertBefore(bar, leftHostObj.referenceEl);
        } else {
          leftHostObj.host.appendChild(bar);
        }
      })
      .catch(function (_) { });
  }

  const steamPieInjectionLifecycle = {
    observer: null,
    observedRoot: null,
    storeContainer: null,
    headerContainer: null,
    observerCallbackCount: 0,
    reconcileTimer: null,
    currentUrl: window.location.href,
    pageGeneration: 0,
  };

  function getPieToolsObservationRoot() {
    return (
      document.querySelector(".responsive_page_frame") ||
      document.querySelector(".responsive_page_content") ||
      document.body ||
      document.documentElement ||
      null
    );
  }

  function schedulePieToolsReconcile(reason) {
    if (steamPieInjectionLifecycle.reconcileTimer) {
      clearTimeout(steamPieInjectionLifecycle.reconcileTimer);
    }
    steamPieInjectionLifecycle.reconcileTimer = setTimeout(function () {
      steamPieInjectionLifecycle.reconcileTimer = null;
      if (typeof addPieToolsButton === "function") {
        addPieToolsButton();
      }
    }, 50);
  }

  function observePieToolsInjectionRoot(reason, forceReconnect) {
    if (typeof MutationObserver === "undefined") return false;
    const lifecycle = steamPieInjectionLifecycle;
    const nextRoot = getPieToolsObservationRoot();
    if (!nextRoot) return false;

    if (!forceReconnect && lifecycle.observer && lifecycle.observedRoot === nextRoot) {
      return true;
    }

    if (!lifecycle.observer) {
      lifecycle.observer = new MutationObserver(function (mutations) {
        lifecycle.observerCallbackCount += 1;

        if (window.location.href !== lifecycle.currentUrl) {
          lifecycle.currentUrl = window.location.href;
          lifecycle.pageGeneration += 1;
          window.__PieToolsButtonInserted = false;
          window.__PieToolsRestartInserted = false;
          window.__PieToolsHeaderInserted = false;
          window.__PieToolsPresenceCheckInFlight = false;
          schedulePieToolsReconcile("observer-navigation");
          return;
        }

        let needsReconcile = false;
        if (
          (lifecycle.storeContainer && !lifecycle.storeContainer.isConnected) ||
          (lifecycle.headerContainer && !lifecycle.headerContainer.isConnected) ||
          (lifecycle.observedRoot && !lifecycle.observedRoot.isConnected)
        ) {
          needsReconcile = true;
        } else {
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (m.type === "childList" && m.addedNodes.length > 0) {
              needsReconcile = true;
              break;
            }
          }
        }

        if (needsReconcile) {
          schedulePieToolsReconcile("target-dom-change");
        }
      });
    } else if (lifecycle.observedRoot) {
      lifecycle.observer.disconnect();
    }

    try {
      lifecycle.observer.observe(nextRoot, { childList: true, subtree: true });
      lifecycle.observedRoot = nextRoot;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Function to add the PieTools button
  // Add throttle to prevent excessive executions
  let lastButtonCheckTime = 0;
  const BUTTON_CHECK_THROTTLE = 500; // Only run once every 500ms

  function addPieToolsButton() {

    // Throttle to prevent blocking gamepad input
    const now = Date.now();
    if (now - lastButtonCheckTime < BUTTON_CHECK_THROTTLE) {
      return; // Skip this execution, too soon
    }
    lastButtonCheckTime = now;

    // Track current URL to detect page changes
    const currentUrl = window.location.href;
    if (window.__PieToolsLastUrl !== currentUrl) {
      // Page changed - reset button insertion flag and update translations
      window.__PieToolsLastUrl = currentUrl;
      window.__PieToolsButtonInserted = false;
      window.__PieToolsRestartInserted = false;
      window.__PieToolsIconInserted = false;
      window.__PieToolsHeaderInserted = false;
      window.__PieToolsPresenceCheckInFlight = false;
      window.__PieToolsPresenceCheckAppId = undefined;
      // Ensure translations are loaded and update existing buttons
      ensureTranslationsLoaded(false).then(function () {
        updateButtonTranslations();
      });
    }

    // Store Header Button Logic (always visible)
    const headerContainer = document.querySelector("._1wn1lBlAzl3HMRqS1llwie");
    if (
      headerContainer &&
      !document.querySelector(".PieTools-header-button") &&
      !window.__PieToolsHeaderInserted
    ) {
      ensurePieToolsStyles();
      const headerBtn = document.createElement("button");
      headerBtn.type = "button";
      headerBtn.className = "PieTools-header-button Focusable";
      headerBtn.tabIndex = "0";
      headerBtn.title = "PieTools Settings";
      headerBtn.setAttribute("data-tooltip-text", "PieTools Settings");

      const img = document.createElement("img");
      img.style.height = "18px";
      img.style.width = "18px";
      img.style.verticalAlign = "middle";

      img.onerror = function () {
        // cogwheel fallback
        headerBtn.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="PieTools"><path fill="currentColor" d="M12 8a4 4 0 100 8 4 4 0 000-8zm9.94 3.06l-2.12-.35a7.962 7.962 0 00-1.02-2.46l1.29-1.72a.75.75 0 00-.09-.97l-1.41-1.41a.75.75 0 00-.97-.09l-1.72 1.29c-.77-.44-1.6-.78-2.46-1.02L13.06 2.06A.75.75 0 0012.31 2h-1.62a.75.75 0 00-.75.65l-.35 2.12a7.962 7.962 0 00-2.46 1.02L5 4.6a.75.75 0 00-.97.09L2.62 6.1a.75.75 0 00-.09.97l1.29 1.72c-.44.77-.78 1.6-1.02 2.46l-2.12.35a.75.75 0 00-.65.75v1.62c0 .37.27.69.63.75l2.14.36c.24.86.58 1.69 1.02 2.46L2.53 18a.75.75 0 00.09.97l1.41 1.41c.26.26.67.29.97.09l1.72-1.29c.77.44 1.6.78 2.46 1.02l.35 2.12c.06.36.38.63.75.63h1.62c.37 0 .69-.27.75-.63l.36-2.14c.86-.24 1.69-.58 2.46-1.02l1.72 1.29c.3.2.71.17.97-.09l1.41-1.41c.26-.26.29-.67.09-.97l-1.29-1.72c.44-.77.78-1.6 1.02-2.46l2.12-.35c.36-.06.63-.38.63-.75v-1.62a.75.75 0 00-.65-.75z"/></svg>';
      };

      img.src = "data:image/png;base64,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";

      Millennium.callServerMethod("PieTools", "GetIconDataUrl", {})
        .then(function (res) {
          const payload = typeof res === "string" ? JSON.parse(res) : res;
          if (payload && payload.success && payload.dataUrl) {
            img.src = payload.dataUrl;
          }
        })
        .catch(function () { });

      headerBtn.appendChild(img);

      headerBtn.onclick = function (e) {
        e.preventDefault();
        showSettingsPopup();
      };

      headerContainer.appendChild(headerBtn);
      window.__PieToolsHeaderInserted = true;
      backendLog("Inserted store header button");
    }

    // Attach MutationObserver for automatic DOM & SPA reconciliation
    observePieToolsInjectionRoot("inject-call");

    // Look for the appropriate container using Semantic Target Discovery
    const targetObj = findPieToolsStoreTarget();
    let targetContainer = targetObj ? targetObj.container : null;
    const isBigPicture = (targetObj && targetObj.kind === "big-picture-queue") || !!window.__PieTools_IS_BIG_PICTURE__;

    if (targetContainer) {
      const steamdbContainer = targetContainer;


      // Insert a Restart Steam button between Community Hub and our PieTools button
      try {
        if (
          !document.querySelector(".PieTools-restart-button") &&
          !window.__PieToolsRestartInserted
        ) {
          ensureStyles();
          // In Big Picture mode, use queue button as reference; otherwise use first link in container
          const referenceBtn = isBigPicture
            ? document.querySelector("#queueBtnFollow")
            : steamdbContainer.querySelector("a");

          // Use same custom button for both modes
          const restartBtn = document.createElement("a");
          if (referenceBtn && referenceBtn.className) {
            restartBtn.className =
              referenceBtn.className + " PieTools-restart-button";
          } else {
            restartBtn.className =
              "btnv6_blue_hoverfade btn_medium PieTools-restart-button";
          }
          restartBtn.href = "#";
          const restartText = lt("Restart Steam");
          restartBtn.title = restartText;
          restartBtn.setAttribute("data-tooltip-text", restartText);
          const rspan = document.createElement("span");
          rspan.textContent = restartText;
          restartBtn.appendChild(rspan);

          // Normalize margins to match native buttons
          try {
            if (referenceBtn) {
              const cs = window.getComputedStyle(referenceBtn);
              restartBtn.style.marginLeft = cs.marginLeft;
              restartBtn.style.marginRight = cs.marginRight;
            }
          } catch (_) { }

          restartBtn.addEventListener("click", function (e) {
            e.preventDefault();
            try {
              // Ensure any settings overlays are closed before confirm
              closeSettingsOverlay();
              askRestartConfirmation();
            } catch (_) {
              askRestartConfirmation();
            }
          });

          if (referenceBtn && referenceBtn.parentElement) {
            referenceBtn.after(restartBtn);
          } else {
            steamdbContainer.appendChild(restartBtn);
          }
          window.__PieToolsRestartInserted = true;
          backendLog("Inserted Restart Steam button");
        }
      } catch (_) { }

      // Status Pills Logic
      // Always update translations for existing buttons (even if not a page change)
      const existingBtn = document.querySelector(".PieTools-button");
      if (existingBtn) {
        ensureTranslationsLoaded(false).then(function () {
          updateButtonTranslations();
        });
      }

      // Check if button already exists to avoid duplicates
      if (!existingBtn && !window.__PieToolsButtonInserted) {
        // Create the PieTools button modeled after existing SteamDB/PCGW buttons
        // In Big Picture mode, use queue button as reference; otherwise use first link in container
        let referenceBtn = isBigPicture
          ? document.querySelector("#queueBtnFollow")
          : steamdbContainer.querySelector("a");

        // Use same custom button for both modes
        const PieToolsButton = document.createElement("a");
        PieToolsButton.href = "#";
        // Copy classes from an existing button to match look-and-feel, but set our own label
        if (referenceBtn && referenceBtn.className) {
          PieToolsButton.className =
            referenceBtn.className + " PieTools-button";
        } else {
          PieToolsButton.className =
            "btnv6_blue_hoverfade btn_medium PieTools-button";
        }
        const span = document.createElement("span");
        const addViaText = lt("Add to Library");
        span.textContent = addViaText;
        PieToolsButton.appendChild(span);
        // Tooltip/title
        // Tooltip/title
        PieToolsButton.title = addViaText;
        PieToolsButton.setAttribute("data-tooltip-text", addViaText);

        // Make it glow pink
        PieToolsButton.style.cssText = "background: linear-gradient(135deg, #31D0FC, #0E43F4) !important; color: white !important; box-shadow: 0 0 15px rgba(49, 208, 252, 0.6) !important; border: none !important; transition: all 0.2s ease !important; text-shadow: none !important;";
        PieToolsButton.onmouseover = function () {
          this.style.setProperty("box-shadow", "0 0 25px rgba(49, 208, 252, 0.9)", "important");
          this.style.setProperty("transform", "scale(1.05)", "important");
        };
        PieToolsButton.onmouseout = function () {
          this.style.setProperty("box-shadow", "0 0 15px rgba(49, 208, 252, 0.6)", "important");
          this.style.setProperty("transform", "scale(1)", "important");
        };
        // Normalize margins to match native buttons
        try {
          if (referenceBtn) {
            const cs = window.getComputedStyle(referenceBtn);
            PieToolsButton.style.marginLeft = cs.marginLeft;
            PieToolsButton.style.marginRight = cs.marginRight;
          }
        } catch (_) { }

        // Local click handler suppressed; delegated handler manages actions
        PieToolsButton.addEventListener("click", function (e) {
          e.preventDefault();

          // Get appid from URL
          const match = window.location.href.match(/\/app\/(\d+)/);
          const appid = match ? parseInt(match[1]) : null;
          if (!appid) {
            alert("Could not find App ID on this page.");
            return;
          }

          // Show loading overlay
          showPieToolsUnlockProgress(appid);
        });

        // Create Patch Button
        const patchButton = document.createElement("a");
        patchButton.href = "#";
        if (referenceBtn && referenceBtn.className) {
          patchButton.className = referenceBtn.className + " PieTools-patch-button";
        } else {
          patchButton.className = "btnv6_blue_hoverfade btn_medium PieTools-patch-button";
        }
        const patchSpan = document.createElement("span");
        const patchText = lt("Apply Fix");
        patchSpan.textContent = patchText;
        patchButton.appendChild(patchSpan);
        patchButton.title = patchText;
        patchButton.setAttribute("data-tooltip-text", patchText);

        // Make it glow green
        patchButton.style.cssText = "background: linear-gradient(135deg, #10b981, #059669) !important; color: white !important; box-shadow: 0 0 15px rgba(16, 185, 129, 0.6) !important; border: none !important; transition: all 0.2s ease !important; text-shadow: none !important;";
        patchButton.onmouseover = function () {
          this.style.setProperty("box-shadow", "0 0 25px rgba(16, 185, 129, 0.9)", "important");
          this.style.setProperty("transform", "scale(1.05)", "important");
        };
        patchButton.onmouseout = function () {
          this.style.setProperty("box-shadow", "0 0 15px rgba(16, 185, 129, 0.6)", "important");
          this.style.setProperty("transform", "scale(1)", "important");
        };
        try {
          if (referenceBtn) {
            const cs = window.getComputedStyle(referenceBtn);
            patchButton.style.marginLeft = cs.marginLeft;
            patchButton.style.marginRight = cs.marginRight;
          }
        } catch (_) { }
        patchButton.addEventListener("click", function (e) {
          e.preventDefault();
          const match = window.location.href.match(/\/app\/(\d+)/);
          const appid = match ? parseInt(match[1]) : null;
          if (!appid) {
            ShowPieToolsAlert("PieTools", "Could not find App ID on this page.");
            return;
          }
          if (window.Millennium && window.Millennium.callServerMethod) {
            patchButton.style.opacity = "0.5";
            patchButton.style.pointerEvents = "none";
            patchSpan.textContent = "Patching...";

            Millennium.callServerMethod("PieTools", "PatchApp", { appId: appid })
              .then((rawRes) => {
                patchButton.style.opacity = "1";
                patchButton.style.pointerEvents = "auto";

                let res = rawRes;
                if (typeof rawRes === "string") {
                  try { res = JSON.parse(rawRes); } catch (e) { }
                }

                if (res && res.success) {
                  patchSpan.textContent = "Patcher Started!";
                  patchButton.style.background = "linear-gradient(135deg, #3b82f6, #2563eb) !important";
                  setTimeout(() => {
                    patchSpan.textContent = "Apply Fix";
                    patchButton.style.cssText = "background: linear-gradient(135deg, #10b981, #059669) !important; color: white !important; box-shadow: 0 0 15px rgba(16, 185, 129, 0.6) !important; border: none !important; transition: all 0.2s ease !important; text-shadow: none !important;";
                  }, 3000);
                } else {
                  patchSpan.textContent = "Failed";
                  ShowPieToolsAlert("Patch failed", (res && res.error) || "Unknown error");
                  setTimeout(() => {
                    patchSpan.textContent = "Apply Fix";
                  }, 3000);
                }
              })
              .catch((err) => {
                patchButton.style.opacity = "1";
                patchButton.style.pointerEvents = "auto";
                patchSpan.textContent = "Error";
                ShowPieToolsAlert("Patch error", String(err));
                setTimeout(() => {
                  patchSpan.textContent = "Apply Fix";
                }, 3000);
              });
          } else {
            showPieToolsAlert("PieTools", "Millennium API not found.");
          }
        });

        // Before inserting, ask backend if PieTools already exists for this appid
        try {
          const match =
            window.location.href.match(
              /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
            ) ||
            window.location.href.match(
              /https:\/\/steamcommunity\.com\/app\/(\d+)/,
            );
          const appid = match ? parseInt(match[1], 10) : NaN;
          if (
            !isNaN(appid) &&
            typeof Millennium !== "undefined" &&
            typeof Millennium.callServerMethod === "function"
          ) {
            // prevent multiple concurrent checks
            if (
              window.__PieToolsPresenceCheckInFlight &&
              window.__PieToolsPresenceCheckAppId === appid
            ) {
              return;
            }
            window.__PieToolsPresenceCheckInFlight = true;
            window.__PieToolsPresenceCheckAppId = appid;
            window.__PieToolsCurrentAppId = appid;
            // Always insert the button - bypass backend check
            Promise.resolve({ success: true, exists: false }).then(function (res) {
              try {
                const payload = res;
                if (false) {
                  backendLog("skipped");
                  window.__PieToolsPresenceCheckInFlight = false;
                  return;
                }
                // Re-check in case another caller inserted during async
                if (
                  !document.querySelector(".PieTools-button") &&
                  !window.__PieToolsButtonInserted
                ) {
                  // Insert after restart button (order: Restart â†’ Add)
                  const restartExisting = steamdbContainer.querySelector(
                    ".PieTools-restart-button",
                  );
                  if (restartExisting && restartExisting.after) {
                    restartExisting.after(PieToolsButton);
                    PieToolsButton.before(patchButton);
                  } else if (referenceBtn && referenceBtn.after) {
                    referenceBtn.after(PieToolsButton);
                    PieToolsButton.before(patchButton);
                  } else {
                    steamdbContainer.appendChild(patchButton);
                    steamdbContainer.appendChild(PieToolsButton);
                  }
                  window.__PieToolsButtonInserted = true;
                  backendLog("PieTools button inserted");
                }
                window.__PieToolsPresenceCheckInFlight = false;
              } catch (_) {
                if (
                  !document.querySelector(".PieTools-button") &&
                  !window.__PieToolsButtonInserted
                ) {
                  steamdbContainer.appendChild(patchButton);
                  steamdbContainer.appendChild(PieToolsButton);
                  window.__PieToolsButtonInserted = true;
                  backendLog("PieTools button inserted");
                }
                window.__PieToolsPresenceCheckInFlight = false;
              }
            });
          } else {
            if (
              !document.querySelector(".PieTools-button") &&
              !window.__PieToolsButtonInserted
            ) {
              // Insert after restart button (order: Restart â†’ Add)
              const restartExisting = steamdbContainer.querySelector(
                ".PieTools-restart-button",
              );
              if (restartExisting && restartExisting.after) {
                restartExisting.after(PieToolsButton);
                PieToolsButton.before(patchButton);
              } else if (referenceBtn && referenceBtn.after) {
                referenceBtn.after(PieToolsButton);
                PieToolsButton.before(patchButton);
              } else {
                steamdbContainer.appendChild(patchButton);
                steamdbContainer.appendChild(PieToolsButton);
              }
              window.__PieToolsButtonInserted = true;
              backendLog("PieTools button inserted");
            }
          }
        } catch (_) {
          if (
            !document.querySelector(".PieTools-button") &&
            !window.__PieToolsButtonInserted
          ) {
            const restartExisting = steamdbContainer.querySelector(
              ".PieTools-restart-button",
            );
            if (restartExisting && restartExisting.after) {
              restartExisting.after(PieToolsButton);
              PieToolsButton.before(patchButton);
            } else if (referenceBtn && referenceBtn.after) {
              referenceBtn.after(PieToolsButton);
              PieToolsButton.before(patchButton);
            } else {
              steamdbContainer.appendChild(patchButton);
              steamdbContainer.appendChild(PieToolsButton);
            }
            window.__PieToolsButtonInserted = true;
            backendLog("PieTools button inserted");
          }
        }
      }

      // status pills â€” only run once per appid
      try {
        const match =
          window.location.href.match(
            /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
          ) ||
          window.location.href.match(
            /https:\/\/steamcommunity\.com\/app\/(\d+)/,
          );
        const appid = match
          ? parseInt(match[1], 10)
          : window.__PieToolsCurrentAppId || NaN;

        if (!isNaN(appid)) {
          syncLeftStoreActionButtons(appid);
          const pillBtn = steamdbContainer.querySelector(".PieTools-button");
          if (pillBtn) {
            // Skip if pills already built for this appid
            var existingPills = pillBtn.querySelector(
              ".PieTools-pills-container",
            );
            if (
              !(
                existingPills &&
                existingPills.dataset.appid === String(appid) &&
                existingPills.dataset.content
              )
            ) {
              fetchGamesDatabase().then(function (db) {
                const btn = steamdbContainer.querySelector(".PieTools-button");
                if (!btn) return;

                let pillsContainer = btn.querySelector(
                  ".PieTools-pills-container",
                );

                if (!pillsContainer) {
                  pillsContainer = document.createElement("div");
                  pillsContainer.className = "PieTools-pills-container";
                  btn.appendChild(pillsContainer);
                }
                pillsContainer.dataset.appid = String(appid);

                const key = String(appid);
                const gameData = db && db[key] ? db[key] : null;

                // check denuvo and 3rd party DRMs
                let hasDenuvo = false;
                let hasUbisoft = false;
                let hasRockstar = false;
                let hasEA = false;

                document.querySelectorAll(".DRM_notice").forEach(function (node) {
                  const txt = (node.textContent || "").toLowerCase();
                  if (txt.includes("denuvo")) hasDenuvo = true;
                  if (txt.includes("ubisoft") || txt.includes("uplay")) hasUbisoft = true;
                  if (txt.includes("rockstar") || txt.includes("social club")) hasRockstar = true;
                  if (txt.includes("ea on-line") || txt.includes("ea account") || txt.includes("origin client")) hasEA = true;
                });

                // check online features
                let hasOnline = false;
                document.querySelectorAll(".game_area_details_specs_ctn .label, .game_area_details_specs_ctn .name").forEach(function (node) {
                  const txt = (node.textContent || "").toLowerCase();
                  if (txt.includes("online pvp") || txt.includes("online co-op") || txt.includes("multiplayer") || txt.includes("cross-platform multiplayer") || txt.includes("shared/split screen pvp") || txt.includes("shared/split screen co-op")) {
                    hasOnline = true;
                  }
                });

                fetchFixes(appid).then(function (fixesData) {
                  const hasOnlineFix = fixesData && fixesData.onlineFix && fixesData.onlineFix.status === 200;
                  const hasGenericFix = fixesData && fixesData.genericFix && fixesData.genericFix.status === 200;
                  const hasFixes = hasGenericFix || hasOnlineFix;
                  const showDenuvoPill = hasDenuvo && !hasFixes;
                  const showUbisoftPill = hasUbisoft && !hasFixes && !showDenuvoPill;
                  const showRockstarPill = hasRockstar && !hasFixes && !showDenuvoPill;
                  const showEAPill = hasEA && !hasFixes && !showDenuvoPill;
                  const showOnlinePill = hasOnline || hasOnlineFix;

                  const cacheKey = JSON.stringify({
                    d: gameData || "untested",
                    showDenuvo: showDenuvoPill,
                    showUbisoft: showUbisoftPill,
                    showRockstar: showRockstarPill,
                    showEA: showEAPill,
                    showOnline: showOnlinePill,
                    hasFixes: hasFixes,
                  });

                  if (pillsContainer.dataset.content === cacheKey) return;
                  pillsContainer.dataset.content = cacheKey;

                  pillsContainer.innerHTML = "";

                  let status = "untested";
                  if (gameData && typeof gameData.playable !== "undefined") {
                    if (gameData.playable === 1) status = "playable";
                    else if (gameData.playable === 0) status = "unplayable";
                    else if (gameData.playable === 2) status = "needs_fixes";
                  }

                  if (status === "untested" && hasFixes) {
                    status = "needs_fixes";
                  }

                  if (status !== "untested") {
                    const pill = document.createElement("span");
                    pill.className = "PieTools-pill";
                    if (status === "playable") {
                      pill.classList.add("green");
                      pill.textContent = t("gameStatus.playable", "Playable");
                    } else if (status === "unplayable") {
                      pill.classList.add("red");
                      pill.textContent = t(
                        "gameStatus.unplayable",
                        "Unplayable",
                      );
                    } else if (status === "needs_fixes") {
                      pill.classList.add("yellow");
                      pill.textContent = t(
                        "gameStatus.needsFixes",
                        "Needs fixes",
                      );
                    }
                    pillsContainer.appendChild(pill);
                  }

                  // reset button state
                  const btn =
                    steamdbContainer.querySelector(".PieTools-button");
                  if (btn) {
                    btn.style.opacity = "";
                    btn.style.pointerEvents = "";
                    btn.style.cursor = "";
                    const span = btn.querySelector("span");
                    if (span && span.textContent === "Unplayable") {
                      span.textContent = lt("Add to Library");
                    }
                  }

                  if (showDenuvoPill) {
                    const pill = document.createElement("span");
                    pill.className = "PieTools-pill red";
                    pill.textContent = t("gameStatus.denuvo", "Require Activation");
                    pillsContainer.appendChild(pill);
                  }

                  if (showUbisoftPill) {
                    const pill = document.createElement("span");
                    pill.className = "PieTools-pill blue";
                    pill.textContent = "Requires Ubisoft";
                    pillsContainer.appendChild(pill);
                  }

                  if (showRockstarPill) {
                    const pill = document.createElement("span");
                    pill.className = "PieTools-pill yellow";
                    pill.textContent = "Requires Rockstar";
                    pillsContainer.appendChild(pill);
                  }

                  if (showEAPill) {
                    const pill = document.createElement("span");
                    pill.className = "PieTools-pill orange";
                    pill.textContent = "Requires EA";
                    pillsContainer.appendChild(pill);
                  }

                  if (showOnlinePill) {
                    const pill = document.createElement("span");
                    pill.className = "PieTools-pill green";
                    pill.textContent = t("gameStatus.onlinePatch", "REQUIRE PATCH");
                    pillsContainer.appendChild(pill);
                  }
                });
              });
            }
          }
        }
      } catch (e) {
        /* ignore */
      }
    } else {
      if (!logState.missingOnce) {
        backendLog("PieTools: steamdbContainer not found on this page");
        logState.missingOnce = true;
      }
    }
  }

  // Try to add the button immediately if DOM is ready
  function onFrontendReady() {
    // Fetch settings + translations FIRST, then insert the button once in the correct language
    try {
      fetchSettingsConfig(true)
        .then(function (cfg) {
          try {
            ensurePieToolsStyles();
          } catch (_) { }

          // Show disclaimer after translations are loaded so it displays in the correct language
          try {
            if (window.location.hostname === "store.steampowered.com") {
              if (
                localStorage.getItem(
                  "PieTools millennium disclaimer accepted",
                ) !== "1"
              ) {
                showMillenniumDisclaimerModal();
              }
            }
          } catch (_) { }

          // Now translations are ready â€” insert the button in the correct language
          addPieToolsButton();
        })
        .catch(function (_) {
          // Settings failed, still insert button (English fallback)
          addPieToolsButton();
        });
    } catch (_) {
      addPieToolsButton();
    }

    // Show gamepad hint if connected (only in Big Picture mode)
    setTimeout(function () {
      if (
        window.GamepadNav &&
        window.GamepadNav.isConnected &&
        window.GamepadNav.isConnected()
      ) {
        backendLog("[PieTools] Gamepad detected - Navigation enabled");

        // Only show visual hint in Big Picture mode
        if (window.__PieTools_IS_BIG_PICTURE__) {
          const hint = document.createElement("div");
          hint.id = "PieTools-gamepad-hint";
          hint.innerHTML = "ðŸŽ® " + lt("bigpicture.mouseTip");
          hint.style.cssText =
            "\
                        position: fixed;\
                        bottom: 20px;\
                        right: 20px;\
                        background: rgba(11, 20, 30, 0.9);\
                        color: #31D0FC;\
                        padding: 12px 16px;\
                        border-radius: 8px;\
                        font-size: 14px;\
                        z-index: 99998;\
                        border: 1px solid rgba(49, 208, 252, 0.3);\
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);\
                        animation: fadeInOut 3s ease-in-out;\
                    ";

          // Add CSS animation if not already present
          if (!document.querySelector("#PieTools-gamepad-hint-styles")) {
            const style = document.createElement("style");
            style.id = "PieTools-gamepad-hint-styles";
            style.textContent =
              "\
                            @keyframes fadeInOut {\
                                0% { opacity: 0; transform: translateY(10px); }\
                                10% { opacity: 1; transform: translateY(0); }\
                                90% { opacity: 1; transform: translateY(0); }\
                                100% { opacity: 0; transform: translateY(10px); }\
                            }\
                        ";
            document.head.appendChild(style);
          }

          document.body.appendChild(hint);

          // Auto-remove after animation
          setTimeout(function () {
            if (hint && hint.parentElement) {
              hint.remove();
            }
          }, 3000);
        }
      }
    }, 500);

    // Ask backend if there is a queued startup message from InitApis
    try {
      if (
        typeof Millennium !== "undefined" &&
        typeof Millennium.callServerMethod === "function"
      ) {
        Millennium.callServerMethod("PieTools", "GetInitApisMessage", {
          contentScriptQuery: "",
        }).then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (payload && payload.message) {
              const msg = String(payload.message);
              // Check if this is an update message (contains "update" or "restart")
              const isUpdateMsg =
                msg.toLowerCase().includes("update") ||
                msg.toLowerCase().includes("restart");

              if (isUpdateMsg) {
                // For update messages, use confirm dialog with OK (restart) and Cancel options
                askRestartConfirmation();
              } else {
                // For non-update messages, use regular alert
                ShowPieToolsAlert("PieTools", msg);
              }
            }
          } catch (_) { }
        });
        // Also show loaded apps list if present (only once per session, store page only)
        try {
          if (window.location.hostname === "store.steampowered.com") {
            if (!sessionStorage.getItem("PieToolsLoadedAppsGate")) {
              sessionStorage.setItem("PieToolsLoadedAppsGate", "1");
              Millennium.callServerMethod("PieTools", "ReadLoadedApps", {
                contentScriptQuery: "",
              }).then(function (res) {
                try {
                  const payload =
                    typeof res === "string" ? JSON.parse(res) : res;
                  const apps =
                    payload && payload.success && Array.isArray(payload.apps)
                      ? payload.apps
                      : [];
                  if (apps.length > 0) {
                    showLoadedAppsPopup(apps);
                  }
                } catch (_) { }
              });
            }
          }
        } catch (_) { }
      }
    } catch (_) { }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onFrontendReady);
  } else {
    onFrontendReady();
  }

  // Delegate click handling in case the DOM is re-rendered and listeners are lost
  // Use bubble phase instead of capture phase to avoid interfering with gamepad navigation
  document.addEventListener(
    "click",
    function (evt) {
      // Quick exit if target doesn't have closest method or isn't an element
      if (!evt.target || !evt.target.closest) return;

      const anchor = evt.target.closest(".PieTools-button");
      if (anchor) {
        evt.preventDefault();
        evt.stopPropagation(); // Stop propagation to avoid conflicts
        backendLog("PieTools delegated click");

        // --- PieTools BYPASS ---
        const match_appid = window.location.href.match(/\/app\/(\d+)/);
        const the_appid = match_appid ? parseInt(match_appid[1]) : null;
        if (the_appid) {
          showPieToolsUnlockProgress(the_appid);
          return;
        }
        // --- END BYPASS ---

        try {
          const match =
            window.location.href.match(
              /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
            ) ||
            window.location.href.match(
              /https:\/\/steamcommunity\.com\/app\/(\d+)/,
            );
          const appid = match ? parseInt(match[1], 10) : NaN;
          if (
            !isNaN(appid) &&
            typeof Millennium !== "undefined" &&
            typeof Millennium.callServerMethod === "function"
          ) {
            if (runState.inProgress && runState.appid === appid) {
              backendLog(
                "PieTools: operation already in progress for this appid",
              );
              return;
            }

            // Helper that continues with the multi-API check flow
            const continueWithAdd = function () {
              // Open the loading popup first to show "Searching..."
              showTestPopup();
              const overlay = document.querySelector(".PieTools-overlay");
              const status = overlay
                ? overlay.querySelector(".PieTools-status")
                : null;
              const apiList = overlay
                ? overlay.querySelector(".PieTools-api-list")
                : null;

              if (status)
                status.textContent = lt("Searching across sources...");

              Millennium.callServerMethod("PieTools", "CheckApisForApp", {
                appid,
                contentScriptQuery: "",
              })
                .then(function (res) {
                  try {
                    const payload =
                      typeof res === "string" ? JSON.parse(res) : res;
                    if (!payload || !payload.success) {
                      throw new Error(payload.error || "Check failed");
                    }

                    const results = payload.results || [];
                    const available = results.filter((r) => r.available);

                    if (available.length === 0) {
                      const msg = lt("Game not found on any available API.");
                      if (status) status.textContent = msg;
                      const hideBtn = overlay
                        ? overlay.querySelector(".PieTools-hide-btn")
                        : null;
                      if (hideBtn)
                        hideBtn.innerHTML = "<span>" + lt("Close") + "</span>";
                      return;
                    }

                    let isFastDownload = true; // default
                    try {
                      if (
                        window.__PieToolsSettings &&
                        window.__PieToolsSettings.values &&
                        window.__PieToolsSettings.values.general
                      ) {
                        if (
                          typeof window.__PieToolsSettings.values.general
                            .fastDownload !== "undefined"
                        ) {
                          isFastDownload =
                            window.__PieToolsSettings.values.general
                              .fastDownload;
                        }
                      }
                    } catch (e) { }

                    if (isFastDownload) {
                      // Fast download enabled, proceed automatically with the first available
                      const source = available[0];
                      backendLog(
                        "PieTools: Auto-selecting source via fast download: " + source.name,
                      );
                      startDirectDownload(appid, available, 0);
                    } else {
                      // Fast download disabled, let user select
                      showSourceSelectionModal(appid, available);
                    }
                  } catch (err) {
                    backendLog("PieTools: CheckApisForApp error: " + err);
                    if (status)
                      status.textContent = lt("Error: {error}").replace(
                        "{error}",
                        err.message,
                      );
                  }
                })
                .catch(function (err) {
                  backendLog("PieTools: CheckApisForApp promise error: " + err);
                });
            };

            const startDirectDownload = function (
              appid,
              availableSources,
              index = 0,
            ) {
              const source = availableSources[index];
              const url = source.url;
              const apiName = source.name;

              const performDownload = function () {
                runState.inProgress = true;
                runState.appid = appid;

                // If the selection modal was open, it should be replaced by showTestPopup or updated
                const overlay = document.querySelector(".PieTools-overlay");
                if (overlay) {
                  // Reset for progress
                  const status = overlay.querySelector(".PieTools-status");
                  if (status) {
                    if (index > 0) {
                      status.textContent = lt(
                        "Failed on {previous}. Trying {current}...",
                      )
                        .replace("{previous}", availableSources[index - 1].name)
                        .replace("{current}", apiName);
                    } else {
                      status.textContent = lt("Initializing download...");
                    }
                  }
                  const progressWrap = overlay.querySelector(
                    ".PieTools-progress-wrap",
                  );
                  if (progressWrap) progressWrap.style.display = "block";
                  const progressInfo = overlay.querySelector(
                    ".PieTools-progress-info",
                  );
                  if (progressInfo) progressInfo.style.display = "block";
                  const cancelBtn = overlay.querySelector(
                    ".PieTools-cancel-btn",
                  );
                  if (cancelBtn) cancelBtn.style.display = "flex";
                } else {
                  showTestPopup();
                }

                Millennium.callServerMethod(
                  "PieTools",
                  "StartAddViaPieToolsFromUrl",
                  {
                    appid,
                    url,
                    apiName,
                    contentScriptQuery: "",
                  },
                );

                const onFailedCallback = function (errMsg) {
                  if (index + 1 < availableSources.length) {
                    backendLog(
                      "PieTools: Fast download failed on " +
                      apiName +
                      " (" +
                      errMsg +
                      "). Trying next API: " +
                      availableSources[index + 1].name,
                    );
                    setTimeout(function () {
                      startDirectDownload(appid, availableSources, index + 1);
                    }, 1500);
                  }
                };

                startPolling(appid, onFailedCallback);
              };

              if (apiName && apiName.toLowerCase().includes("morrenus")) {
                let hubcapKey = "";
                try {
                  if (
                    window.__PieToolsSettings &&
                    window.__PieToolsSettings.values &&
                    window.__PieToolsSettings.values.advanced
                  ) {
                    hubcapKey =
                      window.__PieToolsSettings.values.advanced
                        .morrenusApiKey || "";
                  }
                  if (!hubcapKey) {
                    for (const group in window.__PieToolsSettings.values) {
                      if (
                        window.__PieToolsSettings.values[group] &&
                        window.__PieToolsSettings.values[group].morrenusApiKey
                      ) {
                        hubcapKey =
                          window.__PieToolsSettings.values[group]
                            .morrenusApiKey;
                        break;
                      }
                    }
                  }
                } catch (e) { }

                if (hubcapKey && /^smm_[0-9a-f]{96}$/.test(hubcapKey)) {
                  // Wait, check the limits
                  showTestPopup(); // Ensures basic loading modal is up
                  const overlay = document.querySelector(".PieTools-overlay");
                  if (overlay) {
                    const status = overlay.querySelector(".PieTools-status");
                    if (status)
                      status.textContent = lt("Verifying API limits...");
                    const cancelBtn = overlay.querySelector(
                      ".PieTools-cancel-btn",
                    );
                    if (cancelBtn) cancelBtn.style.display = "none";
                  }

                  Millennium.callServerMethod("PieTools", "GetMorrenusStats", {
                    api_key: hubcapKey,
                    force_refresh: true,
                    contentScriptQuery: "",
                  })
                    .then((r) => (typeof r === "string" ? JSON.parse(r) : r))
                    .then((res) => {
                      if (
                        res &&
                        res.detail === "API key not found or expired"
                      ) {
                        // 401 - invalid or expired key
                        showPieToolsPlayableWarning(
                          lt(
                            "Your Morrenus API key is invalid or expired. Please check your key in the settings or regenerate it on the Morrenus website.",
                          ),
                          function () {
                            showSettingsManagerPopup(false, null);
                          },
                          null,
                        );
                        runState.inProgress = false;
                      } else if (
                        res &&
                        typeof res.detail === "string" &&
                        res.detail.startsWith("Daily limit reached")
                      ) {
                        // 429 - daily limit exhausted
                        showPieToolsPlayableWarning(
                          lt(
                            "You have exceeded your daily download limit. Please wait until tomorrow for more uses, or upgrade your plan on the Morrenus website.",
                          ),
                          function () {
                            showSettingsManagerPopup(false, null);
                          },
                          null,
                        );
                        runState.inProgress = false;
                      } else if (
                        res &&
                        typeof res.daily_usage !== "undefined" &&
                        typeof res.daily_limit !== "undefined" &&
                        res.daily_usage >= res.daily_limit
                      ) {
                        // usage fields show limit reached (fallback)
                        showPieToolsPlayableWarning(
                          lt(
                            "You have exceeded your daily download limit. Please wait until tomorrow for more uses, or upgrade your plan on the Morrenus website.",
                          ),
                          function () {
                            showSettingsManagerPopup(false, null);
                          },
                          null,
                        );
                        runState.inProgress = false;
                      } else {
                        performDownload();
                      }
                    })
                    .catch((e) => {
                      backendLog(
                        "PieTools: Error checking Morrenus API limit: " + e,
                      );
                      // Network error or other, try to proceed and let the backend error it if needed
                      performDownload();
                    });
                  return; // yield execution to async fetch
                }
              }

              // Normal flow if not Morrenus or no key present
              performDownload();
            };

            function showSourceSelectionModal(appid, available) {
              const overlay = document.querySelector(".PieTools-overlay");
              if (!overlay) return;

              const colors = getThemeColors();
              const title = overlay.querySelector(".PieTools-title");
              const status = overlay.querySelector(".PieTools-status");
              const apiList = overlay.querySelector(".PieTools-api-list");

              if (title) title.textContent = lt("Select Download Source");
              if (status) status.style.display = "none"; // Remove "Multiple sources found" text

              if (apiList) {
                apiList.innerHTML = "";
                apiList.style.cssText =
                  "display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-top:16px;";

                available.forEach((source) => {
                  const btn = document.createElement("a");
                  btn.href = "#";
                  btn.className = "PieTools-btn focusable";
                  btn.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;flex:1;min-width:80px;padding:12px 8px;background:rgba(${colors.rgbString},0.06);border:1px solid ${colors.borderRgba};border-radius:12px;text-decoration:none;transition:all 0.2s ease;text-align:center;`;

                  const srcIcon = document.createElement("i");
                  srcIcon.className = "fa-solid fa-server";
                  srcIcon.style.cssText = `font-size:18px;color:${colors.accent};`;

                  const name = document.createElement("div");
                  name.style.cssText = `font-size:11px; font-weight:500; color:${colors.text};line-height:1.2;`;
                  name.textContent = source.name;

                  btn.appendChild(srcIcon);
                  btn.appendChild(name);

                  btn.onmouseover = function () {
                    this.style.background = `rgba(${colors.rgbString},0.25)`;
                    this.style.borderColor = colors.accent;
                    this.style.transform = "translateY(-1px)";
                  };
                  btn.onmouseout = function () {
                    this.style.background = `rgba(${colors.rgbString},0.1)`;
                    this.style.borderColor = colors.borderRgba;
                    this.style.transform = "translateY(0)";
                  };

                  btn.onclick = function (e) {
                    e.preventDefault();
                    apiList.style.display = "block"; // Reset layout for progress
                    apiList.style.flexDirection = "";
                    apiList.innerHTML = ""; // Clear selection buttons
                    if (status) status.style.display = ""; // Restore status text
                    startDirectDownload(appid, [source], 0);
                  };

                  apiList.appendChild(btn);
                });
              }

              // Update Cancel button: show it, hide the Hide/Close button, and make it close the modal
              const cancelBtn = overlay.querySelector(".PieTools-cancel-btn");
              const hideBtn = overlay.querySelector(".PieTools-hide-btn");

              if (cancelBtn) {
                cancelBtn.style.display = "flex";
                cancelBtn.innerHTML = `<span>${lt("Cancel")}</span>`;
                cancelBtn.onclick = function (e) {
                  e.preventDefault();
                  overlay.remove(); // Close modal immediately
                };
              }

              if (hideBtn) {
                hideBtn.style.display = "none"; // Remove "Hide" button as per request
              }

              // Re-scan for gamepad
              if (window.GamepadNav) window.GamepadNav.scanElements();
            }

            // Check if this is a dlc
            const isdlc = !!document.querySelector(".game_area_dlc_bubble");
            const parentdiv = document.querySelector(
              '.glance_details a[href*="/app/"]',
            );

            if (isdlc && parentdiv) {
              const id = parseInt(
                parentdiv.href.match(/app\/(\d+)\//)?.[1] ?? "",
              );
              const name = parentdiv.innerText ?? "name not found";

              showDlcWarning(appid, id, name);
            } else {
              // Not a dlc (or failed) ? Then continue normally
              return fetchGamesDatabase().then(function (db) {
                try {
                  const gameData = db?.[String(appid)] ?? null;
                  if (gameData?.playable === 0) {
                    // warning modal
                    showPieToolsPlayableWarning(
                      "This game may not work, support for it wont be given in our discord",
                      function () {
                        continueWithAdd();
                      },
                      function () { },
                    );
                  } else {
                    continueWithAdd();
                  }
                } catch (_) {
                  continueWithAdd();
                }
              });
            }
          }
        } catch (_) { }
      }
    },
    false,
  ); // Changed from true to false (bubble phase instead of capture phase)

  // Poll backend for progress and update progress bar and text
  function startPolling(appid, onFailedCallback) {
    let done = false;
    let lastCheckedApi = null;
    let successfulApi = null; // Track which API successfully found the file
    const timer = setInterval(() => {
      if (done) {
        clearInterval(timer);
        return;
      }
      try {
        Millennium.callServerMethod("PieTools", "GetAddViaPieToolsStatus", {
          appid,
          contentScriptQuery: "",
        }).then(function (res) {
          try {
            const payload = typeof res === "string" ? JSON.parse(res) : res;
            const st = payload && payload.state ? payload.state : {};

            // Try to find overlay (may or may not be visible)
            const overlay = document.querySelector(".PieTools-overlay");
            const title = overlay
              ? overlay.querySelector(".PieTools-title")
              : null;
            const status = overlay
              ? overlay.querySelector(".PieTools-status")
              : null;
            const wrap = overlay
              ? overlay.querySelector(".PieTools-progress-wrap")
              : null;
            const progressInfo = overlay
              ? overlay.querySelector(".PieTools-progress-info")
              : null;
            const percent = overlay
              ? overlay.querySelector(".PieTools-percent")
              : null;
            const downloadSize = overlay
              ? overlay.querySelector(".PieTools-download-size")
              : null;
            const bar = overlay
              ? overlay.querySelector(".PieTools-progress-bar")
              : null;

            // Update individual API status in the list
            if (overlay) {
              const colors = getThemeColors();
              const apiItems = overlay.querySelectorAll(".PieTools-api-item");

              // Track successful API when download/processing starts
              if (
                (st.status === "downloading" ||
                  st.status === "processing" ||
                  st.status === "installing" ||
                  st.status === "done") &&
                st.currentApi &&
                !successfulApi
              ) {
                successfulApi = st.currentApi;

                // Mark all APIs: not found before successful, skipped after
                let foundSuccessful = false;
                apiItems.forEach((item) => {
                  const apiName = item.getAttribute("data-api-name");
                  const apiStatus = item.querySelector(".PieTools-api-status");
                  if (!apiStatus) return;

                  if (apiName === successfulApi) {
                    foundSuccessful = true;
                    item.style.background = `rgba(${colors.rgbString},0.2)`;
                    item.style.borderColor = colors.accent;
                    apiStatus.innerHTML = `<span style="color:${colors.accent};">${lt("Found")}</span><i class="fa-solid fa-check" style="color:${colors.accent};"></i>`;
                  } else if (!foundSuccessful) {
                    // This API comes before the successful one, check if it has an error first
                    if (st.apiErrors && st.apiErrors[apiName]) {
                      const apiError = st.apiErrors[apiName];
                      item.style.background = `rgba(255, 0, 0, 0.15)`;
                      item.style.borderColor = "#ff5c5c";
                      if (apiError.type === "timeout") {
                        apiStatus.innerHTML = `<span style="color:#ff5c5c;">${lt("Error, Timed Out")}</span><i class="fa-solid fa-clock" style="color:#ff5c5c;"></i>`;
                      } else if (apiError.type === "error") {
                        const code = apiError.code ? String(apiError.code) : "";
                        apiStatus.innerHTML = `<span style="color:#ff5c5c;">${lt("Error, Code: {code}").replace("{code}", code)}</span><i class="fa-solid fa-exclamation-triangle" style="color:#ff5c5c;"></i>`;
                      }
                    } else {
                      // Mark as not found
                      item.style.background = `rgba(0,0,0,0.2)`;
                      item.style.borderColor = colors.borderRgba;
                      apiStatus.innerHTML = `<span style="color:${colors.textSecondary};">${lt("Not found")}</span><i class="fa-solid fa-xmark" style="color:${colors.textSecondary};"></i>`;
                    }
                  } else {
                    // This API comes after the successful one, mark as skipped
                    item.style.background = `rgba(0,0,0,0.15)`;
                    item.style.borderColor = colors.borderRgba;
                    apiStatus.innerHTML = `<span style="color:${colors.textSecondary};">${lt("Skipped")}</span><i class="fa-solid fa-minus" style="color:${colors.textSecondary};"></i>`;
                  }
                });
              }

              // Mark previous API as not found if we moved to a new one (only during checking phase)
              if (
                st.status === "checking" &&
                st.currentApi &&
                st.currentApi !== lastCheckedApi &&
                lastCheckedApi
              ) {
                apiItems.forEach((item) => {
                  const apiName = item.getAttribute("data-api-name");
                  const apiStatus = item.querySelector(".PieTools-api-status");
                  if (!apiStatus) return;

                  if (apiName === lastCheckedApi) {
                    item.style.background = `rgba(0,0,0,0.2)`;
                    item.style.borderColor = colors.borderRgba;
                    apiStatus.innerHTML = `<span style="color:${colors.textSecondary};">${lt("Not found")}</span><i class="fa-solid fa-xmark" style="color:${colors.textSecondary};"></i>`;
                  }
                });
              }

              // Update current API status during checking
              if (st.status === "checking" && st.currentApi) {
                apiItems.forEach((item) => {
                  const apiName = item.getAttribute("data-api-name");
                  const apiStatus = item.querySelector(".PieTools-api-status");
                  if (!apiStatus) return;

                  if (apiName === st.currentApi) {
                    item.style.background = `rgba(${colors.rgbString},0.15)`;
                    item.style.borderColor = colors.accent;
                    apiStatus.innerHTML = `<span style="color:${colors.accent};">${lt("Checkingâ€¦")}</span><i class="fa-solid fa-spinner" style="color:${colors.accent};animation: spin 1.5s linear infinite;"></i>`;
                  }
                });

                lastCheckedApi = st.currentApi;
              }

              // Show error statuses for APIs that errored (when not checking them anymore)
              if (st.apiErrors && typeof st.apiErrors === "object") {
                apiItems.forEach((item) => {
                  const apiName = item.getAttribute("data-api-name");
                  const apiStatus = item.querySelector(".PieTools-api-status");
                  if (!apiStatus || !apiName) return;

                  const apiError = st.apiErrors[apiName];
                  if (!apiError) return;

                  // Only show error if this API is not currently being checked
                  if (st.currentApi === apiName && st.status === "checking")
                    return;

                  // Don't overwrite "Found" status
                  const statusText = apiStatus.textContent || "";
                  if (
                    statusText.includes("Found") ||
                    statusText.includes("Encontrado")
                  )
                    return;

                  item.style.background = `rgba(255, 0, 0, 0.15)`;
                  item.style.borderColor = "#ff5c5c";

                  if (apiError.type === "timeout") {
                    apiStatus.innerHTML = `<span style="color:#ff5c5c;">${lt("Error, Timed Out")}</span><i class="fa-solid fa-clock" style="color:#ff5c5c;"></i>`;
                  } else if (apiError.type === "error") {
                    const code = apiError.code ? String(apiError.code) : "";
                    apiStatus.innerHTML = `<span style="color:#ff5c5c;">${lt("Error, Code: {code}").replace("{code}", code)}</span><i class="fa-solid fa-exclamation-triangle" style="color:#ff5c5c;"></i>`;
                  }
                });
              }
            }

            // Update UI if overlay is present
            if (st.status === "checking" && st.currentApi && title) {
              title.textContent = lt("PieTools Â· {api}").replace(
                "{api}",
                st.currentApi,
              );
            } else if (
              (st.status === "downloading" ||
                st.status === "processing" ||
                st.status === "installing") &&
              title
            ) {
              title.textContent = t("common.appName", "PieTools");
            }

            if (status) {
              const spinner =
                '<i class="fa-solid fa-spinner" style="font-size:14px;animation: spin 1.5s linear infinite;margin-right:8px;"></i>';
              const dlIcon =
                '<i class="fa-solid fa-cloud-arrow-down" style="font-size:14px;animation: bounce 2s infinite;margin-right:8px;"></i>';
              const gearIcon =
                '<i class="fa-solid fa-gear" style="font-size:14px;animation: spin 3s linear infinite;margin-right:8px;"></i>';

              if (st.status === "checking")
                status.innerHTML =
                  spinner + "<span>" + lt("Checking availabilityâ€¦") + "</span>";
              if (st.status === "downloading")
                status.innerHTML =
                  dlIcon + "<span>" + lt("Downloadingâ€¦") + "</span>";
              if (st.status === "processing")
                status.innerHTML =
                  gearIcon + "<span>" + lt("Processing packageâ€¦") + "</span>";
              if (st.status === "installing")
                status.innerHTML =
                  gearIcon + "<span>" + lt("Installingâ€¦") + "</span>";
              if (st.status === "checking content")
                status.innerHTML =
                  spinner + "<span>" + lt("Checking contentâ€¦") + "</span>";
              if (st.status === "failed")
                status.innerHTML =
                  '<i class="fa-solid fa-circle-xmark" style="color:#ff5c5c;font-size:14px;margin-right:8px;"></i><span>' +
                  lt("Failed") +
                  "</span>";
            }
            if (
              ["downloading", "processing", "installing"].includes(st.status)
            ) {
              // reveal progress UI (if overlay visible)
              if (wrap && wrap.style.display === "none")
                wrap.style.display = "block";
              if (progressInfo && progressInfo.style.display === "none") {
                progressInfo.style.display = "flex";
                progressInfo.style.justifyContent = "space-between";
              }

              const total = st.totalBytes || 0;
              const read = st.bytesRead || 0;
              let pct =
                total > 0 ? Math.floor((read / total) * 100) : read ? 1 : 0;
              if (pct > 100) pct = 100;
              if (pct < 0) pct = 0;

              // Update bar and percentage
              if (bar) bar.style.width = pct + "%";
              if (percent) percent.textContent = pct + "%";

              // Format file sizes (only if we have size data)
              if (downloadSize) {
                if (total > 0) {
                  const formatBytes = (bytes) => {
                    if (bytes === 0) return "0 B";
                    const k = 1024;
                    const sizes = ["B", "KB", "MB", "GB"];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return (
                      Math.round((bytes / Math.pow(k, i)) * 100) / 100 +
                      " " +
                      sizes[i]
                    );
                  };
                  downloadSize.textContent =
                    formatBytes(read) + " / " + formatBytes(total);
                } else {
                  downloadSize.textContent = "";
                }
              }
              // Show Cancel button during download
              const cancelBtn = overlay
                ? overlay.querySelector(".PieTools-cancel-btn")
                : null;
              if (cancelBtn && st.status === "downloading")
                cancelBtn.style.display = "";
            }

            if (["checking content", "done"].includes(st.status)) {
              // Update popup if visible
              if (title) title.textContent = t("common.appName", "PieTools");
              if (bar) bar.style.width = "100%";
              if (percent) percent.textContent = "100%";

              // hide progress visuals after a short beat
              if (wrap || progressInfo) {
                setTimeout(function () {
                  if (wrap) wrap.style.display = "none";
                  if (progressInfo) progressInfo.style.display = "none";
                }, 300);
              }

              // Hide Cancel button
              const cancelBtn = overlay
                ? overlay.querySelector(".PieTools-cancel-btn")
                : null;
              if (cancelBtn) cancelBtn.style.display = "none";
            }

            if (st.status === "done") {
              // Update popup if visible
              if (overlay) {
                const doneColors = getThemeColors();
                // Hide API list for clean look
                const apiList = overlay.querySelector(".PieTools-api-list");
                if (apiList) apiList.style.display = "none";
                // Hide progress
                if (wrap) wrap.style.display = "none";
                if (progressInfo) progressInfo.style.display = "none";
                // Hide cancel
                const cancelBtn = overlay.querySelector(".PieTools-cancel-btn");
                if (cancelBtn) cancelBtn.style.display = "none";

                // Update title with success icon
                if (title) {
                  title.innerHTML = "";
                  title.style.cssText = `display:flex;align-items:center;justify-content:center;gap:10px;font-size:20px;color:${doneColors.text};margin-bottom:12px;font-weight:600;`;
                  const checkIcon = document.createElement("i");
                  checkIcon.className = "fa-solid fa-circle-check";
                  checkIcon.style.cssText = `color:${doneColors.accent};font-size:24px;`;
                  const checkText = document.createElement("span");
                  checkText.textContent = lt("Game Added!");
                  title.appendChild(checkIcon);
                  title.appendChild(checkText);
                }

                // Build status content
                if (status) {
                  const result = st.contentCheckResult;
                  status.style.textAlign = "center";

                  if (!result) {
                    status.innerText = lt(
                      "The game has been added successfully.",
                    );
                  } else {
                    const status_content = [
                      lt("Content details =>"),
                      `\u00A0\u00A0â€¢ ${lt("Workshop: ")}${lt(result.workshop)}`,
                    ];
                    if (
                      result.dlc.missing.length ||
                      result.dlc.included.length
                    ) {
                      status_content.push(`\u00A0\u00A0â€¢ ${lt("Dlc: ")}`);
                      if (result.dlc.included.length > 0) {
                        status_content.push(
                          `\u00A0\u00A0\u00A0\u00A0â—¦ ${lt("Included")}: ${result.dlc.included.length}`,
                        );
                      }
                      if (result.dlc.missing.length > 0) {
                        const missingLinks = result.dlc.missing
                          .map(
                            (id) =>
                              `<a href="#" class="lt-dlc-link" data-dlc-id="${id}" style="color:#67c1f5;text-decoration:underline;cursor:pointer;">${id}</a>`,
                          )
                          .join(", ");
                        status_content.push(
                          `\u00A0\u00A0\u00A0\u00A0â—¦ ${lt("Missing")}: ${result.dlc.missing.length} (${missingLinks})`,
                        );
                      }
                    }
                    status.style.whiteSpace = "pre-line";
                    status.innerHTML = status_content.join("\n");
                    status
                      .querySelectorAll(".lt-dlc-link")
                      .forEach(function (link) {
                        link.addEventListener("click", function (e) {
                          e.preventDefault();
                          try {
                            Millennium.callServerMethod(
                              "PieTools",
                              "OpenExternalUrl",
                              {
                                url:
                                  "https://steamdb.info/app/" +
                                  link.dataset.dlcId +
                                  "/",
                                contentScriptQuery: "",
                              },
                            );
                          } catch (_) { }
                        });
                      });
                  }
                }

                // Update Hide button to styled Close
                const hideBtn = overlay.querySelector(".PieTools-hide-btn");
                if (hideBtn) {
                  hideBtn.className = "PieTools-btn primary PieTools-hide-btn";
                  hideBtn.style.cssText =
                    "min-width:140px;display:flex;align-items:center;justify-content:center;text-align:center;";
                  hideBtn.innerHTML =
                    '<i class="fa-solid fa-xmark" style="margin-right:6px;"></i><span>' +
                    lt("Close") +
                    "</span>";
                }
              }
              done = true;
              clearInterval(timer);
              runState.inProgress = false;
              runState.appid = null;
              // Remove button since game is added (works even if popup is hidden)
              const btnEl = document.querySelector(".PieTools-button");
              if (btnEl && btnEl.parentElement) {
                btnEl.parentElement.removeChild(btnEl);
              }
            }
            if (st.status === "failed") {
              // Mark all APIs as not found when failed (unless they have error status)
              if (overlay && !successfulApi) {
                const colors = getThemeColors();
                const apiItems = overlay.querySelectorAll(".PieTools-api-item");
                apiItems.forEach((item) => {
                  const apiName = item.getAttribute("data-api-name");
                  const apiStatus = item.querySelector(".PieTools-api-status");
                  if (!apiStatus) return;

                  // Skip if this API already has an error status
                  if (st.apiErrors && st.apiErrors[apiName]) {
                    const apiError = st.apiErrors[apiName];
                    item.style.background = `rgba(255, 0, 0, 0.15)`;
                    item.style.borderColor = "#ff5c5c";
                    if (apiError.type === "timeout") {
                      apiStatus.innerHTML = `<span style="color:#ff5c5c;">${lt("Error, Timed Out")}</span><i class="fa-solid fa-clock" style="color:#ff5c5c;"></i>`;
                    } else if (apiError.type === "error") {
                      const code = apiError.code ? String(apiError.code) : "";
                      apiStatus.innerHTML = `<span style="color:#ff5c5c;">${lt("Error, Code: {code}").replace("{code}", code)}</span><i class="fa-solid fa-exclamation-triangle" style="color:#ff5c5c;"></i>`;
                    }
                    return;
                  }

                  // Check if this API is still in "Waiting..." or "Checking..." state
                  const statusText = apiStatus.textContent || "";
                  if (
                    statusText.includes("Waiting") ||
                    statusText.includes("Esperando") ||
                    statusText.includes("Checking") ||
                    statusText.includes("Verificando")
                  ) {
                    item.style.background = `rgba(0,0,0,0.2)`;
                    item.style.borderColor = colors.borderRgba;
                    apiStatus.innerHTML = `<span style="color:${colors.textSecondary};">${lt("Not found")}</span><i class="fa-solid fa-xmark" style="color:${colors.textSecondary};"></i>`;
                  }
                });
              }

              // show error in the popup if visible
              if (status)
                status.textContent = lt("Failed: {error}").replace(
                  "{error}",
                  st.error || lt("Unknown error"),
                );
              // Hide Cancel button and update Hide to Close
              const cancelBtn = overlay
                ? overlay.querySelector(".PieTools-cancel-btn")
                : null;
              if (cancelBtn) cancelBtn.style.display = "none";
              const hideBtn = overlay
                ? overlay.querySelector(".PieTools-hide-btn")
                : null;
              if (hideBtn) {
                hideBtn.style.display = "flex";
                hideBtn.className = "PieTools-btn primary PieTools-hide-btn";
                hideBtn.innerHTML =
                  '<i class="fa-solid fa-xmark" style="margin-right:6px;"></i><span>' +
                  lt("Close") +
                  "</span>";
              }
              if (wrap) wrap.style.display = "none";
              if (progressInfo) progressInfo.style.display = "none";
              done = true;
              clearInterval(timer);
              runState.inProgress = false;
              runState.appid = null;

              if (onFailedCallback) {
                onFailedCallback(st.error || "Unknown error");
              }
            }
          } catch (_) { }
        });
      } catch (_) {
        clearInterval(timer);
      }
    }, 300);
  }

  // Also try after a delay to catch dynamically loaded content
  setTimeout(addPieToolsButton, 1000);
  setTimeout(addPieToolsButton, 3000);

  // Listen for URL changes (Steam uses pushState for navigation)
  let lastUrl = window.location.href;

  function checkUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // URL changed - reset flags and update buttons
      window.__PieToolsButtonInserted = false;
      window.__PieToolsRestartInserted = false;
      window.__PieToolsIconInserted = false;
      window.__PieToolsHeaderInserted = false;

      window.__PieToolsPresenceCheckInFlight = false;
      window.__PieToolsPresenceCheckAppId = undefined;
      // Update translations and re-add buttons
      ensureTranslationsLoaded(false).then(function () {
        updateButtonTranslations();
        addPieToolsButton();
      });
    }
  }
  // Check URL changes periodically and on popstate
  // Reduced frequency to avoid blocking gamepad input
  setInterval(checkUrlChange, 2000); // Changed from 500ms to 2000ms (2 seconds)
  window.addEventListener("popstate", checkUrlChange);
  // Override pushState/replaceState to detect navigation
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function () {
    originalPushState.apply(history, arguments);
    setTimeout(checkUrlChange, 100);
  };
  history.replaceState = function () {
    originalReplaceState.apply(history, arguments);
    setTimeout(checkUrlChange, 100);
  };

  // Pre-fetch settings quietly to ensure background values (like fastDownload) are populated immediately,
  // and apply themes immediately once settings load.
  function bootSettings() {
    if (typeof Millennium === "undefined" || typeof Millennium.callServerMethod !== "function") {
      setTimeout(bootSettings, 200);
      return;
    }
    loadThemes().then(function () {
      return fetchSettingsConfig();
    }).then(function () {
      if (typeof ensurePieToolsStyles === "function") ensurePieToolsStyles();
    }).catch(function (e) {
      try { backendLog("PieTools: Boot sequence failed: " + String(e)); } catch (_) { }
    });
  }
  bootSettings();

  // Use MutationObserver to catch dynamically added content
  // Heavily optimized and throttled version to avoid blocking gamepad
  if (typeof MutationObserver !== "undefined") {
    let mutationTimeout;
    let lastMutationProcessTime = 0;
    const MUTATION_THROTTLE = 1000; // Only process once per second

    const observer = new MutationObserver(function (mutations) {
      // Additional throttle on top of debounce
      const now = Date.now();
      if (now - lastMutationProcessTime < MUTATION_THROTTLE) {
        return; // Skip if processed recently
      }

      // Debounce mutations to avoid blocking the UI
      clearTimeout(mutationTimeout);
      mutationTimeout = setTimeout(function () {
        lastMutationProcessTime = Date.now();

        let shouldUpdate = false;
        // Quick check: only process first 10 mutations to avoid long loops
        const mutationsToCheck = Math.min(mutations.length, 10);

        for (let i = 0; i < mutationsToCheck; i++) {
          const mutation = mutations[i];
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            // Only check first 3 added nodes to avoid blocking
            const nodesToCheck = Math.min(mutation.addedNodes.length, 3);

            for (let j = 0; j < nodesToCheck; j++) {
              const node = mutation.addedNodes[j];
              if (node.nodeType === 1) {
                // Element node
                // Quick class check without querySelector (faster)
                if (
                  node.classList &&
                  (node.classList.contains("steamdb-buttons") ||
                    node.classList.contains("apphub_OtherSiteInfo") ||
                    node.id === "queueBtnFollow")
                ) {
                  shouldUpdate = true;
                  break;
                }
              }
            }
          }
          if (shouldUpdate) break;
        }

        if (shouldUpdate) {
          updateButtonTranslations();
          addPieToolsButton();
        }
      }, 300); // Increased debounce to 300ms
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function showLoadedAppsPopup(apps) {
    // Avoid duplicates
    if (document.querySelector(".PieTools-loadedapps-overlay")) return;
    ensureFontAwesome();
    ensurePieToolsStyles();
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out;";
    overlay.className = "PieTools-loadedapps-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out;";
    overlay.className = "PieTools-loadedapps-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;";
    const modal = document.createElement("div");
    const loadedAppsModalColors = getThemeColors();
    modal.style.cssText = `background:${loadedAppsModalColors.modalBg};color:${loadedAppsModalColors.text};border:2px solid ${loadedAppsModalColors.border};border-radius:8px;width:560px;padding:28px 32px;box-shadow:0 20px 60px rgba(0,0,0,.8), 0 0 0 1px ${loadedAppsModalColors.shadowRgba};animation:slideUp 0.1s ease-out;`;
    const title = document.createElement("div");
    const loadedAppsTitleColors = getThemeColors();
    title.style.cssText = `font-size:24px;color:${loadedAppsTitleColors.text};margin-bottom:20px;font-weight:700;text-shadow:0 2px 8px ${loadedAppsTitleColors.shadow};background:${loadedAppsTitleColors.gradientLight};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-align:center;`;
    title.textContent = lt("PieTools Â· Added Games");
    const body = document.createElement("div");
    const loadedAppsBodyColors = getThemeColors();
    body.style.cssText = `font-size:14px;line-height:1.8;margin-bottom:16px;max-height:320px;overflow:auto;padding:16px;border:1px solid ${loadedAppsBodyColors.border};border-radius:12px;background:${loadedAppsBodyColors.bgContainer};`;
    if (apps && apps.length) {
      const list = document.createElement("div");
      apps.forEach(function (item) {
        const a = document.createElement("a");
        a.href = "steam://install/" + String(item.appid);
        a.textContent = String(item.name || item.appid);
        const linkColors = getThemeColors();
        a.style.cssText = `display:block;color:${linkColors.textSecondary};text-decoration:none;padding:10px 16px;margin-bottom:8px;background:rgba(${linkColors.rgbString},0.08);border:1px solid rgba(${linkColors.rgbString},0.2);border-radius:4px;transition:all 0.3s ease;`;
        a.onmouseover = function () {
          const c = getThemeColors();
          this.style.background = `rgba(${c.rgbString},0.2)`;
          this.style.borderColor = c.accent;
          this.style.transform = "translateX(4px)";
          this.style.color = c.text;
        };
        a.onmouseout = function () {
          const c = getThemeColors();
          this.style.background = `rgba(${c.rgbString},0.08)`;
          this.style.borderColor = `rgba(${c.rgbString},0.2)`;
          this.style.transform = "translateX(0)";
          this.style.color = c.textSecondary;
        };
        a.onclick = function (e) {
          e.preventDefault();
          try {
            window.location.href = a.href;
          } catch (_) { }
        };
        a.oncontextmenu = function (e) {
          e.preventDefault();
          const url = "https://steamdb.info/app/" + String(item.appid) + "/";
          try {
            Millennium.callServerMethod("PieTools", "OpenExternalUrl", {
              url,
              contentScriptQuery: "",
            });
          } catch (_) { }
        };
        list.appendChild(a);
      });
      body.appendChild(list);
    } else {
      body.style.textAlign = "center";
      body.textContent = lt("No games found.");
    }
    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "margin-top:16px;display:flex;gap:8px;justify-content:space-between;align-items:center;";
    const instructionText = document.createElement("div");
    instructionText.style.cssText = "font-size:12px;color:#8f98a0;";
    instructionText.textContent = lt(
      "Left click to install, Right click for SteamDB",
    );
    const dismissBtn = document.createElement("a");
    dismissBtn.className = "PieTools-btn";
    dismissBtn.innerHTML = "<span>" + lt("Dismiss") + "</span>";
    dismissBtn.href = "#";
    dismissBtn.onclick = function (e) {
      e.preventDefault();
      try {
        Millennium.callServerMethod("PieTools", "DismissLoadedApps", {
          contentScriptQuery: "",
        });
      } catch (_) { }
      try {
        sessionStorage.setItem("PieToolsLoadedAppsShown", "1");
      } catch (_) { }
      overlay.remove();
    };
    btnRow.appendChild(instructionText);
    btnRow.appendChild(dismissBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    // Re-scan elements for gamepad navigation
    setTimeout(function () {
      if (window.GamepadNav) {
        window.GamepadNav.scanElements();
      }
    }, 150);
  }

  // ============================================
  // PieTools UNLOCK PROGRESS OVERLAY
  // Must be inside IIFE to access ensurePieToolsStyles and other helpers
  // ============================================
  function showPieToolsUnlockProgress(appid) {
    if (document.querySelector(".pietools-progress-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();

    const steamPieJokes = [
      "Manifest downloaded and configured successfully!",
      "Game manifest installed. Ready to play!",
      "Game added to your Steam library successfully."
    ];




    const steamPieNotFoundErrors = [
      "Manifest files are not yet available for this AppID on the server.",
      "The requested game could not be found in the manifest repository.",
      "No manifest package is currently available for this AppID."
    ];

    const steamPieQuotaErrors = [
      "Daily limit reached. Please try again tomorrow.",
      "You have reached your daily download quota limit.",
      "Download limit reached for today. Resets at midnight."
    ];

    const overlay = document.createElement("div");
    overlay.className = "pietools-progress-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    modal.style.cssText = "background:#1a1a2e;color:#e0e0e0;border:1px solid rgba(49, 208, 252,0.35);border-radius:16px;width:480px;padding:28px 32px;box-shadow:0 24px 80px rgba(0,0,0,0.65),0 0 24px rgba(49, 208, 252,0.15);";

    const title = document.createElement("div");
    title.style.cssText = "font-size:20px;color:#31D0FC;margin-bottom:8px;font-weight:700;display:flex;align-items:center;gap:10px;";
    title.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> PieTools Unlocker';

    const subtitle = document.createElement("div");
    subtitle.style.cssText = "font-size:13px;color:#aaa;margin-bottom:20px;";
    subtitle.textContent = "AppID: " + appid + " — Fetching game manifest package...";

    const progressWrap = document.createElement("div");
    progressWrap.style.cssText = "background:#0d0d1a;border-radius:8px;height:8px;overflow:hidden;margin-bottom:16px;";
    const progressBar = document.createElement("div");
    progressBar.style.cssText = "height:100%;width:0%;background:linear-gradient(90deg,#0E43F4,#31D0FC);transition:width 0.3s ease;";
    progressWrap.appendChild(progressBar);

    const statusText = document.createElement("div");
    statusText.style.cssText = "font-size:13px;color:#888;margin-bottom:20px;";
    statusText.textContent = "Connecting to server to download manifest...";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;align-items:center;";

    const cuteDonateBtn = document.createElement("button");
    cuteDonateBtn.innerHTML = '<i class="fa-solid fa-heart" style="color:#0E43F4;"></i> <span style="font-size:12px;">Unlock Limit</span>';
    cuteDonateBtn.style.cssText = "margin-right:auto; padding:6px 12px; background:rgba(49, 208, 252,0.1); border:1px solid rgba(49, 208, 252,0.3); border-radius:12px; color:#31D0FC; font-weight:600; cursor:pointer; transition:all 0.2s ease; display:none; align-items:center; gap:6px;";
    cuteDonateBtn.onmouseover = function() {
        this.style.background = "rgba(49, 208, 252,0.2)";
        this.style.transform = "scale(1.05)";
    };
    cuteDonateBtn.onmouseout = function() {
        this.style.background = "rgba(49, 208, 252,0.1)";
        this.style.transform = "scale(1)";
    };
    // It will trigger the premium QR logic when clicked
    cuteDonateBtn.onclick = function() {
        if (premiumBtn.onclick) premiumBtn.onclick();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = "display:none;padding:8px 20px;background:rgba(49, 208, 252,0.15);border:1px solid #31D0FC;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;transition:all 0.2s ease;";

    const premiumBtn = document.createElement("button");
    premiumBtn.textContent = "Donate & Upgrade";
    premiumBtn.style.cssText = "display:none;padding:8px 20px;background:linear-gradient(135deg,#0E43F4,#31D0FC);border:none;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 12px rgba(49, 208, 252,0.3);";

    const counterText = document.createElement("div");
    counterText.style.cssText = "font-size:12px;color:#31D0FC;font-weight:700;margin-bottom:14px;padding:6px 10px;background:rgba(49, 208, 252,0.08);border:1px solid rgba(49, 208, 252,0.25);border-radius:6px;display:flex;align-items:center;gap:6px;";

    const counterSpan = document.createElement("span");
    counterSpan.style.flex = "1";

    const infoIcon = document.createElement("i");
    infoIcon.className = "fa-solid fa-circle-info";
    infoIcon.style.cssText = "cursor:pointer;font-size:14px;color:#31D0FC;transition:all 0.2s ease;";
    infoIcon.title = "View Limit Information";
    infoIcon.onmouseover = function () { this.style.color = "#fff"; this.style.transform = "scale(1.1)"; };
    infoIcon.onmouseout = function () { this.style.color = "#31D0FC"; this.style.transform = "scale(1)"; };
    infoIcon.onclick = function (e) {
      e.stopPropagation();
      showQuotaInfoModal();
    };

    counterText.appendChild(counterSpan);
    counterText.appendChild(infoIcon);

    // Show immediately from local client-side cache (so user always sees it)
    var _lsKey = "sd_usage_v2";
    var _lsTimeKey = "sd_usage_time_v2";
    var _lsLimitKey = "sd_usage_limit_v2";
    var _localCount = 0;
    var _localLimit = parseInt(localStorage.getItem(_lsLimitKey) || "20", 10);
    var _lastTime = parseInt(localStorage.getItem(_lsTimeKey) || "0", 10);
    if (Date.now() - _lastTime < 24 * 60 * 60 * 1000) {
      _localCount = parseInt(localStorage.getItem(_lsKey) || "0", 10);
    }

    // Fetch latest usage stats from Lua on modal open to sync limit properly
    if (typeof Millennium !== "undefined" && Millennium.callServerMethod) {
      Millennium.callServerMethod("PieTools", "GetUsageStats").then((res) => {
        try {
          var p = typeof res === "string" ? JSON.parse(res) : res;
          if (p && p.limit) {
            _localLimit = parseInt(p.limit, 10);
            localStorage.setItem(_lsLimitKey, _localLimit);
          }
          if (p && p.count !== undefined) {
            _localCount = parseInt(p.count, 10);
            localStorage.setItem(_lsKey, _localCount);
          }
          if (p && p.timestamp) localStorage.setItem(_lsTimeKey, parseInt(p.timestamp, 10) * 1000);
          _updateCounter(_localCount);
        } catch (e) { }
      });
    }

    function _updateCounter(n, limit) {
      if (!limit) limit = _localLimit;
      if (limit > 20 && localStorage.getItem("sd_premium_thanked") !== "1") {
        showPremiumThanksModal();
      }

      if (n >= limit) {
        counterText.style.borderColor = "rgba(255,80,80,0.5)";
        counterText.style.background = "rgba(255,80,80,0.08)";
        counterText.style.color = "#ff6b6b";
        infoIcon.style.color = "#ff6b6b";
        counterSpan.innerHTML = '🚫 Daily Quota: <strong style="margin-left:4px;">' + n + ' / ' + limit + ' (MAXED)</strong>';
      } else {
        counterText.style.borderColor = "rgba(49, 208, 252,0.25)";
        counterText.style.background = "rgba(49, 208, 252,0.08)";
        counterText.style.color = "#31D0FC";
        infoIcon.style.color = "#31D0FC";
        if (limit > 20) {
          counterSpan.innerHTML = '👑 Premium Quota: <strong style="color:#fff;margin-left:4px;">' + n + ' / ' + limit + '</strong>';
        } else {
          counterSpan.innerHTML = '🎯 Daily Quota: <strong style="color:#fff;margin-left:4px;">' + n + ' / ' + limit + '</strong>';
        }
      }
    }

    function showPremiumThanksModal() {
      if (document.querySelector(".pietools-thanks-overlay")) return;

      const thankOverlay = document.createElement("div");
      thankOverlay.className = "pietools-thanks-overlay";
      thankOverlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(15px);z-index:999999;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.5s ease-out;";

      const thankBox = document.createElement("div");
      thankBox.style.cssText = "background:rgba(20,20,30,0.7);border:1px solid rgba(49, 208, 252,0.4);border-radius:16px;padding:45px 35px;width:440px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6), inset 0 0 25px rgba(49, 208, 252,0.05);transform:translateY(25px) scale(0.92);transition:all 0.5s cubic-bezier(0.19, 1, 0.22, 1);display:flex;flex-direction:column;align-items:center;position:relative;overflow:hidden;";

      const glow = document.createElement("div");
      glow.style.cssText = "position:absolute;top:-80px;left:50%;transform:translateX(-50%);width:250px;height:250px;background:radial-gradient(circle, rgba(49, 208, 252,0.15) 0%, rgba(49, 208, 252,0) 70%);border-radius:50%;pointer-events:none;";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-crown";
      icon.style.cssText = "font-size:56px;background:linear-gradient(135deg, #0E43F4, #31D0FC);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:20px;filter:drop-shadow(0 4px 15px rgba(49, 208, 252,0.4));z-index:1;";

      const title = document.createElement("div");
      title.textContent = "Payment Confirmed!";
      title.style.cssText = "color:#fff;font-size:28px;font-weight:900;margin-bottom:12px;font-family:'Inter',sans-serif;letter-spacing:0.5px;text-shadow:0 0 20px rgba(255,255,255,0.2);z-index:1;";

      const desc = document.createElement("div");
      desc.innerHTML = "Your quota has been upgraded to <b style='color:#31D0FC;'>Premium</b>.<br>Your daily limit is now <b style='color:#fff;text-shadow:0 0 5px rgba(255,255,255,0.3);'>100</b>.<br><br><span style='color:#8b9bb4;font-size:13px;letter-spacing:0.3px;'>Welcome to the high life, pie.</span>";
      desc.style.cssText = "color:#cbd5e1;font-size:15px;line-height:1.6;font-family:'Inter',sans-serif;margin-bottom:32px;z-index:1;";

      const btn = document.createElement("button");
      btn.textContent = "LET'S GO";
      btn.style.cssText = "background:linear-gradient(135deg, #0E43F4, #31D0FC);color:#fff;border:none;border-radius:8px;padding:14px 45px;font-size:14px;font-weight:800;cursor:pointer;transition:all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);box-shadow:0 4px 20px rgba(49, 208, 252,0.3);letter-spacing:1px;z-index:1;";

      btn.onmouseover = function () { this.style.transform = "scale(1.06) translateY(-2px)"; this.style.boxShadow = "0 8px 25px rgba(49, 208, 252,0.5)"; };
      btn.onmouseout = function () { this.style.transform = "scale(1) translateY(0)"; this.style.boxShadow = "0 4px 20px rgba(49, 208, 252,0.3)"; };
      btn.onclick = function () {
        thankOverlay.style.opacity = "0";
        thankBox.style.transform = "translateY(20px) scale(0.95)";
        setTimeout(() => thankOverlay.remove(), 400);
        localStorage.setItem("sd_premium_thanked", "1");
      };

      thankBox.appendChild(glow);
      thankBox.appendChild(icon);
      thankBox.appendChild(title);
      thankBox.appendChild(desc);
      thankBox.appendChild(btn);
      thankOverlay.appendChild(thankBox);
      document.body.appendChild(thankOverlay);

      setTimeout(() => {
        thankOverlay.style.opacity = "1";
        thankBox.style.transform = "translateY(0) scale(1)";
      }, 50);
    }

    _updateCounter(_localCount);

    function showQuotaInfoModal() {
      const infoOverlay = document.createElement("div");
      infoOverlay.className = "pietools-info-overlay";
      infoOverlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:100000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s ease-out;";

      const infoModal = document.createElement("div");
      infoModal.style.cssText = "background:#1a1a2e;color:#e0e0e0;border:1px solid rgba(49, 208, 252,0.35);border-radius:12px;width:520px;padding:32px;box-shadow:0 24px 80px rgba(0,0,0,0.8),0 0 24px rgba(49, 208, 252,0.1);transform:translateY(20px);transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1);display:flex;flex-direction:column;";

      const infoTitle = document.createElement("div");
      infoTitle.style.cssText = "font-size:22px;color:#31D0FC;margin-bottom:16px;font-weight:700;display:flex;align-items:center;gap:10px;";
      infoTitle.innerHTML = '<i class="fa-solid fa-circle-info"></i> Notice Regarding Usage Limits';

      const infoBody1 = document.createElement("p");
      infoBody1.style.cssText = "font-size:14px;line-height:1.6;color:#ccc;margin-bottom:16px;margin-top:0;";
      infoBody1.textContent = "It pains us to impose a strict 20-unlock daily limit, but our hand has been forced. Recently, our backend has been under siege by parasites, malicious actors running automated scripts to aggressively scrape and steal our database.";

      const infoBody2 = document.createElement("p");
      infoBody2.style.cssText = "font-size:14px;line-height:1.6;color:#ccc;margin-bottom:16px;margin-top:0;";
      infoBody2.textContent = "We hate that their selfish exploitation punishes our genuine users as well. But we refuse to let this project bleed out. We all saw the tragic collapse of PieTools when they ignored this exact kind of abuse; we will not let our scene suffer that same dark fate.";

      const infoBody3 = document.createElement("p");
      infoBody3.style.cssText = "font-size:14px;line-height:1.6;color:#ccc;margin-bottom:24px;margin-top:0;";
      infoBody3.textContent = "This restriction is our shield. It is the necessary price to protect our infrastructure and ensure this platform survives for the community that actually respects it.";

      const infoBtnRow = document.createElement("div");
      infoBtnRow.style.cssText = "display:flex;justify-content:flex-end;gap:12px;";

      const infoCloseBtn = document.createElement("button");
      infoCloseBtn.textContent = "Close";
      infoCloseBtn.style.cssText = "padding:6px 16px;background:rgba(49, 208, 252,0.1);border:1px solid rgba(49, 208, 252,0.4);border-radius:20px;color:#31D0FC;font-weight:600;font-size:13px;cursor:pointer;transition:all 0.2s ease;";
      infoCloseBtn.onmouseover = function () { this.style.background = "rgba(49, 208, 252,0.2)"; };
      infoCloseBtn.onmouseout = function () { this.style.background = "rgba(49, 208, 252,0.1)"; };

      const infoPremiumBtn = document.createElement("button");
      infoPremiumBtn.innerHTML = '<i class="fa-solid fa-heart"></i> Donate & Upgrade Limit';
      infoPremiumBtn.style.cssText = "padding:6px 16px;background:linear-gradient(135deg,#0E43F4,#31D0FC);border:none;border-radius:20px;color:#fff;font-weight:600;font-size:13px;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 12px rgba(49, 208, 252,0.3);display:flex;align-items:center;gap:6px;";
      infoPremiumBtn.onmouseover = function () { this.style.transform = "scale(1.05)"; this.style.boxShadow = "0 6px 16px rgba(49, 208, 252,0.5)"; };
      infoPremiumBtn.onmouseout = function () { this.style.transform = "scale(1)"; this.style.boxShadow = "0 4px 12px rgba(49, 208, 252,0.3)"; };

      infoCloseBtn.onclick = function () {
        infoOverlay.style.opacity = "0";
        infoModal.style.transform = "translateY(20px)";
        setTimeout(() => infoOverlay.remove(), 300);
      };

      infoPremiumBtn.onclick = function () {
        infoOverlay.remove();
        if (typeof premiumBtn !== 'undefined' && premiumBtn.onclick) {
          premiumBtn.onclick();
        }
      };

      infoBtnRow.appendChild(infoCloseBtn);
      infoBtnRow.appendChild(infoPremiumBtn);
      infoModal.appendChild(infoTitle);
      infoModal.appendChild(infoBody1);
      infoModal.appendChild(infoBody2);
      infoModal.appendChild(infoBody3);
      infoModal.appendChild(infoBtnRow);
      infoOverlay.appendChild(infoModal);

      // close on backdrop click
      infoOverlay.onclick = function (e) {
        if (e.target === infoOverlay) infoCloseBtn.onclick();
      };

      document.body.appendChild(infoOverlay);

      // Trigger reflow for animation
      void infoOverlay.offsetWidth;
      infoOverlay.style.opacity = "1";
      infoModal.style.transform = "translateY(0)";
    }

    closeBtn.onclick = function () {
      overlay.remove();
      syncLeftStoreActionButtons(appid);
    };
    btnRow.appendChild(cuteDonateBtn);
    btnRow.appendChild(closeBtn);
    btnRow.appendChild(premiumBtn);

    // Premium QR Flow Logic
    premiumBtn.onclick = function () {
      premiumBtn.disabled = true;
      premiumBtn.textContent = "Generating...";

      Millennium.callServerMethod("PieTools", "GetPieToken").then(rawToken => {
        let tokenData = typeof rawToken === "string" ? JSON.parse(rawToken) : rawToken;
        let fetchHeaders = {};
        if (tokenData && tokenData.success && tokenData.token) {
          fetchHeaders["X-Pie-Token"] = tokenData.token;
        }

        fetch("https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/donate/init", { method: "POST", headers: fetchHeaders })
          .then(res => res.json())
          .then(data => {
            if (!data.success) throw new Error("Failed to init payment");

            // Replace modal content with QR
            modal.innerHTML = "";

            const qrTitle = document.createElement("div");
            qrTitle.style.cssText = "font-size:20px;color:#ff6b6b;margin-bottom:8px;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;";
            qrTitle.innerHTML = '<i class="fa-solid fa-heart" style="color:#0E43F4;"></i> Break my limits, Pie...';

            const qrSub = document.createElement("div");
            qrSub.style.cssText = "font-size:13.5px;color:#ccc;margin-bottom:20px;text-align:center;line-height:1.6;background:rgba(0,0,0,0.3);padding:16px;border-radius:8px;border:1px solid rgba(49, 208, 252,0.2);";
            qrSub.innerHTML = `People are continuously running automated scripts to steal our database and DDoS our servers, we are forced to enforce this strict daily limit to keep the project alive. We don't want to share the same fate as PieTools.<br><br>Help the project by donating exactly <strong>₹${data.amount.toFixed(2)}</strong> via any UPI app, and in return we will increase your limit to <strong style="color:#31D0FC;">${data.nextTier} downloads per day</strong> as a thank you.<br><br>This is totally consensual, and PieTools unlocks will always be free.`;

            const qrImg = document.createElement("img");
            qrImg.src = data.qrDataUrl;
            qrImg.style.cssText = "display:block;margin:0 auto 20px auto;border-radius:12px;border:2px solid #31D0FC;width:200px;height:200px;";

            const statusPoller = document.createElement("div");
            statusPoller.style.cssText = "text-align:center;color:#31D0FC;font-size:14px;font-weight:600;margin-bottom:20px;";
            statusPoller.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Waiting for payment confirmation...';

            const cancelBtnRow = document.createElement("div");
            cancelBtnRow.style.cssText = "display:flex;justify-content:center;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding:8px 24px;background:rgba(49, 208, 252,0.15);border:1px solid #31D0FC;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;";
            cancelBtnRow.appendChild(cancelBtn);

            modal.appendChild(qrTitle);
            modal.appendChild(qrSub);
            modal.appendChild(qrImg);
            modal.appendChild(statusPoller);
            modal.appendChild(cancelBtnRow);

            let polling = true;
            cancelBtn.onclick = function () {
              polling = false;
              overlay.remove();
            };

            // Start polling
            const checkStatus = () => {
              if (!polling) return;
              fetch("https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/donate/status", { headers: fetchHeaders })
                .then(res => res.json())
                .then(statusData => {
                  if (statusData.status === 'paid' && statusData.limit >= data.nextTier) {
                    polling = false;
                    statusPoller.style.color = "#4caf50";
                    statusPoller.innerHTML = '<i class="fa-solid fa-check-circle"></i> Payment Received! Premium Unlocked!';
                    cancelBtn.textContent = "Close";
                    
                    // trigger usage sync so the UI updates to 120 limit
                      if (Millennium && Millennium.callServerMethod) {
                        Millennium.callServerMethod("PieTools", "GetUsageStats").then((res) => {
                          if (typeof res === "string") {
                            try {
                              var p = JSON.parse(res);
                              if (p.limit) {
                                _localLimit = parseInt(p.limit, 10);
                                localStorage.setItem(_lsLimitKey, _localLimit);
                                _updateCounter(_localCount);
                              }
                            } catch (e) { }
                          }
                        });
                      }
                  } else {
                    setTimeout(checkStatus, 3000);
                  }
                }).catch(() => setTimeout(checkStatus, 3000));
            };
            checkStatus();

          })
          .catch(err => {
            premiumBtn.disabled = false;
            premiumBtn.textContent = "Donate & Upgrade";
            console.error("Payment init failed:", err);
            alert("Couldn't connect to PieTools servers to generate payment. Pie might be asleep (Server Error).");
          });
      }).catch(err => {
        premiumBtn.disabled = false;
        premiumBtn.textContent = "Donate & Upgrade";
        console.error("Token fetch failed:", err);
        alert("Couldn't read hardware token. Please restart Steam.");
      });
    };

    modal.appendChild(title);
    modal.appendChild(subtitle);
    modal.appendChild(counterText);
    modal.appendChild(progressWrap);
    modal.appendChild(statusText);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Fake progress animation
    let prog = 0;
    const timer = setInterval(function () {
      if (prog < 85) {
        prog += Math.random() * 15;
        if (prog > 85) prog = 85;
        progressBar.style.width = prog + "%";
      }
    }, 400);

    // Call Millennium Lua Backend
    if (typeof Millennium !== "undefined" && Millennium.callServerMethod) {
      // NOTE: GetUsageStats is NOT called here intentionally.
      // Calling it concurrently with DownloadManifest causes a race condition:
      // GetUsageStats resolves first (~100ms) and can overwrite the counter
      // with a stale or bidirectionally-corrected value, causing visible flicker.
      // DownloadManifest already returns the authoritative VPS count in its response.

      // Helper: detect if an error string indicates a network/connection failure
      const isNetworkError = function(errStr) {
          const s = (errStr || "").toLowerCase();
          return s.includes("connection_error") ||
                 s.includes("null-valued") ||
                 s.includes("httprequest") ||
                 s.includes("could not reach") ||
                 s.includes("check your internet") ||
                 s.includes("network") ||
                 s.includes("socketexception") ||
                 s.includes("webexception") ||
                 s.includes("timed out") ||
                 s.includes("timeout") ||
                 s.includes("one or more errors") ||
                 s.includes("no such host") ||
                 s.includes("actively refused") ||
                 s.includes("remotely closed") ||
                 s.includes("httpclient init failed");
      };

      const steamPieNetworkErrors = [
          "Connection failed. Please check your network connection and try again.",
          "Could not connect to the manifest server. Please verify your internet access.",
          "Network request timed out. Please try again."
      ];

      const handleCatch = function (err) {
          clearInterval(timer);
          progressBar.style.width = "100%";
          statusText.style.color = "#ff6b6b";
          const errStr = String(err || "");
          if (isNetworkError(errStr)) {
              const netErr = steamPieNetworkErrors[Math.floor(Math.random() * steamPieNetworkErrors.length)];
              statusText.textContent = netErr;
          } else {
              const randomError = steamPieNotFoundErrors[Math.floor(Math.random() * steamPieNotFoundErrors.length)];
              const cleanErr = errStr.replace(/\bsir\b/gi, "degenerate");
              statusText.textContent = randomError + " (Lua Error: " + cleanErr + ")";
          }
          closeBtn.style.display = "inline-block";
          cuteDonateBtn.style.display = "flex";
      };

      const handleResult = function (result) {
          let parsed = result;
          try {
            if (typeof result === "string") parsed = JSON.parse(result);
          } catch(e) {}
          
          if (parsed && (parsed.status === "started" || parsed.status === "running")) {
             setTimeout(() => {
                Millennium.callServerMethod("PieTools", "CheckManifestStatus", { appid: String(appid) })
                    .then(handleResult).catch(handleCatch);
             }, 1000);
             return;
          }

          clearInterval(timer);
          progressBar.style.width = "100%";
          let success = false;
          let errorMessage = "Unknown error from Lua backend.";
          let pieMode = false;
          let newCount = null;

          try {
            if (parsed && typeof parsed === "object") {
              success = parsed.success;
              errorMessage = parsed.error || errorMessage;
              pieMode = parsed.pie_mode;
              newCount = parsed.count;
              if (parsed.limit) {
                _localLimit = parseInt(parsed.limit, 10);
                localStorage.setItem(_lsLimitKey, _localLimit);
              }
              if (parsed.timestamp) localStorage.setItem(_lsTimeKey, parseInt(parsed.timestamp, 10) * 1000);
            } else {
              success = !!result;
            }
          } catch (e) {
            if (typeof result === "string" && result.toLowerCase().indexOf("error") === -1 && result.toLowerCase().indexOf("fail") === -1) {
              success = true;
            } else {
              errorMessage = typeof result === "string" ? result : "Invalid response format";
            }
          }

          // Update counter — use backend count if provided, else bump local count by 1
          if (newCount !== null && typeof newCount !== "undefined") {
            var n = parseInt(newCount, 10);
            localStorage.setItem(_lsKey, n);
            _updateCounter(n);
          } else if (success) {
            var bumped = _localCount + 1;
            localStorage.setItem(_lsKey, bumped);
            _updateCounter(bumped);
          }

          if (success) {
            statusText.style.color = "#4caf50";
            const randomJoke = steamPieJokes[Math.floor(Math.random() * steamPieJokes.length)];
            
            fetch("https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/instructions/" + appid)
              .then(function(r) { return r.json(); })
              .then(function(res) {
                let extraComment = "";
                if (res && res.ui_banner) {
                    extraComment = res.ui_banner;
                }

                statusText.innerHTML = randomJoke + (extraComment || "");
                closeBtn.style.display = "inline-block";
                cuteDonateBtn.style.display = "flex";
                syncLeftStoreActionButtons(appid);
            }).catch(function(err) {
                statusText.innerHTML = randomJoke;
                closeBtn.style.display = "inline-block";
                cuteDonateBtn.style.display = "flex";
            });
          } else {
            statusText.style.color = "#ff6b6b";
            let randomError;
            const errLower = (errorMessage || "").toLowerCase();
            if (isNetworkError(errLower)) {
              randomError = steamPieNetworkErrors[Math.floor(Math.random() * steamPieNetworkErrors.length)];
              statusText.textContent = randomError;
            } else if (errLower.includes("limit") || errLower.includes("quota")) {
              randomError = steamPieQuotaErrors[Math.floor(Math.random() * steamPieQuotaErrors.length)];
              const cleanErr = (errorMessage || "").replace(/\bsir\b/gi, "degenerate");
              statusText.textContent = randomError + " (" + cleanErr + ")";
              premiumBtn.style.display = "inline-block";
            } else if (errLower.includes("signature") || errLower.includes("payload")) {
              const cleanErr = (errorMessage || "").replace(/\bsir\b/gi, "degenerate");
              statusText.textContent = "Payload verification failed from server. (" + cleanErr + ")";
              premiumBtn.style.display = "inline-block";
            } else if (errLower.includes("not found") || errLower.includes("match") || errLower.includes("exist")) {
              randomError = steamPieNotFoundErrors[Math.floor(Math.random() * steamPieNotFoundErrors.length)];
              const cleanErr = (errorMessage || "").replace(/\bsir\b/gi, "degenerate");
              statusText.textContent = randomError + " (" + cleanErr + ")";
            } else {
              randomError = steamPieNotFoundErrors[Math.floor(Math.random() * steamPieNotFoundErrors.length)];
              const cleanErr = (errorMessage || "").replace(/\bsir\b/gi, "degenerate");
              statusText.textContent = randomError + " (" + cleanErr + ")";
            }
            closeBtn.style.display = "inline-block";
            cuteDonateBtn.style.display = "flex";
          }
      };

      Millennium.callServerMethod("PieTools", "DownloadManifest", { appid: String(appid) })
        .then(handleResult)
        .catch(handleCatch);
    } else {
      clearInterval(timer);
      progressBar.style.width = "100%";
      statusText.style.color = "#ff6b6b";
      statusText.textContent = "Millennium API not found. Are you running Steam via Millennium, you absolute bottom-feeder?";
      closeBtn.style.display = "inline-block";
      cuteDonateBtn.style.display = "flex";
    }
  }

  function showAchievementsPopup(appid) {
    if (document.querySelector(".PieTools-achievements-overlay")) return;

    ensurePieToolsStyles();
    ensureFontAwesome();

    const overlay = document.createElement("div");
    overlay.className = "PieTools-achievements-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;";

    const modal = document.createElement("div");
    const colors = getThemeColors();
    modal.style.cssText = `position:relative;background:${colors.modalBg};color:${colors.text};border:1px solid ${colors.border};border-radius:16px;width:760px;height:620px;max-height:90vh;display:flex;flex-direction:column;padding:24px 28px;box-shadow:0 24px 80px rgba(0,0,0,.65), 0 0 0 1px ${colors.shadowRgba};animation:slideUp 0.12s ease-out;`;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid ${colors.borderRgba};flex-shrink: 0;`;

    const title = document.createElement("div");
    title.style.cssText = `display:flex;align-items:center;gap:10px;font-size:22px;color:${colors.text};font-weight:600;`;
    const titleIcon = document.createElement("i");
    titleIcon.className = "fa-solid fa-trophy";
    titleIcon.style.cssText = `color:${colors.accent};font-size:20px;`;
    const titleText = document.createElement("span");
    titleText.textContent = t("menu.achievementsTitle", "Achievements Dashboard");
    title.appendChild(titleIcon);
    title.appendChild(titleText);

    const closeBtn = document.createElement("a");
    closeBtn.href = "#";
    closeBtn.style.cssText = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:rgba(${colors.rgbString},0.1);border:1px solid ${colors.borderRgba};border-radius:8px;color:${colors.accent};font-size:16px;text-decoration:none;transition:all 0.3s ease;cursor:pointer;`;
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.onclick = function (e) {
      e.preventDefault();
      overlay.remove();
    };

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Search and Status controls
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px;flex-shrink: 0;";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = t("menu.achievementsSearch", "Search achievements...");
    searchInput.style.cssText = `flex:1;background:rgba(0,0,0,0.3);border:1px solid ${colors.borderRgba};border-radius:8px;padding:8px 12px;color:#fff;font-size:14px;outline:none;transition:all 0.2s;`;
    searchInput.onfocus = function () { this.style.borderColor = colors.accent; };
    searchInput.onblur = function () { this.style.borderColor = colors.borderRgba; };

    const syncBtn = document.createElement("a");
    syncBtn.className = "PieTools-btn primary";
    syncBtn.style.cssText = "padding:8px 16px;font-size:13px;border-radius:8px;display:flex;align-items:center;gap:6px;";
    syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i><span>Sync</span>';

    controls.appendChild(searchInput);
    controls.appendChild(syncBtn);

    // Progress Bar
    const progressContainer = document.createElement("div");
    progressContainer.style.cssText = "margin-bottom:16px;flex-shrink: 0;";

    const progressLabel = document.createElement("div");
    progressLabel.style.cssText = `display:flex;justify-content:space-between;font-size:13px;color:${colors.textSecondary};margin-bottom:6px;font-weight:500;`;
    const progressText = document.createElement("span");
    progressText.textContent = "Loading achievements...";
    const progressPercent = document.createElement("span");
    progressPercent.textContent = "0%";
    progressLabel.appendChild(progressText);
    progressLabel.appendChild(progressPercent);

    const progressTrack = document.createElement("div");
    progressTrack.style.cssText = `background:rgba(0,0,0,0.3);height:10px;border-radius:5px;overflow:hidden;border:1px solid ${colors.borderRgba};`;
    const progressBar = document.createElement("div");
    progressBar.style.cssText = `height:100%;width:0%;background:${colors.gradient};transition:width 0.4s ease;`;
    progressTrack.appendChild(progressBar);

    progressContainer.appendChild(progressLabel);
    progressContainer.appendChild(progressTrack);

    // Scrollable Grid Area
    const gridWrapper = document.createElement("div");
    gridWrapper.style.cssText = "flex:1;overflow-y:auto;margin-bottom:16px;min-height:0;";

    const grid = document.createElement("div");
    grid.className = "PieTools-ach-grid";
    gridWrapper.appendChild(grid);

    modal.appendChild(header);
    modal.appendChild(controls);
    modal.appendChild(progressContainer);
    modal.appendChild(gridWrapper);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let achievementsData = [];

    function renderGrid(filterText) {
      grid.innerHTML = "";
      let total = achievementsData.length;
      let unlockedCount = 0;

      achievementsData.forEach(function (ach) {
        if (ach.unlocked) unlockedCount++;

        if (filterText) {
          const search = filterText.toLowerCase();
          const matchName = (ach.displayName || ach.name || "").toLowerCase().includes(search);
          const matchDesc = (ach.description || "").toLowerCase().includes(search);
          if (!matchName && !matchDesc) return;
        }

        const card = document.createElement("div");
        card.className = "PieTools-ach-card" + (ach.unlocked ? " unlocked" : "");

        // Icon
        const img = document.createElement("img");
        img.style.cssText = "width:48px;height:48px;border-radius:6px;object-fit:cover;flex-shrink:0;background:#0d0d1a;";
        if (ach.unlocked) {
          img.src = ach.icon || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2331D0FC'><path d='M18 2H6v2H2v3c0 3.24 2.46 5.92 5.63 6.4C8.42 15.42 10 17 10 17v3H7v2h10v-2h-3v-3s1.58-1.58 2.37-3.6C19.54 10.92 22 8.24 22 5V2h-4v2zM4 5h2v4.5C4.34 9.17 3 7.75 3 6V5zm15 4.5V5h2v1c0 1.75-1.34 3.17-3 3.5z'/></svg>";
        } else {
          img.src = ach.icon_gray || ach.icon || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23555'><path d='M18 2H6v2H2v3c0 3.24 2.46 5.92 5.63 6.4C8.42 15.42 10 17 10 17v3H7v2h10v-2h-3v-3s1.58-1.58 2.37-3.6C19.54 10.92 22 8.24 22 5V2h-4v2zM4 5h2v4.5C4.34 9.17 3 7.75 3 6V5zm15 4.5V5h2v1c0 1.75-1.34 3.17-3 3.5z'/></svg>";
          img.style.filter = "grayscale(100%) opacity(60%)";
        }
        img.onerror = function () {
          this.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2331D0FC'><path d='M18 2H6v2H2v3c0 3.24 2.46 5.92 5.63 6.4C8.42 15.42 10 17 10 17v3H7v2h10v-2h-3v-3s1.58-1.58 2.37-3.6C19.54 10.92 22 8.24 22 5V2h-4v2zM4 5h2v4.5C4.34 9.17 3 7.75 3 6V5zm15 4.5V5h2v1c0 1.75-1.34 3.17-3 3.5z'/></svg>";
        };

        const info = document.createElement("div");
        info.style.cssText = "display:flex;flex-direction:column;min-width:0;flex:1;";

        const nameText = document.createElement("div");
        nameText.style.cssText = "font-weight:600;font-size:14px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        nameText.textContent = ach.displayName || ach.name;

        const descText = document.createElement("div");
        descText.style.cssText = `font-size:11px;color:${colors.textSecondary};line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;`;
        descText.textContent = ach.description || "";

        info.appendChild(nameText);
        info.appendChild(descText);

        card.appendChild(img);
        card.appendChild(info);

        card.onclick = function () {
          const action = ach.unlocked ? "LockAchievement" : "UnlockAchievement";
          Millennium.callServerMethod("PieTools", action, { appid: appid, achievement_id: ach.name })
            .then(function (res) {
              try {
                const payload = typeof res === "string" ? JSON.parse(res) : res;
                if (payload && payload.success) {
                  loadSchema();
                }
              } catch (_) { }
            });
        };

        grid.appendChild(card);
      });

      // Update progress bar
      if (total > 0) {
        const pct = Math.round((unlockedCount / total) * 100);
        progressPercent.textContent = pct + "%";
        progressBar.style.width = pct + "%";
        progressText.textContent = t("menu.unlockedCount", "Unlocked: ") + unlockedCount + " / " + total;
      } else {
        progressPercent.textContent = "0%";
        progressBar.style.width = "0%";
        progressText.textContent = t("menu.noAchievements", "No achievements found.");
      }
    }

    function loadSchema() {
      progressBar.style.width = "30%";
      progressText.innerText = "Loading schema from Steam...";

      Millennium.callServerMethod("PieTools", "GetAchievementSchema", { appid: appid })
        .then(async function (res) {
          try {
            progressBar.style.width = "60%";
            progressText.innerText = "Processing schema data...";

            const payload = typeof res === "string" ? JSON.parse(res) : res;
            if (payload && payload.success) {
              if (payload.url) {
                progressBar.style.width = "90%";
                progressText.innerText = "Parsing massive JSON payload...";
                const r = await fetch(payload.url);
                const data = await r.json();
                achievementsData = data.achievements || data;
              } else if (payload.achievements) {
                achievementsData = payload.achievements;
              }

              progressBar.style.width = "100%";
              setTimeout(() => {
                progressContainer.style.display = "none";
                renderGrid(searchInput.value);
              }, 300);
            } else {
              throw new Error(payload ? payload.error : "Unknown error");
            }
          } catch (e) {
            console.error("PieTools schema parse error:", e, res);
            progressContainer.style.display = "none";
            content.innerHTML = `<div style="color:#ff4444; padding:20px;">Failed to load achievements. Error: ${e.message}</div>`;
          }
        })
        .catch(function (err) {
          progressContainer.style.display = "none";
          content.innerHTML = `<div style="color:#ff4444; padding:20px;">Failed to load achievements.</div>`;
        });
    }

    searchInput.oninput = function () {
      renderGrid(this.value);
    };

    syncBtn.onclick = function (e) {
      e.preventDefault();
      syncBtn.style.pointerEvents = "none";
      syncBtn.querySelector("i").style.animation = "spin 1s linear infinite";
      Millennium.callServerMethod("PieTools", "SyncAchievementsToSteam", { appid: appid })
        .then(function () {
          loadSchema();
        })
        .finally(function () {
          syncBtn.style.pointerEvents = "auto";
          syncBtn.querySelector("i").style.animation = "";
        });
    };



    // Load on init
    loadSchema();
  }

  function showAchievementToast(meta) {
    let container = document.querySelector(".PieTools-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "PieTools-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "PieTools-toast";

    const img = document.createElement("img");
    img.style.cssText = "width:50px;height:50px;border-radius:6px;object-fit:cover;flex-shrink:0;background:#0d0d1a;";
    img.src = meta.icon || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2331D0FC'><path d='M18 2H6v2H2v3c0 3.24 2.46 5.92 5.63 6.4C8.42 15.42 10 17 10 17v3H7v2h10v-2h-3v-3s1.58-1.58 2.37-3.6C19.54 10.92 22 8.24 22 5V2h-4v2zM4 5h2v4.5C4.34 9.17 3 7.75 3 6V5zm15 4.5V5h2v1c0 1.75-1.34 3.17-3 3.5z'/></svg>";
    img.onerror = function () {
      this.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2331D0FC'><path d='M18 2H6v2H2v3c0 3.24 2.46 5.92 5.63 6.4C8.42 15.42 10 17 10 17v3H7v2h10v-2h-3v-3s1.58-1.58 2.37-3.6C19.54 10.92 22 8.24 22 5V2h-4v2zM4 5h2v4.5C4.34 9.17 3 7.75 3 6V5zm15 4.5V5h2v1c0 1.75-1.34 3.17-3 3.5z'/></svg>";
    };

    const content = document.createElement("div");
    content.style.cssText = "display:flex;flex-direction:column;min-width:0;flex:1;";

    const badge = document.createElement("div");
    badge.style.cssText = "font-size:11px;color:#31D0FC;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;";
    badge.textContent = "Achievement Unlocked!";

    const titleText = document.createElement("div");
    titleText.style.cssText = "font-size:14px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    titleText.textContent = meta.displayName;

    const descText = document.createElement("div");
    descText.style.cssText = "font-size:11px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;";
    descText.textContent = meta.description || "";

    content.appendChild(badge);
    content.appendChild(titleText);
    if (meta.description) content.appendChild(descText);

    toast.appendChild(img);
    toast.appendChild(content);
    container.appendChild(toast);

    // Auto dismiss after 4 seconds
    setTimeout(function () {
      toast.classList.add("fade-out");
      toast.addEventListener("animationend", function () {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      });
    }, 4000);
  }

  function getCurrentAppId() {
    try {
      const match =
        window.location.href.match(
          /https:\/\/store\.steampowered\.com\/app\/(\d+)/,
        ) ||
        window.location.href.match(
          /https:\/\/steamcommunity\.com\/app\/(\d+)/,
        );
      return match ? String(match[1]) : (window.__PieToolsCurrentAppId || null);
    } catch (_) {
      return null;
    }
  }

  let activePoller = null;
  function startAchievementsPoller() {
    if (activePoller) return;
    activePoller = setInterval(function () {
      const appid = getCurrentAppId();
      if (!appid) return;

      if (
        typeof Millennium !== "undefined" &&
        typeof Millennium.callServerMethod === "function"
      ) {
        Millennium.callServerMethod("PieTools", "SyncAchievementsToSteam", { appid: appid })
          .then(function (res) {
            try {
              const payload = typeof res === "string" ? JSON.parse(res) : res;
              if (payload && payload.success && payload.synced && payload.synced.length > 0) {
                // Fetch schema first so we can show proper display names and icons in notifications
                Millennium.callServerMethod("PieTools", "GetAchievementSchema", { appid: appid })
                  .then(function (schemaRes) {
                    try {
                      const schemaPayload = typeof schemaRes === "string" ? JSON.parse(schemaRes) : schemaRes;
                      if (schemaPayload && schemaPayload.success && schemaPayload.achievements) {
                        payload.synced.forEach(function (achName) {
                          const meta = schemaPayload.achievements.find(function (a) { return a.name === achName; }) || {
                            displayName: achName,
                            description: "",
                            icon: ""
                          };
                          showAchievementToast(meta);
                        });
                      } else {
                        payload.synced.forEach(function (achName) {
                          showAchievementToast({ displayName: achName, description: "", icon: "" });
                        });
                      }
                    } catch (_) {
                      payload.synced.forEach(function (achName) {
                        showAchievementToast({ displayName: achName, description: "", icon: "" });
                      });
                    }
                  });
              }
            } catch (_) { }
          })
          .catch(function (_) { });
      }
    }, 5000);
  }








  function showPieToolsDonateModal() {
    const overlay = document.createElement("div");
    overlay.className = "PieTools-overlay pietools-donate-overlay";
    const overlayColors = getThemeColors();
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:999999;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.3s ease;`;

    const modal = document.createElement("div");
    modal.style.cssText = `background:rgba(${overlayColors.rgbString},0.7);border:1px solid ${overlayColors.borderRgba};border-radius:12px;padding:30px;width:450px;box-shadow:0 20px 40px rgba(0,0,0,0.5);transform:scale(0.95);transition:all 0.3s cubic-bezier(0.19, 1, 0.22, 1);`;

    const loadingText = document.createElement("div");
    loadingText.style.cssText = "font-size:16px;color:#fff;text-align:center;";
    loadingText.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;color:#31D0FC;"></i> Generating QR...';
    modal.appendChild(loadingText);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Trigger reflow
    void overlay.offsetWidth;
    overlay.style.opacity = "1"; 
    modal.style.transform = "scale(1)";

    Millennium.callServerMethod("PieTools", "GetPieToken").then(rawToken => {
        let tokenData = typeof rawToken === "string" ? JSON.parse(rawToken) : rawToken;
        let fetchHeaders = {};
        if (tokenData && tokenData.success && tokenData.token) {
            fetchHeaders["X-Pie-Token"] = tokenData.token;
        }

        fetch("https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/donate/init", { method: "POST", headers: fetchHeaders })
            .then(res => res.json())
            .then(data => {
                if (!data.success) throw new Error("Failed to init payment");
                modal.innerHTML = "";

                const qrTitle = document.createElement("div");
                qrTitle.style.cssText = "font-size:20px;color:#ff6b6b;margin-bottom:8px;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;";
                qrTitle.innerHTML = '<i class="fa-solid fa-heart" style="color:#0E43F4;"></i> Break my limits, Pie...';

                const qrSub = document.createElement("div");
                qrSub.style.cssText = "font-size:13.5px;color:#ccc;margin-bottom:20px;text-align:center;line-height:1.6;background:rgba(0,0,0,0.3);padding:16px;border-radius:8px;border:1px solid rgba(49, 208, 252,0.2);";
                qrSub.innerHTML = `People are continuously running automated scripts to steal our database and DDoS our servers, we are forced to enforce this strict daily limit to keep the project alive. We don't want to share the same fate as PieTools.<br><br>Help the project by donating exactly <strong>₹${data.amount.toFixed(2)}</strong> via any UPI app, and in return we will increase your limit to <strong style="color:#31D0FC;">${data.nextTier} downloads per day</strong> as a thank you.<br><br>This is totally consensual, and PieTools unlocks will always be free.`;

                const qrImg = document.createElement("img");
                qrImg.src = data.qrDataUrl;
                qrImg.style.cssText = "display:block;margin:0 auto 20px auto;border-radius:12px;border:2px solid #31D0FC;width:200px;height:200px;";

                const statusPoller = document.createElement("div");
                statusPoller.style.cssText = "text-align:center;color:#31D0FC;font-size:14px;font-weight:600;margin-bottom:20px;";
                statusPoller.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Waiting for payment confirmation...';

                const cancelBtnRow = document.createElement("div");
                cancelBtnRow.style.cssText = "display:flex;justify-content:center;";
                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "Close";
                cancelBtn.style.cssText = "padding:8px 24px;background:rgba(49, 208, 252,0.15);border:1px solid #31D0FC;border-radius:6px;color:#fff;font-weight:600;cursor:pointer;";
                cancelBtnRow.appendChild(cancelBtn);

                modal.appendChild(qrTitle);
                modal.appendChild(qrSub);
                modal.appendChild(qrImg);
                modal.appendChild(statusPoller);
                modal.appendChild(cancelBtnRow);

                let polling = true;
                cancelBtn.onclick = function () {
                    polling = false;
                    overlay.remove();
                };

                const checkStatus = () => {
                    if (!polling) return;
                    fetch("https://icy-recipe-de02.aadityachoudhary333.workers.dev/api/donate/status", { headers: fetchHeaders })
                        .then(res => res.json())
                        .then(statusData => {
                            if (statusData.status === 'paid' && statusData.limit >= data.nextTier) {
                                polling = false;
                                statusPoller.style.color = "#4caf50";
                                statusPoller.innerHTML = '<i class="fa-solid fa-check-circle"></i> Payment Received! Premium Unlocked!';
                                cancelBtn.textContent = "Close";
                            } else {
                                setTimeout(checkStatus, 3000);
                            }
                        }).catch(() => setTimeout(checkStatus, 3000));
                };
                checkStatus();
            })
            .catch(err => {
                modal.innerHTML = `<div style="color:#ff6b6b;text-align:center;">Failed to connect to PieTools servers.</div>`;
                setTimeout(() => overlay.remove(), 2000);
            });
    });
  }

})();
