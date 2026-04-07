// Catches any JS errors and shows them visually on the page
window.onerror = function(msg, url, line, col, err) {
  var d = document.getElementById('__error_display');
  if (!d) {
    d = document.createElement('div');
    d.id = '__error_display';
    d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;padding:12px;font-family:monospace;font-size:13px;z-index:99999;max-height:40vh;overflow:auto;border-top:2px solid #ff0000';
    d.innerHTML = '<b>JS ERRORS:</b><br>';
    document.body.appendChild(d);
  }
  d.innerHTML += '[' + line + ':' + col + '] ' + msg + '<br>';
  if (url) d.innerHTML += '  &rarr; ' + url.split('/').pop() + '<br>';
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  var d = document.getElementById('__error_display');
  if (!d) {
    d = document.createElement('div');
    d.id = '__error_display';
    d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;padding:12px;font-family:monospace;font-size:13px;z-index:99999;max-height:40vh;overflow:auto;border-top:2px solid #ff0000';
    d.innerHTML = '<b>JS ERRORS:</b><br>';
    document.body.appendChild(d);
  }
  d.innerHTML += 'Promise: ' + (e.reason && e.reason.message || e.reason || 'unknown') + '<br>';
});
