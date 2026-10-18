/** Optional local package filtering. No network requests, analytics, cookies or storage. */
const input = document.querySelector('#package-filter');
if (input) {
  const cards = [...document.querySelectorAll('.package')];
  input.closest('.filter').hidden = false;
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = !card.textContent.toLowerCase().includes(query);
      if (!card.hidden) visible++;
    }
    document.querySelector('#package-status').textContent =
      `${visible} of ${cards.length} packages`;
  });
}
