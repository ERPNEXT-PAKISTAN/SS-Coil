from ss_coil.production_planning_report import build_ss_coil_production_planning, get_report_columns


def execute(filters=None):
	columns = get_report_columns()
	data = build_ss_coil_production_planning(filters)
	return columns, data
