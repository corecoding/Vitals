AC_PREREQ(2.63)
dnl be carefull, the version needs to be in sync with your gnome shell version
AC_INIT([gnome-shell-extension-sensors],[1.3],[https://github.com/xtranophilist/gnome-shell-extension-sensorsi/issues])

AC_CONFIG_MACRO_DIR([m4])
AC_CONFIG_AUX_DIR([config])

AM_INIT_AUTOMAKE([1.10 dist-xz foreign])

m4_ifdef([AM_SILENT_RULES],[AM_SILENT_RULES([yes])])

AC_PROG_SED

PKG_PROG_PKG_CONFIG([0.22])

GLIB_GSETTINGS

AC_ARG_WITH(desktop-dir, [  --with-desktop-dir=PATH where to install desktop files (default=PREFIX/share)])

if test "x$with_desktop_dir" != x; then
  DESKTOP_DATADIR=$with_desktop_dir
else
  DESKTOP_DATADIR="$datadir"
fi

AM_CONDITIONAL(DESKTOP_DATADIR, test "x$with_desktop_dir" != xno)
AC_SUBST(DESKTOP_DATADIR)

AC_ARG_WITH([local-install],
	     [AS_HELP_STRING([--with-local-install],
			     [install schemas and translations in a subdir of the extension (default is no)])],
	     [use_local_install=$withval],
	     [use_local_install=no])

AC_SUBST(use_local_install)
AM_CONDITIONAL(LOCAL_INSTALL, test "x${use_local_install}" == "xyes")

extensiontopdir=${datadir}/gnome-shell/extensions/weather@gnome-shell-extensions.gnome.org

dnl This is beyond ugly. Suggestions accepted.
if test "x${use_local_install}" == "xyes"; then
   AC_SUBST(gsettingsschemadir, [${extensiontopdir}/schemas])
fi

dnl Please keep this sorted alphabetically.
AC_CONFIG_FILES([
  Makefile
  data/Makefile
  src/Makefile
])
AC_OUTPUT

if test "x$use_local_install" == "xyes"; then
   echo
   echo "The schemas will be installed in subdirectories of the extension."
   echo
fi
