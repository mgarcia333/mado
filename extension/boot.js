// Pinta el color de fondo al instante (antes de leer chrome.storage) para evitar parpadeos.
try {
  const c = localStorage.getItem('bgc');
  if (c) document.documentElement.style.background = c;
  const f = localStorage.getItem('fav');
  if (f) {
    const l = document.createElement('link');
    l.id = 'ico';
    l.rel = 'icon';
    l.href = f;
    document.head.append(l);
  }
} catch {}
