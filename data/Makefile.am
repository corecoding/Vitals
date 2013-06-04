extensionurl = https://github.com/xtranophilist/gnome-shell-extension-sensors

# Change these to modify how installation is performed
topextensiondir = $(datadir)/gnome-shell/extensions

uuid = temperature@xtranophilist

extensiondir = $(topextensiondir)/$(uuid)

nodist_extension_DATA = metadata.json $(EXTRA_EXTENSION)

EXTRA_DIST = metadata.json.in

metadata.json: metadata.json.in $(top_builddir)/config.status
	$(AM_V_GEN) sed -e "s|[@]LOCALEDIR@|$(datadir)/locale|" \
	    -e "s|[@]GETTEXT_PACKAGE@|$(GETTEXT_PACKAGE)|" \
	    -e "s|[@]uuid@|$(uuid)|" \
	    -e "s|[@]url@|$(extensionurl)|" $< > $@

CLEANFILES = metadata.json

icondir = $(datadir)/icons/hicolor/scalable/status

icon_DATA = \
	sensors-fan-symbolic.svg \
	sensors-temperature-symbolic.svg \
	sensors-voltage-symbolic.svg

gschemas_in = org.gnome.shell.extensions.sensors.gschema.xml.in

@INTLTOOL_XML_NOMERGE_RULE@

gsettings_SCHEMAS = $(gschemas_in:.xml.in=.xml) @GSETTINGS_RULES@

EXTRA_DIST += $(gschemas_in)
CLEANFILES += $(gschemas_in:.xml.in=.valid) $(gsettings_SCHEMAS)
