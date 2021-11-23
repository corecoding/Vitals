#!/bin/bash
FILE=vitals.zip
if [ -f $FILE ]; then
    rm $FILE
fi

# check if glib-compile-schemas exists
if [ -x /usr/bin/glib-compile-schemas ]; then
    # check if schemas directory exists
    if [ -d ./schemas/ ]; then
        /usr/bin/glib-compile-schemas --strict schemas/
    fi
fi

# check if msgfmt is tool missing
if [ ! -x /usr/bin/msgfmt ]; then
    # msgfmt doesn't exist, see if apt exists
    if [ -x /usr/bin/apt ]; then
        # install msgfmt command
        sudo apt install gettext
    fi
fi

# compile message catalogs to binary format
if [ -x /usr/bin/msgfmt ]; then
    if [ -d ./locale/ ]; then
        for i in locale/*/
            do /usr/bin/msgfmt $i/LC_MESSAGES/vitals.po -o $i/LC_MESSAGES/vitals.mo
        done
    fi
fi

# bundle files, skip unnecessary files per https://wiki.gnome.org/Projects/GnomeShell/Extensions/Review#Don.27t_include_unecessary_files
zip vitals.zip -r * -x "README.md" -x "locale/*.po" -x "locale/vitals.pot" -x "zip.sh" -x "schemas/org.gnome.shell.extensions.vitals.gschema.xml"
