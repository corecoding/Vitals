const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
//gnome 3.0
const Panel = imports.ui.panel;

function CpuTemperature() {
    this._init.apply(this, arguments);
}

CpuTemperature.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,
	
    _init: function(){
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'temperature');
        
        this.statusLabel = new St.Label({ text: '-' });
        // destroy all previously created children, and add our statusLabel
        this.actor.get_children().forEach(function(c) { c.destroy() });
        this.actor.add_actor(this.statusLabel);
        
        this._update_temp();
        //update every 15 seconds
        GLib.timeout_add(0, 15000, Lang.bind(this, function () {
            this._update_temp();
            return true;
        }));
    },
	
    _update_temp: function() {
        let title='Error';
        let content='Click here to report!';
        let command=["firefox", "http://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/issues/"];
        
        let foundTemperature=false;
        let cpuTemperatureInfo = ['/sys/devices/platform/coretemp.0/temp1_input',
            '/sys/bus/acpi/devices/LNXTHERM\:00/thermal_zone/temp',
            '/sys/devices/virtual/thermal/thermal_zone0/temp',
            //old kernels with proc fs
            '/proc/acpi/thermal_zone/THM0/temperature',
            '/proc/acpi/thermal_zone/THRM/temperature',
            '/proc/acpi/thermal_zone/THR0/temperature',
            '/proc/acpi/thermal_zone/TZ0/temperature',
            '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_input',
            //hwmon for new 2.6.39, 3.0 linux kernels
            '/sys/class/hwmon/hwmon0/temp1_input',
            //Debian Sid/Experimental on AMD-64
            '/sys/class/hwmon/hwmon0/device/temp1_input'];
        
        for (let i=0;i<cpuTemperatureInfo.length;i++){
            if(GLib.file_test(cpuTemperatureInfo[i],1<<4)){
                let temperature = GLib.file_get_contents(cpuTemperatureInfo[i]);
                if(temperature[0]) {
                    let c = parseInt(temperature[1])/1000;
                    title=this._getTitle(c);
                    content=this._getContent(c);
                    command=["echo"];
                    foundTemperature = true;
                }
                if(foundTemperature) break;
            }
        }
 
        if (!foundTemperature) {
            let foundSensor = 0;
            let sensorInfo = ['/usr/bin/sensors',
                '/bin/sensors'];
            for (let i=0;i<sensorInfo.length;i++){
                if(GLib.file_test(sensorInfo[i],1<<4)) foundSensor=sensorInfo[i];
                if (foundSensor) break;
            }
            if(foundSensor) {
                let sensors = GLib.spawn_command_line_sync(foundSensor);
                if(sensors[0]){
                    let temp=this._findTemperatureFromSensorsOutput(sensors[1]);
                    title=this._getTitle(temp);
                    content=this._getContent(temp);
                    command=["echo"];
                }
            }
            else {
                title="Warning";
                content="Please install lm-sensors";
                command=["echo"];
            }
        }
        
        this.statusLabel.set_text(title);
        this.menu.box.get_children().forEach(function(c) { c.destroy() });

        let section = new PopupMenu.PopupMenuSection("Temperature");
        let item = new PopupMenu.PopupMenuItem("");
        item.addActor(new St.Label({ text:content, style_class: "sm-label"}));
        item.connect('activate', function() {
            Util.spawn(command);
        });

        section.addMenuItem(item);
        this.menu.addMenuItem(section);
    },

    _findTemperatureFromSensorsOutput: function(text){
        let senses_lines=text.split("\n");
        let line = '';
        let s=0;
        let n=0;
        //iterate through each lines
        for(var i = 0; i < senses_lines.length; i++) {
            line = senses_lines[i];
            //check for adapter
            if (this._isAdapter(line)){
                let type=line.substr(9,line.length-9);
                let c=0;
                switch (type){
                    case 'Virtual device':
                        //starting from the next line, loop, also increase the outer line counter i
                        for (var j=i+1;;j++,i++){
                            //continue only if line exists and isn't adapter
                            if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                if(senses_lines[j].substr(0,5)=='temp1'){
                                    //remove all space characters
                                    senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                    s+=parseFloat(senses_lines[j].substr(7,4));
                                    n++;
                                    //set break flag on, look for temperature no-more
                                    c=1;    
                                };
                            }
                            else break;
                        }
                        break;
                    case 'ACPI interface':
                        //starting from the next line, loop, also increase the outer line counter i
                        for (var j=i+1;;j++,i++){
                            //continue only if line exists and isn't adapter
                            if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                if(senses_lines[j].substr(0,15)=='CPU Temperature'){
                                    senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                    s+=parseFloat(senses_lines[j].substr(16,4));
                                    n++;
                                    //set break flag on, look for temperature no-more
                                    c=1;
                                };
                            }
                            else break;
                        }
                        break;
                    case 'ISA adapter':
                        //starting from the next line, loop, also increase the outer line counter i
                        for (var j=i+1;;j++,i++){
                            //continue only if line exists and isn't adapter
                            if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                if(senses_lines[j].substr(0,4)=='Core'){
                                    senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                    s+=parseFloat(senses_lines[j].substr(7,4));
                                    n++;
                                };
                            }
                            else break;
                        }
                        break;
                    default:
                        break;
                }
                if (c==1) break;
            }
        }
        return(s/n);
    },

    _isAdapter: function(line){
        if(line.substr(0, 8)=='Adapter:') {
          return true;
        }
        return false;
    },

    _toFahrenheit: function(c){
        return ((9/5)*c+32).toFixed(1);
    },

    _getContent: function(c){
        return c.toString()+"\u1d3cC / "+this._toFahrenheit(c).toString()+"\u1d3cF";
    },

    _getTitle: function(c) {
        return c.toString()+"\u1d3cC";
        //comment the last line and uncomment the next line to display temperature in Fahrenheit
        //return this._toFahrenheit(c).toString()+"\u1d3cF";
    }
}

//for debugging
function debug(a){
    Util.spawn(['echo',a]);
}

function init(extensionMeta) {
    // do nothing here    
}

//gnome3.0
function main() {
    Panel.STANDARD_TRAY_ICON_ORDER.unshift('temperature');
    Panel.STANDARD_TRAY_ICON_SHELL_IMPLEMENTATION['temperature'] = CpuTemperature;
}

function enable() {
    let role = 'temperature';

    if(Main.panel._status_area_order.indexOf(role) == -1) {
        Main.panel._status_area_order.unshift(role);
        Main.panel._status_area_shell_implementation[role] = CpuTemperature;
    
        let constructor = Main.panel._status_area_shell_implementation[role];
        let indicator = new constructor();
        Main.panel.addToStatusArea(role, indicator, 0);
    } else {
        Main.panel._statusArea['temperature'].actor.show();
    }
}

function disable() {
    Main.panel._statusArea['temperature'].actor.hide();
}

