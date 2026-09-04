/**
 * @file Asking before destroying something, in our own words and our own box.
 *
 * Responsible for: a confirmation attached to the control that raised it.
 *
 * NOT responsible for: telling anyone what happened afterwards. That is
 * `toast.js`.
 *
 * Why not `window.confirm`. Three reasons, in order of how much they cost.
 * Chrome suppresses dialogs from a cross-origin iframe, and this panel spends
 * most of its life embedded in a letting agent's page, so the guard would have
 * been missing exactly where the button is easiest to hit by accident. It
 * blocks the page, which no confirmation needs to do. And it is the browser's
 * furniture, in the browser's voice, in the middle of a product that has spent
 * some effort on having one of its own.
 *
 * Why not a modal in the centre of the screen. The thing being decided about is
 * a row in a list, and a centred modal covers the list. This opens against the
 * control, so what you are about to destroy stays visible while you decide.
 *
 * Duplicated into host/ui/confirm.js by tools/sync-config.sh.
 */

/** The open confirmation, if any. Only ever one. @type {HTMLElement | null} */
let open = null;

/** Called when the open confirmation closes without a decision. @type {(() => void) | null} */
let onDismiss = null;

/**
 * Ask before doing something that cannot be undone.
 *
 * Resolves true when confirmed, false on cancel, Escape, or a click elsewhere.
 * Never rejects: a person walking away from a question is an answer, not an
 * error.
 *
 * @param {HTMLElement} anchor the control that raised it
 * @param {object} options
 * @param {string} options.question  what is about to happen, as a question
 * @param {string} [options.detail]  the consequence, if it is not obvious
 * @param {string} options.confirmLabel  what the confirming button says
 * @returns {Promise<boolean>}
 */
export function confirmAction(anchor, { question, detail, confirmLabel }) {
  close(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      close(false);
      anchor.focus({ preventScroll: true });
      resolve(answer);
    };

    const box = document.createElement('div');
    box.className = 'confirm';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', question);

    const heading = document.createElement('p');
    heading.className = 'confirm-question';
    heading.textContent = question;
    box.appendChild(heading);

    if (detail) {
      const note = document.createElement('p');
      note.className = 'confirm-detail';
      note.textContent = detail;
      box.appendChild(note);
    }

    const row = document.createElement('div');
    row.className = 'confirm-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'quiet';
    cancel.textContent = 'Keep it';
    cancel.addEventListener('click', () => finish(false));

    const proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.className = 'revoke';
    proceed.textContent = confirmLabel;
    proceed.addEventListener('click', () => finish(true));

    // Cancel first in the DOM, so it is what Tab and Enter reach first. The
    // safe answer should be the easy one.
    row.append(cancel, proceed);
    box.appendChild(row);

    // Anchored to the control's own offset parent, so it follows the button if
    // the list scrolls or re-renders around it.
    const holder = anchor.parentElement ?? document.body;
    holder.style.position = holder.style.position || 'relative';
    holder.appendChild(box);
    open = box;

    onDismiss = () => finish(false);
    requestAnimationFrame(() => cancel.focus({ preventScroll: true }));

    // Escape anywhere, and a click on anything that is not this box.
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);

    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    }
    function onOutside(event) {
      if (!box.contains(event.target)) finish(false);
    }
    box.dataset.cleanup = 'yes';
    box.addEventListener('remove-listeners', () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onOutside, true);
    });
  });
}

/**
 * Close whatever is open.
 *
 * @param {boolean} notify whether to resolve the pending promise as cancelled
 * @returns {void}
 */
function close(notify = true) {
  if (!open) return;
  open.dispatchEvent(new Event('remove-listeners'));
  open.remove();
  open = null;
  const dismiss = onDismiss;
  onDismiss = null;
  if (notify) dismiss?.();
}

/** Is a confirmation currently open? Used by tests and by the demo. */
export function confirmIsOpen() {
  return open !== null;
}
