"""Sales Contract print helpers for Sales Order print formats."""

from __future__ import annotations

from frappe.utils import flt


def build_sales_contract_lines(doc):
	"""Item lines + totals for Sales Contract print (sample PDF columns)."""
	gst_rate = 0.0
	for tax in getattr(doc, "taxes", None) or []:
		rate = flt(getattr(tax, "rate", None))
		if rate:
			gst_rate = rate
			break

	rows = []
	total_qty = 0.0
	total_amount = 0.0
	total_gst = 0.0
	total_with_gst = 0.0
	sr = 0

	for item in getattr(doc, "items", None) or []:
		if getattr(item, "custom_is_process_charge", None):
			continue
		sr += 1
		width = getattr(item, "custom_width", None)
		length = getattr(item, "custom_length", None)
		length_c = getattr(item, "custom_length_c", None)
		if width not in (None, "") and length not in (None, ""):
			size = f"{_fmt_num(width)} {_fmt_num(length)}"
		elif width not in (None, "") and length_c not in (None, ""):
			size = f"{_fmt_num(width)} {length_c}"
		else:
			size = getattr(item, "custom_dimension", None) or "—"

		coils = getattr(item, "custom_qty_of_coil", None)
		if coils in (None, ""):
			coils = 1
		est_wt = flt(getattr(item, "custom_estimated_wt", None))
		total_qty_line = est_wt if est_wt else flt(item.qty)
		amount = flt(item.amount)
		gst_amt = (amount * gst_rate / 100.0) if gst_rate else 0.0
		line_total = amount + gst_amt

		total_qty += total_qty_line
		total_amount += amount
		total_gst += gst_amt
		total_with_gst += line_total

		rows.append(
			{
				"sr": sr,
				"spec": getattr(item, "custom_specification", None) or "—",
				"thickness": _fmt_num(getattr(item, "custom_thickness", None))
				if getattr(item, "custom_thickness", None) not in (None, "")
				else "—",
				"size": size,
				"coils": _fmt_num(coils),
				"total_qty": total_qty_line,
				"uom": item.uom or item.stock_uom or "",
				"rate": flt(item.rate),
				"amount": amount,
				"gst_amount": gst_amt,
				"line_total": line_total if gst_rate else amount,
			}
		)

	return {
		"rows": rows,
		"gst_rate": gst_rate,
		"total_qty": total_qty,
		"total_amount": total_amount,
		"total_gst": total_gst,
		"total_with_gst": total_with_gst if gst_rate else total_amount,
	}


def _fmt_num(value):
	if value in (None, ""):
		return ""
	num = flt(value)
	if abs(num - int(num)) < 1e-9:
		return str(int(num))
	return f"{num:g}"
