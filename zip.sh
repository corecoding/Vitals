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

# check if msgfmt is missing
if [ ! -x /usr/bin/msgfmt ]; then
    # msgfmt doesn't exist, see if apt exists
    if [ -x /usr/bin/apt ]; then
        # install msgfmt command
        sudo apt install gettext
    fi
fi

# check if msgfmt exists
if [ -x /usr/bin/msgfmt ]; then
    if [ -d ./locale/ ]; then
        for i in locale/*/
            do /usr/bin/msgfmt $i/LC_MESSAGES/vitals.po -o $i/LC_MESSAGES/vitals.mo
        done
    fi
fi

# zip up files, skipping blocked files as seen at
# https://wiki.gnome.org/Projects/GnomeShell/Extensions/Review#Don.27t_include_unecessary_files
zip vitals.zip -r * -x "locale/*.po" -x "locale/vitals.pot" -x "build.sh" -x "schemas/org.gnome.shell.extensions.vitals.gschema.xml"
