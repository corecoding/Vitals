ACLOCAL_AMFLAGS = -I m4 ${ACLOCAL_FLAGS}

SUBDIRS = src data po

uuid = "temperature@xtranophilist"

localprefix = $(HOME)/.local/share/gnome-shell/extensions

zip-file: sensors.shell-extension.zip

sensors.shell-extension.zip: all
	$(MKDIR_P) $(builddir)/.build
	$(MAKE) install DESTDIR="$(abs_builddir)/.build"
	$(AM_V_at)cp -r "$(builddir)/.build$(datadir)/gnome-shell/extensions/$(uuid)" "$(builddir)/.build"
	$(AM_V_at)cp -r "$(builddir)/.build$(datadir)/locale" "$(builddir)/.build/$(uuid)"
	$(AM_V_at)cp -r "$(builddir)/.build$(datadir)/glib-2.0/schemas" "$(builddir)/.build/$(uuid)"
	$(AM_V_at)cp -r "$(builddir)/.build$(datadir)/icons" "$(builddir)/.build/$(uuid)"
	$(AM_V_at)glib-compile-schemas "$(builddir)/.build/$(uuid)/schemas"
	$(AM_V_at)(cd "$(builddir)/.build/$(uuid)/"; zip -qr "$(abs_builddir)/sensors.shell-extension.zip" .)

clean-local:
	$(AM_V_at)-rm -rf $(builddir)/sensors.shell-extension.zip

distclean-local:
	$(AM_V_at)-rm -rf $(builddir)/.build

local-install: sensors.shell-extension.zip
	$(AM_V_at)-rm -rf "$(localprefix)/$(uuid)"
	$(MKDIR_P) "$(localprefix)/$(uuid)"
	$(AM_V_at)(cd $(localprefix)/$(uuid); unzip -q "$(abs_builddir)/sensors.shell-extension.zip")

