from functools import wraps

from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


def expose_block_class(adapter_class):
    """Add the block's Python class path to what the admin knows of each block.

    The admin only sees a block's type name and a generic kind (CharBlock and
    RichTextBlock are both "field blocks"), which is not enough to tell whether a
    copied block is the one a field accepts."""
    js_args = adapter_class.js_args

    @wraps(js_args)
    def js_args_with_block_class(self, block):
        args = js_args(self, block)
        # The meta dict is the last argument of every block adapter.
        args[-1]["blockClass"] = f"{type(block).__module__}.{type(block).__qualname__}"
        return args

    adapter_class.js_args = js_args_with_block_class


class WagtailBlockClipboardConfig(AppConfig):
    name = "wagtail_block_clipboard"
    verbose_name = _("Block clipboard")

    def ready(self):
        from wagtail.blocks.field_block import FieldBlockAdapter
        from wagtail.blocks.list_block import ListBlockAdapter
        from wagtail.blocks.static_block import StaticBlockAdapter
        from wagtail.blocks.stream_block import StreamBlockAdapter
        from wagtail.blocks.struct_block import StructBlockAdapter
        from wagtail.contrib.typed_table_block.blocks import TypedTableBlockAdapter

        for adapter_class in (
            FieldBlockAdapter,
            ListBlockAdapter,
            StaticBlockAdapter,
            StreamBlockAdapter,
            StructBlockAdapter,
            TypedTableBlockAdapter,
        ):
            expose_block_class(adapter_class)
