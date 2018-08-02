gnome-shell-extension-vitals
====================================

Vitals is a GNOME extension for displaying your computer's temperature, voltage, fan speed, memory usage, processor load, system resources, network speed and storage stats in your GNOME Shell's menu bar. This is a one stop shop to monitor all of your vital sensors. Vitals uses asynchronous polling to provide a smooth user experience.

## Installation

### 1) Install these packages
You can use **apt install <package>** or **yum install <package>**

    libgtop2-dev
    lm-sensors

### 2a) Download from GitHub (either perform step 2a or 2b, not both)

    mkdir -p ~/.local/share/gnome-shell/extensions
    git clone https://github.com/corecoding/Vitals.git ~/.local/share/gnome-shell/extensions/Vitals@CoreCoding.com

### 2b) Download from extensions.gnome.org

https://extensions.gnome.org/extension/841/freon/

### 3) Activate after installation

Restart GNOME Shell (`Alt+F2`, `r`, `Enter`) and enable the extension through gnome-tweak-tool.

## Credits
Vitals was originally forked from [gnome-shell-extension-freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon). I was having trouble finding an up to date, resource friendly and fully featured system monitoring tool. My biggest pet peeve was random system delays becaus of I/O blocking polls, and thus, Vitals was born!

### Icons
* voltage-symbolic.svg and fan-symbolic.svg - inherited from Freon project.
* system-symbolic.svg, network-symbolic.svg and storage-symbolic.svg - from Pop! OS theme.
* temperature-symbolic.svg - [iconnice studio](https://www.iconfinder.com/iconnice).
* cpu-symbolic.svg and memory-symbolic.svg - [DinosoftLabs](https://www.iconfinder.com/dinosoftlabs).

## Disclaimer
Sensor data is grabbed from the system using hwmon and GTop. Core Coding and the Vitals authors are not responsible for improperly represented data. No warranty expressed or implied.
