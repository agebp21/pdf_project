// Keep fullscreen in the middle as optional reading tools become available.
(() => {
  'use strict';
  const button = document.getElementById('fullscreen');
  const toolbar = button?.closest('.navigation');
  if (!toolbar) return;
  let frame;
  function center() {
    frame = null;
    const others = [...toolbar.children].filter(el => el !== button && el.tagName === 'BUTTON' && !el.hidden && el.textContent.trim() && getComputedStyle(el).display !== 'none');
    const middle = others[Math.ceil(others.length / 2)];
    if (middle) { if (button.nextElementSibling !== middle) toolbar.insertBefore(button, middle); }
    else if (toolbar.lastElementChild !== button) toolbar.append(button);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(center); };
  new MutationObserver(schedule).observe(toolbar, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden','style','class']});
  document.addEventListener('langchange', schedule);
  schedule();
})();
