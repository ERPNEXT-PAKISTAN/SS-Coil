"""Functions listed here become callable directly inside print format Jinja
templates (see hooks.py `jinja.methods`). Used so the sticker print formats'
fallback HTML (ss_coil/ss_coil/print_format/stock_entry_sticker*/*.html) can
call the same field-building functions api.py uses for the primary PDF path,
instead of duplicating the field list/order in Jinja - the two drifted out
of sync before this was done, which is why it's done this way now.
"""

from ss_coil.api import (
	build_stock_entry_sticker_body_html,
	build_stock_entry_sticker_combo_html,
	build_stock_entry_sticker_footer_html,
	build_stock_entry_sticker_html,
	build_stock_entry_sticker_payload,
	get_stock_entry_sticker_logo_url,
)
from ss_coil.coil_print import build_coil_detail_print_html

__all__ = [
	"build_coil_detail_print_html",
	"build_stock_entry_sticker_body_html",
	"build_stock_entry_sticker_combo_html",
	"build_stock_entry_sticker_footer_html",
	"build_stock_entry_sticker_html",
	"build_stock_entry_sticker_payload",
	"get_stock_entry_sticker_logo_url",
]
