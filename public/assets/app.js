// Copy-to-clipboard buttons
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const code = btn.dataset.code;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: code });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  const label = btn.textContent;
  btn.textContent = btn.dataset.done;
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1500);
});

// Game search on the home page
const q = document.getElementById('q');
if (q) {
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    for (const card of document.querySelectorAll('#games .card')) card.hidden = v && !card.dataset.name.includes(v);
  });
}
