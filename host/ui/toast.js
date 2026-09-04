/**
 * @file Transient messages: a stack in the corner that never blocks anything.
 *
 * Responsible for: telling someone what just happened, and getting out of the
 * way. Messages stack, dismiss on a click or a swipe, and expire on their own
 * unless they report a failure.
 *
 * NOT responsible for: asking anything. A message that needs an answer is a
 * decision, and decisions belong beside the control that raises them, where the
 * thing being decided about is still visible. That is `confirm.js`.
 *
 * Why not a banner at the top of the page. A banner pushes the layout down, so
 * the thing you just clicked moves out from under the cursor, and on a phone it
 * takes the whole first screen. This sits in a corner, over the content, and
 * costs the page no space at all.
 *
 * Duplicated into host/ui/toast.js by tools/sync-config.sh. Neither origin may
 * fetch from the other.
 */

/** How long a confirmation stays before it fades, in ms. */
const CONFIRM_LIFETIME_MS = 5200;

/**
 * Messages kept on screen at once.
 *
 * Past four, the stack is taller than a phone's lower half and the oldest are
 * unreadable anyway, so the oldest is retired rather than allowed to pile up.
 */
const MAX_STACKED = 4;

/** How far a message must be dragged before letting go dismisses it, in px. */
const DISMISS_DISTANCE_PX = 72;

/** The live stack element, created on first use. @type {HTMLElement | null} */
let stack = null;

/**
 * Get the stack, creating it the first time something is said.
 *
 * Built here rather than in the markup so both origins get it from one file,
 * and so a page that never notifies anyone carries no empty furniture.
 *
 * @returns {HTMLElement}
 */
function ensureStack() {
  if (stack?.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'toasts';
  // Polite, not assertive: these report what the person just did, so they
  // should wait their turn rather than interrupt a screen reader mid-sentence.
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-relevant', 'additions');
  document.body.appendChild(stack);
  return stack;
}

/**
 * Show a message.
 *
 * @param {string} message  what happened, in one sentence
 * @param {object} [options]
 * @param {'good' | 'bad' | 'plain'} [options.tone] failures stay until dismissed
 * @param {string} [options.detail] a second line, when one sentence is not enough
 * @returns {() => void} dismiss it early
 */
export function notify(message, options = {}) {
  const tone = options.tone ?? 'good';
  const host = ensureStack();

  while (host.children.length >= MAX_STACKED) {
    retire(host.firstElementChild);
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + tone;
  toast.setAttribute('role', tone === 'bad' ? 'alert' : 'status');

  const body = document.createElement('div');
  body.className = 'toast-body';

  const line = document.createElement('p');
  line.className = 'toast-message';
  line.textContent = message;
  body.appendChild(line);

  if (options.detail) {
    const detail = document.createElement('p');
    detail.className = 'toast-detail';
    detail.textContent = options.detail;
    body.appendChild(detail);
  }

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  // Named for a screen reader, because the glyph alone says nothing.
  close.setAttribute('aria-label', 'Dismiss: ' + message);
  close.textContent = '×';
  close.addEventListener('click', () => retire(toast));

  toast.append(body, close);
  host.appendChild(toast);

  makeSwipeable(toast);

  // Failures stay put. Somebody needs to read a failure, and a message that
  // removes itself before it has been read is worse than no message.
  let timer = 0;
  if (tone !== 'bad') {
    timer = setTimeout(() => retire(toast), CONFIRM_LIFETIME_MS);
    // Reading takes as long as it takes; hovering or focusing holds it.
    const hold = () => clearTimeout(timer);
    const resume = () => { timer = setTimeout(() => retire(toast), CONFIRM_LIFETIME_MS); };
    toast.addEventListener('pointerenter', hold);
    toast.addEventListener('focusin', hold);
    toast.addEventListener('pointerleave', resume);
    toast.addEventListener('focusout', resume);
  }

  return () => { clearTimeout(timer); retire(toast); };
}

/**
 * Remove a message, letting it animate out first unless motion is unwanted.
 *
 * @param {Element | null} toast
 * @returns {void}
 */
function retire(toast) {
  if (!toast || toast.dataset.leaving === 'yes') return;
  toast.dataset.leaving = 'yes';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toast.remove();
    return;
  }
  toast.classList.add('is-leaving');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  // A dropped animationend must not leave the message stuck on screen.
  setTimeout(() => toast.remove(), 500);
}

/**
 * Let a message be thrown off in either direction.
 *
 * Pointer events rather than touch events, so a mouse, a trackpad and a finger
 * all work through one path. `setPointerCapture` keeps the gesture attached to
 * the message even when the finger leaves it, which is exactly what happens on
 * a fast flick.
 *
 * @param {HTMLElement} toast
 * @returns {void}
 */
function makeSwipeable(toast) {
  let startX = 0;
  let dragging = false;

  toast.addEventListener('pointerdown', (event) => {
    // Let the close button be a button.
    if (event.target.closest('.toast-close')) return;
    dragging = true;
    startX = event.clientX;
    toast.setPointerCapture(event.pointerId);
    toast.classList.add('is-dragging');
  });

  toast.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    toast.style.transform = 'translateX(' + dx + 'px)';
    // Fades toward the edge, so the gesture shows its own outcome before the
    // finger lifts rather than surprising anyone at the end.
    toast.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / (DISMISS_DISTANCE_PX * 2.4)));
  });

  const settle = (event) => {
    if (!dragging) return;
    dragging = false;
    toast.classList.remove('is-dragging');
    const dx = event.clientX - startX;

    if (Math.abs(dx) >= DISMISS_DISTANCE_PX) {
      toast.style.transform = 'translateX(' + (dx > 0 ? 130 : -130) + '%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 190);
      return;
    }
    // Not far enough. Spring back, so a half-gesture is obviously undone.
    toast.style.transform = '';
    toast.style.opacity = '';
  };

  toast.addEventListener('pointerup', settle);
  toast.addEventListener('pointercancel', settle);
}

/** Remove every message at once. @returns {void} */
export function clearNotices() {
  if (!stack) return;
  for (const child of [...stack.children]) retire(child);
}
