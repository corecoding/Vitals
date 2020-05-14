Vitals
====================================

Vitals is a GNOME Shell extension for displaying your computer's temperature, voltage, fan speed, memory usage, processor load, system resources, network speed and storage stats in your GNOME Shell's top menu bar. This is a one stop shop to monitor all of your vital sensors. Vitals uses asynchronous polling to provide a smooth user experience.

## Installation

### 1) Install these packages

#### Ubuntu

    apt install gir1.2-gtop-2.0 lm-sensors

#### Fedora

    dnf install libgtop2-devel lm_sensors
    
#### Arch/Manjaro

    sudo pacman -Syu libgtop lm_sensors gnome-icon-theme-symbolic

### 2) Install from extensions.gnome.org

https://extensions.gnome.org/extension/1460/vitals/

### 3) Activate after installation

Restart GNOME Shell (`Alt+F2`, `r`, `Enter`) and enable the extension through gnome-tweak-tool.

## Beta testing

Advanced users requesting bug fixes or asking for new features may occasionally be asked to help QA. 

### 1) Remove existing copy of Vitals

Check to see if ~/.local/share/gnome-shell/extensions/Vitals@CoreCoding.com exists, and if so, remove the directory.

I am hesitant to give an rm command here, in case someone copies and pastes it incorrectly. Again, beta testing is for advanced users so if you don't know how to remove a directory, please stop here.

### 2) Clone from GitHub

    mkdir -p ~/.local/share/gnome-shell/extensions
    git clone https://github.com/corecoding/Vitals.git ~/.local/share/gnome-shell/extensions/Vitals@CoreCoding.com

### 3) Check out develop branch

    cd ~/.local/share/gnome-shell/extensions/Vitals@CoreCoding.com
    git checkout develop

## Credits
Vitals was originally forked from [gnome-shell-extension-freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon). I was having trouble finding an up to date, resource friendly and fully featured system monitoring tool. My biggest pet peeve was random system delays becaus of I/O blocking polls, and thus, the idea for Vitals was born! It has been refactored several times over, so most of the code is new or different.

### Icons
* (voltage|fan)-symbolic.svg - inherited from Freon project.
* (system|storage)-symbolic.svg - from Pop! OS theme.
* temperature-symbolic.svg - [iconnice studio](https://www.iconfinder.com/iconnice).
* (cpu|memory)-symbolic.svg - [DinosoftLabs](https://www.iconfinder.com/dinosoftlabs).
* network\*.svg - [Yannick Lung](https://www.iconfinder.com/yanlu).
* Health icon - [Dod Cosmin](https://www.iconfinder.com/icons/458267/cross_doctor_drug_health_healthcare_hospital_icon).

## Disclaimer
Sensor data is obtained from the system using hwmon and GTop. Core Coding and the Vitals authors are not responsible for improperly represented data. No warranty expressed or implied.

## Development Commands
* Reload extension `gnome-shell-extension-tool -r Vitals@CoreCoding.com`
  - Note: This command is no longer supported as of GNOME 3.34
* Launch preferences `gnome-shell-extension-prefs Vitals@CoreCoding.com`
* View logs ```journalctl --since="`date '+%Y-%m-%d %H:%M'`" -f | grep Vitals```
* Compile schemas `glib-compile-schemas --strict schemas/`
* Compile translation file `msgfmt vitals.po -o vitals.mo`

## Donations
[Please consider donating if you find this extension useful.](https://corecoding.com/donate.php)
