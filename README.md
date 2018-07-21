gnome-shell-extension-vitals
====================================

Vitals is a GNOME extension for displaying system temperature, voltage, fan speed, memory usage and CPU load in GNOME Shell's menu bar. I was having trouble finding an up to date, resource friendly and fully featured monitoring tool. Going above and beyond, I decided to add history charts and warning colors - green, yellow and red to signal when there are issues.

More info in [wiki](https://github.com/corecoding/Vitals/wiki)

## Installation

### 1) Install these packages
You can use **apt install <package>** or **yum install <package>**

    libgtop2-dev
    lm-sensors

### 2a) Installation using git

    mkdir -p ~/.local/share/gnome-shell/extensions
    git clone https://github.com/corecoding/Vitals.git ~/.local/share/gnome-shell/extensions/Vitals@CoreCoding

### 2b) Installation from extensions.gnome.org

https://extensions.gnome.org/extension/841/freon/

### 3) Activate after installation

Restart GNOME Shell (`Alt+F2`, `r`, `Enter`) and enable the extension through gnome-tweak-tool.

## Credits
Vitals is forked from [gnome-shell-extension-freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon).

Memory and cpu icons by Abderraouf omara from iconfinder.com in the [Computer and Technologies](https://www.iconfinder.com/iconsets/computer-and-technologies-1). Icons changed to white.

Icons inherited from Freon project: fan.svg, gpu.svg, temperature.svg, voltage.svg

## Disclaimer
Sensor data is grabbed from the system using hwmon and GTop. Core Coding and Vitals author is not responsible for improperly represented data.
