"""Regression checks for print field coverage, escaping and continuation pages."""
import unittest
from unittest.mock import patch

from ss_coil.inspection_print import FORM1_FIELDS, FORM2_GROUPS, build_inspection_print_html


class InspectionDocument:
    name = "JS-TEST"

    def __init__(self, table, rows):
        self.values = {table: rows}

    def get(self, key, default=None):
        return self.values.get(key, default)

    def check_permission(self, permission):
        assert permission == "read"


class TestInspectionPrint(unittest.TestCase):
    @patch("ss_coil.inspection_print.get_inspection_context", return_value={})
    def test_all_fields_escape_values(self, _context):
        for form, table, fields in (
            (1, "custom_slitter_inspection_sheet_1", FORM1_FIELDS),
            (2, "slitter_inspection_sheet_2", tuple(field for _, group in FORM2_GROUPS for field, _ in group)),
        ):
            row = {field: f"<{field}>" for field in fields}
            html = build_inspection_print_html(InspectionDocument(table, [row]), form)
            for field in fields:
                self.assertIn(f"&lt;{field}&gt;", html)
                self.assertNotIn(f"<{field}>", html)

    @patch("ss_coil.inspection_print.get_inspection_context", return_value={})
    def test_form2_overflow_preserves_last_column(self, _context):
        rows = [{"thickness_ds": index} for index in range(9)]
        html = build_inspection_print_html(InspectionDocument("slitter_inspection_sheet_2", rows), 2)
        self.assertEqual(html.count('<section class="inspection-print-page">'), 2)
        self.assertIn("<th>9</th>", html)
        self.assertIn("<td>0</td>", html)
        self.assertIn("<td>8</td>", html)

    @patch("ss_coil.inspection_print.get_inspection_context", return_value={})
    def test_form1_overflow_and_empty_sheet(self, _context):
        rows = [{"width_center": index} for index in range(33)]
        html = build_inspection_print_html(InspectionDocument("custom_slitter_inspection_sheet_1", rows), 1)
        self.assertEqual(html.count('<section class="inspection-print-page">'), 2)
        self.assertIn("<td>33</td>", html)
        self.assertIn("<td>32</td>", html)
        empty = build_inspection_print_html(InspectionDocument("custom_slitter_inspection_sheet_1", []), 1)
        self.assertEqual(empty.count('<section class="inspection-print-page">'), 1)
        self.assertIn("<td>32</td>", empty)
