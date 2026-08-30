document.querySelectorAll('[data-toggle-lane]').forEach((button) => {
  button.addEventListener('click', () => {
    const lane = button.closest('.lane');
    const collapsed = lane.dataset.collapsed === 'true';
    lane.dataset.collapsed = String(!collapsed);
    button.setAttribute('aria-expanded', String(collapsed));
  });
});
