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
        

	this.statusLabel = new St.Label({ text: "--", style_class: "temperature-label" });

        // destroy all previously created children, and add our statusLabel
        this.actor.get_children().forEach(function(c) { c.destroy() });
        this.actor.add_actor(this.statusLabel);

	this.sensorsPath = this._detectSensors();
	debug(this.sensorsPath);

	if(this.sensorsPath){
		this.title='Error';
		this.content='Run sensors-detect as root. If it doesn\'t help, click here to report!';
	        this.command=["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/issues/"];
	}
	else{
		this.title='Warning';
		this.content='Please install lm_sensors. If it doesn\'t help, click here to report!';
	        this.command=["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/issues/"];
	}

	this._update_temp();
        //update every 15 seconds
        GLib.timeout_add(0, 15000, Lang.bind(this, function () {
		this._update_temp();
		return true;
        }));
    },

	_detectSensors: function(){
		//detect if sensors is installed
		let ret = GLib.spawn_command_line_sync("which --skip-alias sensors");
		
		if ( (ret[0]) && (ret[3] == 0) ) {//if yes
			return ret[1].toString().split("\n", 1)[0];//find the path of the sensors
			}
		return null;	
	},
	
    _update_temp: function() {
	debug("Into update_temp");

	let temp=null;
	
	if (this.sensorsPath){
			let sensors_output = GLib.spawn_command_line_sync(this.sensorsPath);//get the output of the sensors command
			if(sensors_output[0]) temp = this._findTemperatureFromSensorsOutput(sensors_output[1].toString());//get temperature from sensors
		}
		
		//if we don't have the temperature yet
		if(!temp)
			temp = this._findTemperatureFromFiles();

		if (temp){
			this.title=this._getTitle(temp);
			this.content=this._getContent(temp);
			this.command=["echo"];
      		}  
 
        
        this.statusLabel.set_text(this.title);
        this.menu.box.get_children().forEach(function(c) { c.destroy() });

        let section = new PopupMenu.PopupMenuSection("Temperature");
        let item = new PopupMenu.PopupMenuItem("");
        item.addActor(new St.Label({ text:this.content, style_class: "sm-label"}));
	let command=this.command;
	item.connect('activate',function() {
            Util.spawn(command);
        });
        section.addMenuItem(item);
        this.menu.addMenuItem(section);

    },

	_findTemperatureFromFiles: function(){
	debug("Into findTemperatureFromFiles");
	let cpuTemperatureInfo = ['/sys/devices/platform/coretemp.0/temp1_inputa',
            '/sys/bus/acpi/devices/LNXTHERM\:00/thermal_zone/tempa',
            '/sys/devices/virtual/thermal/thermal_zone0/tempa',
            //old kernels with proc fs
            '/proc/acpi/thermal_zone/THM0/temperaturea',
            '/proc/acpi/thermal_zone/THRM/temperaturea',
            '/proc/acpi/thermal_zone/THR0/temperaturea',
            '/proc/acpi/thermal_zone/TZ0/temperaturea',
            '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_inputa',
            //hwmon for new 2.6.39, 3.0 linux kernels
            '/sys/class/hwmon/hwmon0/temp1_inputa',
            //Debian Sid/Experimental on AMD-64
            '/sys/class/hwmon/hwmon0/device/temp1_inputa'];
                for (let i=0;i<cpuTemperatureInfo.length;i++){
            if(GLib.file_test(cpuTemperatureInfo[i],1<<4)){
                let temperature = GLib.file_get_contents(cpuTemperatureInfo[i]);
                if(temperature[0]) {
                    return parseInt(temperature[1])/1000;
                    }
            }
        }
	return false;
	},

    _findTemperatureFromSensorsOutput: function(txt){
	debug("Into findTemperatureFromSensors");
        let senses_lines=txt.split("\n");
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
	global.log(a);
//    Util.spawn(['echo',a]);
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

