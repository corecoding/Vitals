gnome-shell-extension-vitals
====================================

Vitals is a GNOME extension for displaying your computer's temperature, voltage, fan speed, memory usage, processor load, system resources, network speed and storage stats in your GNOME Shell's menu bar. This is a one stop shop to monitor all of your vital sensors. Vitals uses asynchronous polling to provide a smooth user experience.


More info in [wiki](https://github.com/corecoding/Vitals/wiki).

## Installation

### 1) Install these packages
You can use **apt install <package>** or **yum install <package>**

    libgtop2-dev
    lm-sensors

### 2a) Installation using git

    mkdir -p ~/.local/share/gnome-shell/extensions
    git clone https://github.com/corecoding/Vitals.git ~/.local/share/gnome-shell/extensions/Vitals@CoreCoding.com

### 2b) Installation from extensions.gnome.org

https://extensions.gnome.org/extension/841/freon/

### 3) Activate after installation

Restart GNOME Shell (`Alt+F2`, `r`, `Enter`) and enable the extension through gnome-tweak-tool.

## Credits
Vitals was originally forked from [gnome-shell-extension-freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon). I was having trouble finding an up to date, resource friendly and fully featured monitoring tool, and thus, Vitals was born!

### Icons
* Memory and cpu icons by Abderraouf omara from iconfinder.com in the [Computer and Technologies](https://www.iconfinder.com/iconsets/computer-and-technologies-1). Icons changed to white.
* Icons inherited from Freon project: temperature.svg, voltage.svg and fan.svg.
* system.svg, network.svg and storage.svg from Pop! OS theme.


## Disclaimer
Sensor data is grabbed from the system using hwmon and GTop. Core Coding and Vitals author is not responsible for improperly represented data. No warranty expressed or implied.
