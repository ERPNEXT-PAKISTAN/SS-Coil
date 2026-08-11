import frappe


def after_install():
	run_post_install_setup()


def after_migrate():
	run_post_install_setup()


def run_post_install_setup():
	from ss_coil.app_setup import run_post_install_setup as _run

	return _run()
