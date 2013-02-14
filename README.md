*gnome-shell-extension-cpu-temperature* is an extension for displaying
system temperature data in GNOME Shell.

The extension uses [sensors] from lm_sensors package (lm-sensors for Debian systems)
to read temperature for different CPU cores and adapters.
If lm_sensors is not installed, temperature is read from [system files].

Optionally, this extension uses [hddtemp] to read hard drive temperature data.
The data is updated every 15 seconds.


Installation
=============

You can install this extension by visiting the [GNOME extensions]
page for this extension.

Installation by package manager
-------------------------------

Fedora has packaged this extension. You can install it by running:

`yum -y install gnome-shell-extension-cpu-temperature`

Manual installation
-------------------

This is the **recommended method** for installation as you always get the latest version.
You can install this extension for your user by executing:

    cd ~/.local/share/gnome-shell/extensions
    git clone https://github.com/xtranophilist/gnome-shell-extension-cpu-temperature.git temperature@xtranophilist
    glib-compile-schemas temperature@xtranophilist/schemas/

or system wide by executing (this requires root permissions):

    cd /usr/share/gnome-shell/extensions/
    git clone https://github.com/xtranophilist/gnome-shell-extension-cpu-temperature.git temperature@xtranophilist
    glib-compile-schemas temperature@xtranophilist/schemas/

After installation you need to restart the GNOME shell:

* `ALT`+`F2` to open the command prompt
* Enter `r` to restart the GNOME shell

Then enable the extension:
Open `gnome-tweak-tool` -> `Shell Extensions` -> `CPU temperature indicator` -> On


Installing dependencies
-------------
Installing lm-sensors for Fedora, CentOS and other distros with yum:

`yum install -y lm_sensors`

Ubuntu, Debian and other distros with apt-get:

`apt-get install lm-sensors`

Then run `sensors-detect` as root as one time detection process.

Installing `hdd-temp`:

`yum -y install hddtemp`


Configuration
---------------------

This extensions uses the output of `sensors`(1) command to obtain the
temperature data and sensor labeling. To relabel, hide or correct the
output consult the `sensors.conf`(5) manual.

Authors : [authors]

[sensors]: http://www.lm-sensors.org/
[hddtemp]: https://savannah.nongnu.org/projects/hddtemp/
[GNOME extensions]: https://extensions.gnome.org/extension/82/cpu-temperature-indicator/
[system files]: https://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/blob/master/extension.js#L174
[authors]: https://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/graphs/contributors
