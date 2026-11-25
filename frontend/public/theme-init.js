// Apply the saved theme before first paint (Interface Craft C6). External
// file so the page keeps a strict CSP with no inline script.
try {
  var t = localStorage.getItem('salin.theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage blocked: follow the system theme */ }
