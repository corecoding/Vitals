const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;

function CpuTemperature() {
    this._init.apply(this, arguments);
}

CpuTemperature.prototype = {
    __proto__: PanelMenu.SystemStatusButton.prototype,

    _init: function(){
        PanelMenu.SystemStatusButton.prototype._init.call(this, 'temperature');

        this.lang = {
            'acpi' : 'ACPI Adapter',
            'pci' : 'PCI Adapter',
            'virt' : 'Virtual Thermal Zone'
        };
        this.statusLabel = new St.Label({
            text: "--",
            style_class: "temperature-label"
        });

        // destroy all previously created children, and add our statusLabel
        this.actor.get_children().forEach(function(c) {
            c.destroy()
        });
        this.actor.add_actor(this.statusLabel);

        this.sensorsPath = this._detectSensors();
        this.command=["xdg-open", "http://github.com/xtranophilist/gnome-shell-extension-cpu-temperature/issues/"];
        if(this.sensorsPath){
            this.title='Error';
            this.content='Run sensors-detect as root. If it doesn\'t help, click here to report with your sensors output!';
        }
        else{
            this.title='Warning';
            this.content='Please install lm_sensors. If it doesn\'t help, click here to report with your sensors output!';
        }

        this._update_temp();
        //update every 15 seconds
        event = GLib.timeout_add_seconds(0, 15, Lang.bind(this, function () {
            this._update_temp();
            return true;
        }));
    },

    _detectSensors: function(){
        //detect if sensors is installed
        let ret = GLib.spawn_command_line_sync("which sensors");
        if ( (ret[0]) && (ret[3] == 0) ) {//if yes
            return ret[1].toString().split("\n", 1)[0];//find the path of the sensors
        }
        return null;
    },

    _update_temp: function() {
        let items = new Array();
        let tempInfo=null;
        if (this.sensorsPath){
            let sensors_output = GLib.spawn_command_line_sync(this.sensorsPath);//get the output of the sensors command
            if(sensors_output[0]) tempInfo = this._findTemperatureFromSensorsOutput(sensors_output[1].toString());//get temperature from sensors
            if (tempInfo){
                //destroy all items in popup
                this.menu.box.get_children().forEach(function(c) {
                    c.destroy()
                });
                var s=0, n=0;//sum and count
                for (let adapter in tempInfo){
                    if(adapter!=0){
                        //ISA Adapters
                        if (adapter=='isa'){
                            for (let cpu in tempInfo[adapter]){
                                items.push("ISA Adapter "+cpu+": ");
                                for (let core in tempInfo[adapter][cpu]){
                                    s+=tempInfo[adapter][cpu][core]['temp'];
                                    n++;
                                    items.push(core+' : '+this._formatTemp(tempInfo[adapter][cpu][core]['temp']));
                                }
                            }

                        }else if (tempInfo[adapter]['temp']>0){
                            s+=tempInfo[adapter]['temp'];
                            n++;
                            items.push(this.lang[adapter] + ' : '+this._formatTemp(tempInfo[adapter]['temp']));
                        }
                    }
                }
                if (n!=0){//if temperature is detected
                    this.title=this._formatTemp(s/n);//set title as average
                }
            }
        }
        //if we don't have the temperature yet, use some known files
        if(!tempInfo){
            tempInfo = this._findTemperatureFromFiles();
            if(tempInfo.temp){
                this.menu.box.get_children().forEach(function(c) {
                    c.destroy()
                });
                this.title=this._formatTemp(tempInfo.temp);
                items.push('Current Temperature : '+this._formatTemp(tempInfo.temp));
                if (tempInfo.crit)
                    items.push('Critical Temperature : '+this._formatTemp(tempInfo.crit));
            }
        }

        this.statusLabel.set_text(this.title);
        this.menu.box.get_children().forEach(function(c) {
            c.destroy()
        });
        let section = new PopupMenu.PopupMenuSection("Temperature");
        if (items.length>0){
            let item;
            for each (let itemText in items){
                item = new PopupMenu.PopupMenuItem("");
                item.addActor(new St.Label({
                    text:itemText,
                    style_class: "sm-label"
                }));
                section.addMenuItem(item);
            }
        }else{
            let command=this.command;
            let item = new PopupMenu.PopupMenuItem("");
            item.addActor(new St.Label({
                text:this.content,
                style_class: "sm-label"
            }));
            item.connect('activate',function() {
                Util.spawn(command);
            });
            section.addMenuItem(item);
        }
        this.menu.addMenuItem(section);
    },

    _createSectionForText: function(txt){
        let section = new PopupMenu.PopupMenuSection("Temperature");
        let item = new PopupMenu.PopupMenuItem("");
        item.addActor(new St.Label({
            text:txt,
            style_class: "sm-label"
        }));
        section.addMenuItem(item);
        return section;
    },

    _findTemperatureFromFiles: function(){
        let info = new Array();
        let temp_files = [
        //hwmon for new 2.6.39, 3.x linux kernels
        '/sys/class/hwmon/hwmon0/temp1_input',
        '/sys/devices/platform/coretemp.0/temp1_input',
        '/sys/bus/acpi/devices/LNXTHERM\:00/thermal_zone/temp',
        '/sys/devices/virtual/thermal/thermal_zone0/temp',
        '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_input',
        //old kernels with proc fs
        '/proc/acpi/thermal_zone/THM0/temperature',
        '/proc/acpi/thermal_zone/THRM/temperature',
        '/proc/acpi/thermal_zone/THR0/temperature',
        '/proc/acpi/thermal_zone/TZ0/temperature',
        //Debian Sid/Experimental on AMD-64
        '/sys/class/hwmon/hwmon0/device/temp1_input'];
        for each (let file in temp_files){
            if(GLib.file_test(file,1<<4)){
                //let f = Gio.file_new_for_path(file);
                //f.read_async(0, null, function(source, result) {debug(source.read_finish(result).read())});

                let temperature = GLib.file_get_contents(file);
                if(temperature[0]) {
                    info['temp']= parseInt(temperature[1])/1000;
                }
            }
            break;
        }
        let crit_files = ['/sys/devices/platform/coretemp.0/temp1_crit',
        '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_crit',
        //hwmon for new 2.6.39, 3.0 linux kernels
        '/sys/class/hwmon/hwmon0/temp1_crit',
        //Debian Sid/Experimental on AMD-64
        '/sys/class/hwmon/hwmon0/device/temp1_crit'];
        for each (let file in crit_files){
            if(GLib.file_test(file,1<<4)){
                let temperature = GLib.file_get_contents(file);
                if(temperature[0]) {
                    info['crit']= parseInt(temperature[1])/1000;
                }
            }
        }
        return info;
    },

    _findTemperatureFromSensorsOutput: function(txt){
        let senses_lines=txt.split("\n");
        let line = '';
        let type = '';
        let s= new Array();
        s['isa'] = new Array();
        let n=0,c=0;
        let f;
        //iterate through each lines
        for(let i = 0; i < senses_lines.length; i++) {
            line = senses_lines[i];
            //check for adapter
            if (this._isAdapter(line)){
                type=line.substr(9,line.length-9);
                switch (type){
                    case 'ISA adapter':
                        //reset flag
                        f=0;
                        //starting from the next line, loop, also increase the outer line counter i
                        for (let j=i+1;;j++,i++){
                            //continue only if line exists and isn't adapter
                            if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                if(senses_lines[j].substr(0,4)=='Core'){
                                    senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                    //get the core number
                                    let k = senses_lines[j].substr(0,5);
                                    //test if it's the first match for this adapter, if yes, initialize array
                                    if (!f++){
                                        s['isa'][++n]=new Array();
                                    }
                                    s['isa'][n][k]=new Array();
                                    s['isa'][n][k]['temp']=parseFloat(senses_lines[j].substr(7,4));
                                    s['isa'][n][k]['high']=this._getHigh(senses_lines[j]);
                                    s['isa'][n][k]['crit']=this._getCrit(senses_lines[j]);
                                    s['isa'][n][k]['hyst']=this._getHyst(senses_lines[j]);
                                    c++;
                                }
                            }
                            else break;
                        }
                        break;
                    case 'Virtual device':
                        //starting from the next line, loop, also increase the outer line counter i
                        for (let j=i+1;;j++,i++){
                            //continue only if line exists and isn't adapter
                            if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                if(senses_lines[j].substr(0,5)=='temp1'){
                                    //remove all space characters
                                    senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                    s['virt'] = new Array();
                                    s['virt']['temp']=parseFloat(senses_lines[j].substr(7,4));
                                    s['virt']['high']=this._getHigh(senses_lines[j]);
                                    s['virt']['crit']=this._getCrit(senses_lines[j]);
                                    s['virt']['hyst']=this._getHyst(senses_lines[j]);
                                    c++;
                                }
                            }
                            else break;
                        }
                        break;
                    case 'ACPI interface':
                        //starting from the next line, loop, also increase the outer line counter i
                        for (let j=i+1;;j++,i++){
                            //continue only if line exists and isn't adapter
                            if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                if(senses_lines[j].substr(0,8)=='CPU Temp'){
                                    senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                    s['acpi'] = new Array();
                                    s['acpi']['temp']=parseFloat(senses_lines[j].substr(16,4));
                                    s['acpi']['high']=this._getHigh(senses_lines[j]);
                                    s['acpi']['crit']=this._getCrit(senses_lines[j]);
                                    s['acpi']['hyst']=this._getHyst(senses_lines[j]);
                                    c++;
                                }
                            }
                            else break;
                        }
                        break;
                    case 'PCI adapter':
                        if (senses_lines[i-1].substr(0,6)=='k10tem' || senses_lines[i-1].substr(0,6)=='k8temp'){
                            //starting from the next line, loop, also increase the outer line counter i
                            for (let j=i+1;;j++,i++){
                                //continue only if line exists and isn't adapter
                                if(senses_lines[j] && !this._isAdapter(senses_lines[j])){
                                    if(senses_lines[j].substr(0,5)=='temp1'){
                                        senses_lines[j]=senses_lines[j].replace(/\s/g, "");
                                        s['pci'] = new Array();
                                        s['pci']['temp']=parseFloat(senses_lines[j].substr(7,4));
                                        s['pci']['high']=this._getHigh(senses_lines[j]);
                                        s['pci']['crit']=this._getCrit(senses_lines[j]);
                                        s['pci']['hyst']=this._getHyst(senses_lines[j]);
                                        //In some cases crit,hyst temp may be on next line
                                        let nextLine=senses_lines[j+1].replace(/\s/g, "");
                                        if (nextLine.substr(0,1)=='('){
                                            if (!s['pci']['high']) s['pci']['high']=this._getHigh(nextLine);
                                            if (!s['pci']['crit']) s['pci']['crit']=this._getCrit(nextLine);
                                            if (!s['pci']['hyst']) s['pci']['hyst']=this._getHyst(nextLine);
                                        }
                                        c++;
                                    }
                                }
                                else break;
                            }
                        }
                        break;


                    default:
                        break;
                }
            //uncomment next line to return temperature from only one adapter
            //if (c==1) break;
            }
        }
        return s;
    },

    _isAdapter: function(line){
        if(line.substr(0, 8)=='Adapter:') {
            return true;
        }
        return false;
    },

    _getHigh: function(t){
        let r;
        return (r=/high=\+(\d{1,3}.\d)/.exec(t))?parseFloat(r[1]):null;
    },

    _getCrit: function(t){
        let r;
        return (r=/crit=\+(\d{1,3}.\d)/.exec(t))?parseFloat(r[1]):null;
    },

    _getHyst: function(t){
        let r;
        return (r=/hyst=\+(\d{1,3}.\d)/.exec(t))?parseFloat(r[1]):null;
    },


    _toFahrenheit: function(c){
        return ((9/5)*c+32).toFixed(1);
    },

    _getContent: function(c){
        return c.toString()+"\u1d3cC / "+this._toFahrenheit(c).toString()+"\u1d3cF";
    },

    _formatTemp: function(t) {
        //uncomment the next line to display temperature in Fahrenheit
        //return this._toFahrenheit(t).toString()+"\u1d3cF";
        return (Math.round(t*10)/10).toFixed(1).toString()+"\u1d3cC";
    }
}

//for debugging
function debug(a){
    global.log(a);
    Util.spawn(['echo',a]);
}

function init() {
//do nothing
}

let indicator;
let event=null;

function enable() {
    indicator = new CpuTemperature();
    Main.panel.addToStatusArea('temperature', indicator);
}

function disable() {
    indicator.destroy();
    Mainloop.source_remove(event);
    indicator = null;
}
