#!/bin/bash
FILE=vitals.zip
if [ -f $FILE ]; then
    rm $FILE
fi

# check if schemas directory exists
if [ -d ./schemas/ ]; then
    if [ -x /usr/bin/glib-compile-schemas ]; then
        glib-compile-schemas --strict schemas/
    fi
fi

zip vitals.zip -r * -x "locale/*.po" -x "locale/vitals.pot" -x "build.sh" -x "schemas/org.gnome.shell.extensions.vitals.gschema.xml"
