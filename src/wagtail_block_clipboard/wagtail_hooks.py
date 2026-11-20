from django.templatetags.static import static
from django.utils.html import format_html, json_script
from django.utils.translation import gettext as _
from wagtail import hooks


@hooks.register("register_icons")
def register_icons(icons):
    return [*icons, "wagtail_block_clipboard/icons/clipboard.svg"]


@hooks.register("insert_global_admin_css")
def block_clipboard_css():
    return format_html(
        '<link rel="stylesheet" href="{}">',
        static("wagtail_block_clipboard/block-clipboard.css"),
    )


# Global rather than insert_editor_js: snippets and settings have StreamFields too.
@hooks.register("insert_global_admin_js")
def block_clipboard_js():
    strings = {
        "copy": _("Copy"),
        "copied": _("Copied"),
        "copiedMessage": _(
            "Block copied. Paste it with the clipboard button next to a “+” button."
        ),
        "copyFailed": _("The block could not be copied."),
        "paste": _("Paste a copied block"),
        "dialogTitle": _("Paste a copied block"),
        "from": _("from “{source}”"),
        "incompatible": _(
            "“{label}”, copied from “{source}”, cannot be added to “{target}”: "
            "this type of block is not available there."
        ),
        "incompatibleHere": _(
            "“{label}”, copied from “{source}”, cannot be added here: "
            "this type of block is not available in this field."
        ),
        "limitReached": _("The maximum number of blocks is reached here."),
        "pastedWithout": _("Pasted without: {fields}"),
        "remove": _("Remove “{label}” from the copied blocks"),
        "close": _("Close"),
    }
    return format_html(
        '{}<script src="{}"></script>',
        json_script(strings, "wagtail-block-clipboard-strings"),
        static("wagtail_block_clipboard/block-clipboard.js"),
    )
