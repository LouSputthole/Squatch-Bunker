// Dev-only debug overlay: surfaces JS errors visually on the page.
// Loaded ONLY outside production (see app/layout.tsx). Uses textContent (never
// innerHTML) so error strings — which can contain user-influenced data — can
// never inject HTML.
(function () {
  function ensureDisplay() {
    var d = document.getElementById('__error_display');
    if (!d) {
      d = document.createElement('div');
      d.id = '__error_display';
      d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;padding:12px;font-family:monospace;font-size:13px;z-index:99999;max-height:40vh;overflow:auto;border-top:2px solid #ff0000';
      var hdr = document.createElement('b');
      hdr.textContent = 'JS ERRORS:';
      d.appendChild(hdr);
      document.body.appendChild(d);
    }
    return d;
  }

  function appendLine(text) {
    var d = ensureDisplay();
    d.appendChild(document.createElement('br'));
    var line = document.createElement('span');
    line.textContent = text;
    d.appendChild(line);
  }

  window.onerror = function (msg, url, line, col) {
    appendLine('[' + line + ':' + col + '] ' + msg);
    if (url) appendLine('  → ' + url.split('/').pop());
    return false;
  };

  window.addEventListener('unhandledrejection', function (e) {
    appendLine('Promise: ' + ((e.reason && e.reason.message) || e.reason || 'unknown'));
  });
})();
