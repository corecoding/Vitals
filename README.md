gnome-shell-extension-cpu-temperature
=====================================

*gnome-shell-extension-cpu-temperature* is a extension for displaying
system temperature data in GNOME Shell. The temperature data are
provided by [lm_sensors] and optionally by [hddtemp].

----

Dependencies
------------

This extension requires:

* [lm_sensors] to read CPU and motherboard temperature data.

Optionally this extension uses:

* [hddtemp] to read hard drive temperature data.

Installation
------------

You can install this extension by visiting the [GNOME extensions]
homepage.

Installation by package manager
-------------------------------

Fedora has packaged this extension. You can install it by running:

`yum -y install gnome-shell-extension-cpu-temperature`

Manual installation
-------------------

If you prefer a manual installation you can install this extension
for your user by executing:

    cd ~/.local/share/gnome-shell/extensions
    git clone https://github.com/xtranophilist/gnome-shell-extension-cpu-temperature.git temperature@xtranophilist

or system wide by excuting (this requires root permissions):

    cd /usr/share/gnome-shell/extensions/
    git clone https://github.com/xtranophilist/gnome-shell-extension-cpu-temperature.git temperature@xtranophilist

After installation you need to restart the GNOME shell by:

* `ALT`+`F2` to open the command prompt
* Enter `r` to restart the GNOME shell

Configuration
-------------

This extensions uses the output `sensors`(1) command to obstain the
temperature data and sensor labeling. To relabel, hide or correct the
output consult the `sensors.conf`(5) manual.

Authors
-------
* Dipesh Acharya <xtranophilist@gmail.com>

[lm_sensors]: http://www.lm-sensors.org/
[hddtemp]: https://savannah.nongnu.org/projects/hddtemp/
[GNOME extensions]: https://extensions.gnome.org/extension/82/cpu-temperature-indicator/
