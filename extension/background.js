// Solo se despierta al pulsar el icono de la extensión.
chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'edit' });
  } catch {
    // La pestaña activa no es el mosaico: abre una nueva ya en modo edición.
    await chrome.storage.session.set({ edit: true });
    chrome.tabs.create({});
  }
});
