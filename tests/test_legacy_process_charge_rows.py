"""Regression checks for legacy material rows with process-charge item names."""
import unittest

import frappe

from ss_coil.process_charges import is_process_charge_row


class LegacyProcessChargeRowsTest(unittest.TestCase):
    def test_traced_material_is_production(self):
        for trace_field in ("custom_raw_material_tag_no", "custom_source_stock_entry_detail"):
            row = frappe._dict(item_code="Slitting Charges", custom_raw_material_item="Mother Coil")
            row[trace_field] = "material-reference"
            self.assertFalse(is_process_charge_row(row))

    def test_explicit_charge_markers_take_precedence(self):
        for marker, value in (("custom_is_process_charge", 1), ("custom_process_charge_key", "slitter")):
            row = frappe._dict(item_code="Slitting Charges", custom_raw_material_item="Mother Coil",
                               custom_raw_material_tag_no="TAG")
            row[marker] = value
            self.assertTrue(is_process_charge_row(row))

    def test_untraced_service_item_stays_charge(self):
        self.assertTrue(is_process_charge_row(frappe._dict(item_code="Slitting Charges")))
        self.assertFalse(is_process_charge_row(frappe._dict(item_code="Mother Coil Un-Opened")))


if __name__ == "__main__":
    unittest.main()
