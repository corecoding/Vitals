#!/bin/bash
FILE=vitals.zip
if [ -f $FILE ]; then
    rm $FILE
fi

zip vitals.zip -r * -x "locale/*.po" -x "locale/vitals.pot" -x "build.sh" -x "schemas/org.gnome.shell.extensions.vitals.gschema.xml"
