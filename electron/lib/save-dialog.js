function saveDialogFilters(defaultName) {
  if (/\.md$/i.test(defaultName)) {
    return [
      { name: 'Markdown Files', extensions: ['md'] },
      { name: 'MDZip Documents', extensions: ['mdz'] },
      { name: 'All Files', extensions: ['*'] },
    ];
  }

  return [
    { name: 'MDZip Documents', extensions: ['mdz'] },
    { name: 'All Files', extensions: ['*'] },
  ];
}

module.exports = { saveDialogFilters };
