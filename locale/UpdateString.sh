#!/bin/sh
SCRIPTDIR=`dirname $0`
xgettext  --from-code=UTF-8 -k_ -kN_  -o vitals.pot "$SCRIPTDIR"/../*.js "$SCRIPTDIR"/../schemas/*.xml 

for fn in ./*/LC_MESSAGES/*.po; do
	msgmerge -U "$fn" vitals.pot
done
