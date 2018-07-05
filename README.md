gnome-shell-extension-corestats
====================================

Core Stats is an extension for displaying system temperature, voltage, fan speed, memory usage and CPU load in GNOME Shell's menu bar. More info in [wiki](https://github.com/corecoding/CoreStats/wiki)

## Installation

### 1) Install these packages
You can use **apt install <package>** or **yum install <package>**

    libgtop2-dev
    lm-sensors

### 2a) Installation from git

    mkdir -p ~/.local/share/gnome-shell/extensions
    git clone https://github.com/corecoding/CoreStats.git ~/.local/share/gnome-shell/extensions/CoreStats@CoreCoding

### 2b) Installation from extensions.gnome.org

https://extensions.gnome.org/extension/841/freon/

### 3) Activate after installation

Restart GNOME Shell (`Alt+F2`, `r`, `Enter`) and enable the extension through gnome-tweak-tool.

## Credits

### Core Stats is forked from [gnome-shell-extension-freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon).

### Memory and cpu icons by Abderraouf omara from iconfinder.com in the [Computer and Technologies](https://www.iconfinder.com/iconsets/computer-and-technologies-1). Icons changed to white.
### Icons inherited from Freon project: fan.svg, gpu.svg, temperature.svg, voltage.svg
