#!/bin/sh

NAME=freon@UshakovVasilii_Github.yahoo.com
rm -rf ~/.local/share/gnome-shell/extensions/$NAME
cp -r $NAME ~/.local/share/gnome-shell/extensions/.
