# wagtail-block-clipboard

Copy a StreamField block in the Wagtail admin and paste it in another field or on another page.

Wagtail can duplicate a block in place, but not move one elsewhere
([wagtail/wagtail#8339](https://github.com/wagtail/wagtail/issues/8339)). This package adds:

- a **Copy** button on every block, at any depth, list items included;
- a **Paste** button next to every "+" button, shown while there is something to paste.
  It lists the last four copied blocks, with the page they come from.

## Where a block can be pasted

Wherever the same block can be created by hand:

- in a `StreamBlock`: a child with the same type name and the same Python class;
- in a `ListBlock`: a child of the same Python class.

There is no restriction on page type, field or depth. A copied block that does not fit the
place is still listed, with the reason it cannot be added there.

Differences in configuration (page types of a chooser, rich text features, a field that
became required) are not checked on paste: the block is pasted and the validation on save
reports them on the block, as it would for a block filled by hand. Fields the target block
does not have are left out, and named in a message.

Copied blocks are kept in the browser (`localStorage`), nothing is sent to the server. They
are cleared when the login page is shown.

## Install

```python
INSTALLED_APPS = [
    # ...
    "wagtail_block_clipboard",
]
```

No migration, no setting.

## How it hooks into Wagtail

Wagtail has no extension point for block actions, so `block-clipboard.js` wraps two methods
of the `StreamBlock` and `ListBlock` classes Wagtail exposes on `window.wagtailStreamField`,
and `apps.py` adds the Python class path of each block to what the admin receives
(`meta.blockClass`). Both rely on Wagtail internals, hence the pin on a single Wagtail
feature release: check the admin after an upgrade.

## Tests

```bash
node --test tests/block-clipboard.test.js
```
