/*
 * Copy and paste of StreamField blocks, between fields and pages.
 *
 * Rule (wagtail/wagtail#8339): any block can be copied, at any depth, and pasted wherever
 * that same block can be created by hand. Same block means same type name and same Python
 * class in a StreamBlock, same child class in a ListBlock. Anything finer (page types of a
 * chooser, rich text features, required fields) is left to the validation on save, which
 * already reports it on the block itself.
 *
 * Copied blocks live in localStorage. Nothing is sent to the server.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'wagtail-block-clipboard';
  const PAYLOAD_VERSION = 1;
  // ponytail: fixed size, make it a setting if editors ask for more.
  const MAX_ENTRIES = 4;
  const CONFIRMATION_DURATION = 2000;

  /* ── Block definitions and states ───────────────────────────────────────────── */

  const isPlainObject = (value) =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  const isStreamDef = (blockDef) =>
    Array.isArray(blockDef && blockDef.groupedChildBlockDefs);
  const isStructDef = (blockDef) =>
    !!blockDef && isPlainObject(blockDef.childBlockDefsByName) && !isStreamDef(blockDef);
  const isListDef = (blockDef) =>
    !!(blockDef && blockDef.childBlockDef) && !isStreamDef(blockDef);
  const blockClassOf = (blockDef) =>
    (blockDef && blockDef.meta && blockDef.meta.blockClass) || null;
  // Draftail's getState() returns a Draft.js EditorState, which is not JSON.
  const isEditorState = (value) =>
    !!value && typeof value.getCurrentContent === 'function';

  const newId = () => crypto.randomUUID();

  /** A block state as JSON: rich text becomes the raw content string Draftail accepts back. */
  function serializeState(state) {
    if (isEditorState(state)) {
      return JSON.stringify(window.DraftJS.convertToRaw(state.getCurrentContent()));
    }
    if (Array.isArray(state)) return state.map(serializeState);
    if (isPlainObject(state)) {
      return Object.fromEntries(
        Object.entries(state).map(([key, value]) => [key, serializeState(value)]),
      );
    }
    return state;
  }

  /**
   * The state as the target definition can take it: StructBlock children and nested block
   * types the target does not know are left out, their names collected in `dropped`.
   * Nested blocks get new ids, so the same copy can be pasted twice on a page.
   */
  function pruneState(state, blockDef, dropped) {
    if (isStructDef(blockDef) && isPlainObject(state)) {
      const out = {};
      Object.keys(state).forEach((key) => {
        const childDef = blockDef.childBlockDefsByName[key];
        if (childDef) out[key] = pruneState(state[key], childDef, dropped);
        else dropped.push(key);
      });
      return out;
    }
    if (isStreamDef(blockDef) && Array.isArray(state)) {
      return state.flatMap((item) => {
        const childDef = item && blockDef.childBlockDefsByName[item.type];
        if (!childDef) {
          dropped.push((item && item.type) || '?');
          return [];
        }
        return [{ ...item, id: newId(), value: pruneState(item.value, childDef, dropped) }];
      });
    }
    if (isListDef(blockDef) && Array.isArray(state)) {
      return state.map((item) => ({
        ...item,
        id: newId(),
        value: pruneState(item && item.value, blockDef.childBlockDef, dropped),
      }));
    }
    return state;
  }

  /**
   * Where the payload goes in a sequence (a StreamBlock or ListBlock definition): the child
   * definition to create and the state to give it, or null when that block cannot be
   * created there.
   */
  function findPasteTarget(payload, sequenceDef) {
    let blockDef = null;
    if (payload.container === 'stream' && isStreamDef(sequenceDef)) {
      const candidate = sequenceDef.childBlockDefsByName[payload.type];
      const candidateClass = blockClassOf(candidate);
      if (
        candidate &&
        (!candidateClass || !payload.blockClass || candidateClass === payload.blockClass)
      ) {
        blockDef = candidate;
      }
    } else if (payload.container === 'list' && isListDef(sequenceDef)) {
      // List items have no type name: the class is all there is to compare.
      const candidateClass = blockClassOf(sequenceDef.childBlockDef);
      if (candidateClass && candidateClass === payload.blockClass) {
        blockDef = sequenceDef.childBlockDef;
      }
    }
    if (!blockDef) return null;
    const dropped = [];
    return { blockDef, state: pruneState(payload.state, blockDef, dropped), dropped };
  }

  function isValidPayload(value) {
    return (
      isPlainObject(value) &&
      value.version === PAYLOAD_VERSION &&
      (value.container === 'stream' || value.container === 'list') &&
      typeof value.blockId === 'string' &&
      typeof value.label === 'string' &&
      'state' in value
    );
  }

  if (typeof module !== 'undefined') {
    module.exports = { findPasteTarget, isValidPayload, pruneState, serializeState };
    return;
  }

  /* ── Storage ────────────────────────────────────────────────────────────────── */

  /** The copied blocks, newest first. */
  function readEntries() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(isValidPayload) : [];
    } catch {
      return [];
    }
  }

  function writeEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    refreshPasteButtons();
  }

  // Paste buttons only show while there is something to paste (see block-clipboard.css).
  function refreshPasteButtons() {
    document.documentElement.classList.toggle(
      'wbc-has-entries',
      readEntries().length > 0,
    );
  }

  /* ── Messages ───────────────────────────────────────────────────────────────── */

  const stringsElement = document.getElementById('wagtail-block-clipboard-strings');
  const strings = stringsElement ? JSON.parse(stringsElement.textContent) : {};
  const t = (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, value),
      strings[key] || key,
    );

  function notify(text, type) {
    document.dispatchEvent(
      new CustomEvent('w-messages:add', { detail: { clear: true, text, type } }),
    );
  }

  function relativeTime(iso) {
    const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
    if (Number.isNaN(seconds)) return '';
    const [unit, size] = [
      ['day', 86400],
      ['hour', 3600],
    ].find(([, unitSize]) => seconds >= unitSize) || ['minute', 60];
    return new Intl.RelativeTimeFormat(document.documentElement.lang || 'en').format(
      -Math.max(1, Math.round(seconds / size)),
      unit,
    );
  }

  /* ── Copy ───────────────────────────────────────────────────────────────────── */

  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
    node.append(...children);
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `icon icon-${name}`);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function buildPayload(child) {
    const sequenceDef = child.sequence.blockDef;
    const inList = isListDef(sequenceDef);
    const meta = child.blockDef.meta || {};
    const titleInput = document.querySelector('input[name="title"]');
    return {
      version: PAYLOAD_VERSION,
      // Copying the same block again replaces its entry.
      blockId: child.id || newId(),
      container: inList ? 'list' : 'stream',
      type: inList ? null : child.type,
      blockClass: blockClassOf(child.blockDef),
      // A ListBlock's child often has no label of its own: use the list's.
      label: meta.label || (sequenceDef.meta && sequenceDef.meta.label) || child.type || '',
      state: serializeState(child.getDuplicatedState().value),
      copiedAt: new Date().toISOString(),
      source: (titleInput && titleInput.value) || document.title,
    };
  }

  function copy(child, button) {
    try {
      const payload = buildPayload(child);
      const others = readEntries().filter((entry) => entry.blockId !== payload.blockId);
      writeEntries([payload, ...others].slice(0, MAX_ENTRIES));
    } catch (error) {
      // Storage full or disabled, or a widget whose state is not JSON.
      console.error(error);
      notify(t('copyFailed'), 'error');
      return;
    }
    // The message area is at the top of the page, often scrolled away: confirm on the button too.
    const use = button.querySelector('use');
    button.title = t('copied');
    use.setAttribute('href', '#icon-check');
    setTimeout(() => {
      button.title = t('copy');
      use.setAttribute('href', '#icon-clipboard');
    }, CONFIRMATION_DURATION);
    notify(t('copiedMessage'), 'success');
  }

  function addCopyButton(child) {
    const container = child.actionsContainerElement;
    if (!container) return;
    const button = element(
      'button',
      {
        'type': 'button',
        'class': 'button button--icon text-replace white',
        'data-streamfield-action': 'COPY',
        'title': t('copy'),
      },
      [icon('clipboard')],
    );
    button.addEventListener('click', (event) => {
      // The block header collapses the block on click.
      event.stopPropagation();
      copy(child, button);
    });
    const deleteButton = container.querySelector('[data-streamfield-action="DELETE"]');
    container.insertBefore(button, deleteButton);
  }

  /* ── Paste ──────────────────────────────────────────────────────────────────── */

  /** The sequence's total or per-type limit that is already reached, or null. */
  function limitReached(sequence, type) {
    const reached = (max, count) => typeof max === 'number' && max > 0 && count >= max;
    if (reached(sequence.getBlockMax(), sequence.getBlockCount())) return true;
    return !!type && reached(sequence.getBlockMax(type), sequence.getBlockCount(type));
  }

  /** Why the payload cannot be pasted in the sequence, or null when it can. */
  function refusal(payload, sequence) {
    if (!findPasteTarget(payload, sequence.blockDef)) {
      // A page's own StreamField has no label, unlike the blocks nested in it.
      const target = (sequence.blockDef.meta || {}).label;
      return t(target ? 'incompatible' : 'incompatibleHere', {
        label: payload.label,
        source: payload.source,
        target,
      });
    }
    return limitReached(sequence, payload.type) ? t('limitReached') : null;
  }

  function paste(sequence, index, payload) {
    const target = findPasteTarget(payload, sequence.blockDef);
    sequence._insert(target.blockDef, target.state, newId(), index, {
      animate: true,
      focus: true,
    });
    if (target.dropped.length) {
      notify(t('pastedWithout', { fields: target.dropped.join(', ') }), 'warning');
    }
  }

  let dialog = null;

  function openDialog(sequence, control) {
    if (!dialog) {
      dialog = element('dialog', {
        'class': 'wbc-dialog',
        'aria-labelledby': 'wbc-dialog-title',
      });
      // A click on the backdrop lands on the dialog element itself.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
      document.body.append(dialog);
    }

    const render = () => {
      const entries = readEntries();
      if (!entries.length) {
        dialog.close();
        return;
      }
      const closeButton = element(
        'button',
        { type: 'button', class: 'button button-secondary button-small' },
        [t('close')],
      );
      closeButton.addEventListener('click', () => dialog.close());

      const items = entries.map((payload) => {
        const reason = refusal(payload, sequence);
        const pasteButton = element(
          'button',
          { type: 'button', class: 'wbc-entry' },
          [
            element('strong', {}, [payload.label]),
            element('span', {}, [
              [t('from', { source: payload.source }), relativeTime(payload.copiedAt)]
                .filter(Boolean)
                .join(' · '),
            ]),
          ],
        );
        if (reason) {
          // Kept focusable, so the reason is read out; the click does nothing.
          pasteButton.setAttribute('aria-disabled', 'true');
          pasteButton.append(element('span', { class: 'wbc-reason' }, [reason]));
        }
        pasteButton.addEventListener('click', () => {
          if (reason) return;
          dialog.close();
          paste(sequence, control.index, payload);
        });

        const removeButton = element(
          'button',
          {
            type: 'button',
            class: 'button button--icon text-replace button-secondary button-small',
            title: t('remove', { label: payload.label }),
          },
          [icon('bin')],
        );
        removeButton.addEventListener('click', () => {
          writeEntries(readEntries().filter((entry) => entry.blockId !== payload.blockId));
          render();
        });
        return element('li', {}, [pasteButton, removeButton]);
      });

      dialog.replaceChildren(
        element('h2', { id: 'wbc-dialog-title' }, [t('dialogTitle')]),
        element('ul', {}, items),
        closeButton,
      );
    };

    render();
    if (readEntries().length) dialog.showModal();
  }

  function addPasteButton(sequence, control) {
    const button = element(
      'button',
      {
        'type': 'button',
        'class': 'c-sf-add-button wbc-paste',
        'title': t('paste'),
        'data-block-clipboard-paste': '',
      },
      [icon('clipboard')],
    );
    button.addEventListener('click', () => openDialog(sequence, control));

    const addButton = control.element;
    if (addButton.tagName !== 'BUTTON') {
      // StreamBlock: the control is a wrapper around its "+" button.
      addButton.classList.add('wbc-inserter');
      addButton.append(button);
      return;
    }
    // ListBlock: the control is the "+" button itself. Blocks are inserted right after the
    // control's element, so both buttons go in a wrapper that takes its place.
    const wrapper = element('div', { class: 'wbc-inserter' });
    addButton.replaceWith(wrapper);
    wrapper.append(addButton, button);
    control.element = wrapper;
    control.enable = () => addButton.removeAttribute('disabled');
    control.disable = () => addButton.setAttribute('disabled', 'true');
  }

  /* ── Hooking into Wagtail ───────────────────────────────────────────────────── */

  // ponytail: Wagtail has no extension point for block actions, so the two sequence
  // classes it exposes are wrapped. Move to the official API if #8339 lands.
  function patch(blocks) {
    [blocks.StreamBlock, blocks.ListBlock].forEach((sequenceClass) => {
      const proto = sequenceClass && sequenceClass.prototype;
      if (!proto || proto.wagtailBlockClipboard) return;
      proto.wagtailBlockClipboard = true;

      const createChild = proto._createChild;
      proto._createChild = function (...args) {
        const child = createChild.apply(this, args);
        addCopyButton(child);
        return child;
      };

      const createInsertionControl = proto._createInsertionControl;
      proto._createInsertionControl = function (...args) {
        const control = createInsertionControl.apply(this, args);
        addPasteButton(this, control);
        return control;
      };
    });
  }

  // This script loads before the StreamField one, which only exists on editing views:
  // patch as soon as it publishes its classes, before any block is rendered.
  let streamField = window.wagtailStreamField;
  if (streamField && streamField.blocks) {
    patch(streamField.blocks);
  } else {
    Object.defineProperty(window, 'wagtailStreamField', {
      configurable: true,
      get: () => streamField,
      set(value) {
        streamField = value;
        if (value && value.blocks) patch(value.blocks);
      },
    });
  }

  // On a shared computer, copied blocks must not outlive the session. The login page is
  // where every way out of a session ends up (logout, expiry, browser reopened).
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('form.login-form')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage disabled: nothing to clear.
    }
  });

  refreshPasteButtons();
  // Blocks copied in another tab.
  window.addEventListener('storage', refreshPasteButtons);
})();
