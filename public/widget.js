/*!
 * Chatbot Forge — embeddable widget loader
 *
 * Usage (paste once, before </body>):
 *   <script src="https://your-domain.com/widget.js" data-bot-id="BOT_ID" defer></script>
 *
 * Options (all optional, as data-* attributes):
 *   data-position  "right" (default) | "left"
 *   data-open      "true" to start expanded
 *   data-label     tooltip / aria-label for the bubble
 *   data-width     panel width in px  (default 400)
 *   data-height    panel height in px (default 620)
 *   data-accent    override the accent colour, e.g. "#0ea5e9"
 *   data-offset    distance from the page edge in px (default 20)
 *   data-hide-on-mobile  "true" to hide below 480px
 *
 * The panel is an <iframe> pointed at /embed/BOT_ID, so nothing from this
 * script can read or restyle the host page, and nothing on the host page can
 * read the conversation.
 */
(function () {
  'use strict';

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf('widget.js') !== -1) return all[i];
      }
      return null;
    })();

  if (!script) return;

  var botId = script.getAttribute('data-bot-id');
  if (!botId) {
    console.error('[chatbot-forge] Missing data-bot-id on the widget script tag.');
    return;
  }
  if (document.getElementById('cf-widget-' + botId)) return; // already mounted

  var origin = (function () {
    try {
      return new URL(script.src, window.location.href).origin;
    } catch (e) {
      return '';
    }
  })();

  var opts = {
    position: script.getAttribute('data-position') === 'left' ? 'left' : 'right',
    open: script.getAttribute('data-open') === 'true',
    label: script.getAttribute('data-label') || 'Chat with us',
    width: parseInt(script.getAttribute('data-width'), 10) || 400,
    height: parseInt(script.getAttribute('data-height'), 10) || 620,
    accent: script.getAttribute('data-accent') || '#6366f1',
    offset: parseInt(script.getAttribute('data-offset'), 10) || 20,
    hideOnMobile: script.getAttribute('data-hide-on-mobile') === 'true',
    emoji: script.getAttribute('data-emoji') || '',
  };

  /* --- colour contrast (mirrors src/lib/contrast.ts) ------------------- */

  function toRgb(hex) {
    var c = String(hex).replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var n = parseInt(c.slice(0, 6), 16);
    return isNaN(n) ? [99, 102, 241] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(rgb) {
    var parts = rgb.map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }

  function ratio(rgb, isWhite) {
    var l = luminance(rgb);
    return isWhite ? 1.05 / (l + 0.05) : (l + 0.05) / 0.05;
  }

  function hex(rgb) {
    return (
      '#' +
      rgb
        .map(function (v) {
          var s = Math.round(Math.min(255, Math.max(0, v))).toString(16);
          return s.length === 1 ? '0' + s : s;
        })
        .join('')
    );
  }

  /**
   * The bubble accepts any accent, including pale ones where white icons
   * disappear. Picks the readable foreground and, if neither option clears
   * WCAG AA, nudges the background until one does.
   */
  function surface(accent) {
    var rgb = toRgb(accent);
    var useWhite = ratio(rgb, true) >= ratio(rgb, false);
    var fg = useWhite ? '#fff' : '#0f172a';
    if (ratio(rgb, useWhite) >= 4.5) return { bg: accent, fg: fg };

    for (var step = 1; step <= 20; step++) {
      var t = step * 0.04;
      var next = useWhite
        ? [rgb[0] * (1 - t), rgb[1] * (1 - t), rgb[2] * (1 - t)]
        : [rgb[0] + (255 - rgb[0]) * t, rgb[1] + (255 - rgb[1]) * t, rgb[2] + (255 - rgb[2]) * t];
      if (ratio(next, useWhite) >= 4.5) return { bg: hex(next), fg: fg };
    }
    return useWhite ? { bg: '#0f172a', fg: '#fff' } : { bg: '#fff', fg: '#0f172a' };
  }

  function paintBubble(accent) {
    var s = surface(accent);
    bubble.style.background = s.bg;
    bubble.style.color = s.fg;
  }

  var Z = 2147483000;
  var root = document.createElement('div');
  root.id = 'cf-widget-' + botId;
  root.setAttribute('data-chatbot-forge', '');

  var style = document.createElement('style');
  style.textContent = [
    '#' + root.id + ' *{box-sizing:border-box}',
    '#' + root.id + ' .cf-bubble{position:fixed;bottom:' + opts.offset + 'px;' + opts.position + ':' + opts.offset + 'px;',
    'width:58px;height:58px;border:0;border-radius:50%;cursor:pointer;z-index:' + Z + ';',
    'display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;line-height:1;',
    'box-shadow:0 8px 24px rgba(15,23,42,.28);transition:transform .18s ease, box-shadow .18s ease;',
    '-webkit-tap-highlight-color:transparent}',
    '#' + root.id + ' .cf-bubble:hover{transform:scale(1.06);box-shadow:0 12px 30px rgba(15,23,42,.34)}',
    '#' + root.id + ' .cf-bubble:focus-visible{outline:3px solid rgba(255,255,255,.7);outline-offset:2px}',
    '#' + root.id + ' .cf-bubble svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;',
    'stroke-linecap:round;stroke-linejoin:round}',
    '#' + root.id + ' .cf-panel{position:fixed;bottom:' + (opts.offset + 70) + 'px;' + opts.position + ':' + opts.offset + 'px;',
    'width:' + opts.width + 'px;height:' + opts.height + 'px;max-width:calc(100vw - ' + opts.offset * 2 + 'px);',
    'max-height:calc(100vh - ' + (opts.offset * 2 + 70) + 'px);border:0;border-radius:18px;overflow:hidden;',
    'background:#fff;z-index:' + Z + ';box-shadow:0 24px 60px rgba(15,23,42,.28);',
    'opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;',
    'transition:opacity .18s ease, transform .18s ease}',
    '#' + root.id + '.cf-open .cf-panel{opacity:1;transform:none;pointer-events:auto}',
    '#' + root.id + ' .cf-panel iframe{width:100%;height:100%;border:0;display:block}',
    '@media (max-width:480px){',
    '#' + root.id + ' .cf-panel{width:100vw;height:100vh;max-width:100vw;max-height:100vh;',
    'bottom:0;left:0;right:0;border-radius:0}',
    opts.hideOnMobile ? '#' + root.id + '{display:none}' : '',
    '}',
    '@media (prefers-reduced-motion:reduce){#' + root.id + ' .cf-bubble,#' + root.id + ' .cf-panel{transition:none}}',
  ].join('');

  var bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.className = 'cf-bubble';
  bubble.setAttribute('aria-label', opts.label);
  bubble.setAttribute('aria-expanded', 'false');
  bubble.title = opts.label;

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  bubble.innerHTML = opts.emoji || ICON_CHAT;
  paintBubble(opts.accent);

  var panel = document.createElement('div');
  panel.className = 'cf-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', opts.label);

  var iframe = null;
  function mountFrame() {
    if (iframe) return;
    iframe = document.createElement('iframe');
    iframe.src = origin + '/embed/' + encodeURIComponent(botId);
    iframe.title = opts.label;
    iframe.setAttribute('allow', 'clipboard-write');
    panel.appendChild(iframe);
  }

  var isOpen = false;
  function setOpen(next) {
    isOpen = next;
    if (next) mountFrame();
    root.classList.toggle('cf-open', next);
    bubble.setAttribute('aria-expanded', String(next));
    bubble.innerHTML = next ? ICON_CLOSE : opts.emoji || ICON_CHAT;
    bubble.title = next ? 'Close chat' : opts.label;
  }

  bubble.addEventListener('click', function () {
    setOpen(!isOpen);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      setOpen(false);
      bubble.focus();
    }
  });

  // Escape pressed while the visitor is typing inside the iframe: the chat
  // posts a message out, since its keydown never reaches this document.
  window.addEventListener('message', function (e) {
    if (origin && e.origin !== origin) return;
    var data = e.data;
    if (!data || data.source !== 'chatbot-forge') return;
    if (data.type === 'close' && isOpen) {
      setOpen(false);
      bubble.focus();
    }
  });

  root.appendChild(style);
  root.appendChild(panel);
  root.appendChild(bubble);

  function mount() {
    (document.body || document.documentElement).appendChild(root);
    if (opts.open) setOpen(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Pull the bot's real accent + avatar so the bubble matches the chat inside,
  // unless the host page pinned them via data attributes.
  if (origin && !script.getAttribute('data-accent')) {
    fetch(origin + '/api/bots/' + encodeURIComponent(botId) + '/public')
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j || !j.bot) return;
        if (j.bot.accent) paintBubble(j.bot.accent);
        if (!script.getAttribute('data-label') && j.bot.name) {
          bubble.title = 'Chat with ' + j.bot.name;
          bubble.setAttribute('aria-label', bubble.title);
          opts.label = bubble.title;
        }
      })
      .catch(function () {});
  }

  // Minimal public API: window.ChatbotForge.open() / .close() / .toggle()
  window.ChatbotForge = window.ChatbotForge || {
    open: function () {
      setOpen(true);
    },
    close: function () {
      setOpen(false);
    },
    toggle: function () {
      setOpen(!isOpen);
    },
  };
})();
