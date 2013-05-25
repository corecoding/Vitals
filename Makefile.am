ACLOCAL_AMFLAGS = -I m4 ${ACLOCAL_FLAGS}

SUBDIRS = src data

uuid = "temperature@xtranophilist"

localprefix = $(HOME)/.local/share/gnome-shell/extensions

zip-file: sensors.shell-extension.zip

sensors.shell-extension.zip: all
	$(MKDIR_P) $(builddir)/.build
	$(MAKE) install DESTDIR="$(abs_builddir)/.build"
	$(AM_V_at)cp -r "$(builddir)/.build$(datadir)/gnome-shell/extensions/$(uuid)" "$(builddir)/.build"
	if [ -f "$(builddir)/.build$(datadir)/glib-2.0/schemas/org.gnome.shell.extensions.sensors.gschema.xml" ]; then \
		$(MKDIR_P) "$(builddir)/.build/$(uuid)/schemas"; \
		mv "$(builddir)/.build$(datadir)/glib-2.0/schemas/org.gnome.shell.extensions.sensors.gschema.xml" "$(builddir)/.build/$(uuid)/schemas"; \
		glib-compile-schemas "$(builddir)/.build/$(uuid)/schemas"; \
	fi; \
	cp -r "$(builddir)/.build$(datadir)/locale" "$(builddir)/.build/$(uuid)"; \
	(cd "$(builddir)/.build/$(uuid)/"; \
	 zip -qr "$(abs_builddir)/sensors.shell-extension.zip" .; \
	);

clean-local:
	$(AM_V_at)-rm -rf $(builddir)/sensors.shell-extension.zip

distclean-local:
	$(AM_V_at)-rm -rf $(builddir)/.build

local-install: sensors.shell-extension.zip
	zip_file="$(abs_builddir)/sensors.shell-extension.zip"; \
	if [ -d "$(localprefix)/$(uuid)" ]; then \
	rm -fR "$(localprefix)/$(uuid)"; \
	fi; \
	$(MKDIR_P) $(localprefix)/$(uuid); \
	(cd $(localprefix)/$(uuid); \
	unzip -q $${zip_file}; \
	);

