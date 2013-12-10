gnome-shell-extension-sensors
=============================
*gnome-shell-extension-sensors* (previously known as gnome-shell-extension-cpu-temperature)
is an extension for displaying CPU temperature, hard disk temperature, voltage and
CPU fan RPM in GNOME Shell.

The extension uses [sensors] from lm_sensors package (lm-sensors for Debian systems)
to read temperature for different CPU cores and adapters, voltage data and fan speed.

Optionally, this extension uses the [UDisks2] dbus interface or [hddtemp] as fallback to
read hard drive temperature data.

![Screenshot][screenshot]

Installation
=============

This is the **recommended method** for installation, as it doesn't require the build
dependencies for installation.
You can install this extension by visiting the [GNOME extensions]
page for this extension.

Installation by package manager
-------------------------------

Fedora has packaged an older version of this extension. You can install it by running:

`yum -y install gnome-shell-extension-cpu-temperature`

Manual installation
-------------------

To install this extension you need to clone the source and build the extension.
The build dependenciesare:

* *gettext*,
* *pkg-config*,
* *git*,
* *glib2*,
* *glib2-devel* or *libglib2.0-dev*,
* *zip*,
* *gnome-common*,
* *autoconf*,
* *automake*,
* *intltool*.

To build the extension please run the following commands:

    cd ~ && git clone https://github.com/xtranophilist/gnome-shell-extension-sensors.git
    cd ~/gnome-shell-extension-sensors
    ./autogen.sh

You can install this extension for your user by executing:

    make local-install

or system wide by executing (this requires root permissions):

    make install

After installation you need to restart the GNOME shell:

* `ALT`+`F2` to open the command prompt
* Enter `r` to restart the GNOME shell

Then enable the extension:
Open `gnome-tweak-tool` -> `Shell Extensions` -> `Sensors` -> On


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
[UDisks2]: http://www.freedesktop.org/wiki/Software/udisks/
[hddtemp]: https://savannah.nongnu.org/projects/hddtemp/
[GNOME extensions]: https://extensions.gnome.org/extension/82/cpu-temperature-indicator/
[authors]: https://github.com/xtranophilist/gnome-shell-extension-sensors/graphs/contributors
[screenshot]: https://raw.github.com/wiki/xtranophilist/gnome-shell-extension-sensors/gnome-shell-extension-sensors.png
