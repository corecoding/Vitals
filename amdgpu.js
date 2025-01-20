// Definition for the kernel data structures can be found at
// https://github.com/torvalds/linux/blob/v6.12/drivers/gpu/drm/amd/include/kgd_pp_interface.h

export class MetricsTableHeader {

    /*
     * uint16_t
     */
    structure_size

    /*
     * uint8_t
     */
    format_revision

    /*
     * uint8_t
     */
    content_revision

    constructor(buffer) {
        const view = new DataView(buffer);
        this.structure_size = view.getUint16(0, true);
        this.format_revision = view.getUint8(2);
        this.content_revision = view.getUint8(3);
    }

}

export class GpuMetricsV1_3 {

    // Temperature
    /*
     * uint16_t
     */
    temperature_edge;

    /*
     * uint16_t
     */
    temperature_hotspot;

    /*
     * uint16_t
     */
    temperature_mem;

    /*
     * uint16_t
     */
    temperature_vrgfx;

    /*
     * uint16_t
     */
    temperature_vrsoc;

    /*
     * uint16_t
     */
    temperature_vrmem;

    // Utilization
    /*
     * uint16_t
     */
    average_gfx_activity;

    /*
     * uint16_t
     */
    average_umc_activity; // memory controller

    /*
     * uint16_t
     */
    average_mm_activity; // UVD or VCN

    // Power/Energy
    /*
     * uint16_t
     */
    average_socket_power;
    /*
     * uint64_t
     */
    energy_accumulator;

    // Driver attached timestamp (in ns)
    /*
     * uint64_t
     */
    system_clock_counter;

    // Average clocks
    /*
     * uint16_t
     */
    average_gfxclk_frequency;
    /*
     * uint16_t
     */
    average_socclk_frequency;
    /*
     * uint16_t
     */
    average_uclk_frequency;
    /*
     * uint16_t
     */
    average_vclk0_frequency;
    /*
     * uint16_t
     */
    average_dclk0_frequency;
    /*
     * uint16_t
     */
    average_vclk1_frequency;
    /*
     * uint16_t
     */
    average_dclk1_frequency;

    // Current clocks
    /*
     * uint16_t
     */
    current_gfxclk;
    /*
     * uint16_t
     */
    current_socclk;
    /*
     * uint16_t
     */
    current_uclk;
    /*
     * uint16_t
     */
    current_vclk0;
    /*
     * uint16_t
     */
    current_dclk0;
    /*
     * uint16_t
     */
    current_vclk1;
    /*
     * uint16_t
     */
    current_dclk1;

    // Throttle status
    /*
     * uint32_t
     */
    throttle_status;

    // Fans
    /*
     * uint16_t
     */
    current_fan_speed;

    // Link width/speed
    /*
     * uint16_t
     */
    pcie_link_width;
    /*
     * uint16_t
     *
     * Link speed in 0.1 GT/s
     */
    pcie_link_speed;

    /*
     * uint16_t
     */
    padding;

    /*
     * uint32_t
     */
    gfx_activity_acc;

    /*
     * uint32_t
     */
    mem_activity_acc;

    /*
     * uint16_t
     */
    temperature_hbm;

    // PMFW attached timestamp (10ns resolution)
    /*
     * uint64_t
     */
    firmware_timestamp;

    // Voltage (mV)
    /*
     * uint16_t
     */
    voltage_soc;
    /*
     * uint16_t
     */
    voltage_gfx;
    /*
     * uint16_t
     */
    voltage_mem;

    /*
     * uint16_t
     */
    padding1;

    // Throttle status (ASIC independent)
    /*
     * uint64_t
     */
    indep_throttle_status;

    constructor(buffer) {
        const view = new DataView(buffer);

        this.temperature_edge = view.getUint16(0, true);
        this.temperature_hotspot = view.getUint16(2, true);
        this.temperature_mem = view.getUint16(4, true);
        this.temperature_vrgfx = view.getUint16(6, true);
        this.temperature_vrsoc = view.getUint16(8, true);
        this.temperature_vrmem = view.getUint16(10, true);

        this.average_gfx_activity = view.getUint16(12, true);
        this.average_umc_activity = view.getUint16(14, true);
        this.average_mm_activity = view.getUint16(16, true);

        this.average_socket_power = view.getUint16(18, true);
        this.energy_accumulator = view.getBigUint64(20, true);

        this.system_clock_counter = view.getBigUint64(28, true);

        this.average_gfxclk_frequency = view.getUint16(36, true);
        this.average_socclk_frequency = view.getUint16(38, true);
        this.average_uclk_frequency = view.getUint16(40, true);
        this.average_vclk0_frequency = view.getUint16(42, true);
        this.average_dclk0_frequency = view.getUint16(44, true);
        this.average_vclk1_frequency = view.getUint16(46, true);
        this.average_dclk1_frequency = view.getUint16(48, true);

        this.current_gfxclk = view.getUint16(50, true);
        this.current_socclk = view.getUint16(52, true);
        this.current_uclk = view.getUint16(54, true);
        this.current_vclk0 = view.getUint16(56, true);
        this.current_dclk0 = view.getUint16(58, true);
        this.current_vclk1 = view.getUint16(60, true);
        this.current_dclk1 = view.getUint16(62, true);

        this.throttle_status = view.getUint32(64, true);

        this.current_fan_speed = view.getUint16(68, true);

        this.pcie_link_width = view.getUint16(70, true);
        this.pcie_link_speed = view.getUint16(72, true);
        this.padding = view.getUint16(74, true);
        this.gfx_activity_acc = view.getUint32(76, true);
        this.mem_activity_acc = view.getUint32(80, true);
        let hmb1 = view.getUint16(84, true);
        let hmb2 = view.getUint16(86, true);
        let hmb3 = view.getUint16(88, true);
        let hmb4 = view.getUint16(90, true);
        this.temperature_hbm = [hmb1, hmb2, hmb3, hmb4];

        this.firmware_timestamp = view.getBigUint64(92, true);

        this.voltage_soc = view.getUint16(100, true);
        this.voltage_gfx = view.getUint16(102, true);
        this.voltage_mem = view.getUint16(104, true);
        this.padding1 = view.getUint16(106, true);
        this.indep_throttle_status = view.getBigUint64(108, true);
    }

}

export class GpuMetricsV2_1 {

    // Temperature
    /*
     * uint16_t
     */
    temperature_gfx; // gfx temperature on APUs
    /*
     * uint16_t
     */
    temperature_soc; // soc temperature on APUs
    /*
     * uint16_t
     */
    temperature_core; // CPU core temperature on APUs
    /*
     * uint16_t
     */
    temperature_l3;

    // Utilization
    /*
     * uint16_t
     */
    average_gfx_activity;
    /*
     * uint16_t
     */
    average_mm_activity; // UVD or VCN

    // Driver attached timestamp (in ns)
    /*
     * uint64_t
     */
    system_clock_counter;

    // Power/Energy
    /*
     * uint64_t
     */
    average_socket_power; // dGPU + APU power on A + A platform
    /*
     * uint16_t
     */
    average_cpu_power;
    /*
     * uint16_t
     */
    average_soc_power;
    /*
     * uint16_t
     */
    average_gfx_power;
    /*
     * uint16_t
     */
    average_core_power; // CPU core power on APUs

    // Average clocks
    /*
     * uint16_t
     */
    average_gfxclk_frequency;
    /*
     * uint16_t
     */
    average_socclk_frequency;
    /*
     * uint16_t
     */
    average_uclk_frequency;
    /*
     * uint16_t
     */
    average_fclk_frequency;
    /*
     * uint16_t
     */
    average_vclk_frequency;
    /*
     * uint16_t
     */
    average_dclk_frequency;

    // Current clocks
    /*
     * uint16_t
     */
    current_gfxclk;
    /*
     * uint16_t
     */
    current_socclk;
    /*
     * uint16_t
     */
    current_uclk;
    /*
     * uint16_t
     */
    current_fclk;
    /*
     * uint16_t
     */
    current_vclk;
    /*
     * uint16_t
     */
    current_dclk;
    /*
     * uint16_t
     */
    current_coreclk; // CPU core clocks
    /*
     * uint16_t
     */
    current_l3clk;

    // Throttle status
    /*
     * uint32_t
     */
    throttle_status;

    // Fans
    /*
     * uint16_t
     */
    fan_pwm;

    /*
     * uint16_t
     */
    padding;

    constructor(buffer) {
        const view = new DataView(buffer);

        this.temperature_gfx = view.getUint16(0, true);
        this.temperature_soc = view.getUint16(2, true);
        let core1 = view.getUint16(4, true);
        let core2 = view.getUint16(6, true);
        let core3 = view.getUint16(8, true);
        let core4 = view.getUint16(10, true);
        let core5 = view.getUint16(12, true);
        let core6 = view.getUint16(14, true);
        let core7 = view.getUint16(16, true);
        let core8 = view.getUint16(18, true);
        this.temperature_core = [ core1, core2, core3, core4, core5, core6, core7, core8 ];

        let l3_1 = view.getUint16(20, true);
        let l3_2 = view.getUint16(22, true);
        this.temperature_l3 = [ l3_1, l3_2 ];

        this.average_gfx_activity = view.getUint16(24, true);
        this.average_mm_activity = view.getUint16(26, true);

        this.system_clock_counter = view.getBigUint64(28, true);

        this.average_socket_power = view.getUint16(36, true);
        this.average_cpu_power = view.getUint16(38, true);
        this.average_soc_power = view.getUint16(40, true);
        this.average_gfx_power = view.getUint16(42, true);
        let core_power_1 = view.getUint16(44, true);
        let core_power_2 = view.getUint16(46, true);
        let core_power_3 = view.getUint16(48, true);
        let core_power_4 = view.getUint16(50, true);
        let core_power_5 = view.getUint16(52, true);
        let core_power_6 = view.getUint16(54, true);
        let core_power_7 = view.getUint16(56, true);
        let core_power_8 = view.getUint16(58, true);
        this.average_core_power = [ core_power_1, core_power_2, core_power_3, core_power_4, core_power_5, core_power_6, core_power_7, core_power_8 ];

        this.average_gfxclk_frequency = view.getUint16(60, true);
        this.average_socclk_frequency = view.getUint16(62, true);
        this.average_uclk_frequency = view.getUint16(64, true);
        this.average_fclk_frequency = view.getUint16(66, true);
        this.average_vclk_frequency = view.getUint16(68, true);
        this.average_dclk_frequency = view.getUint16(70, true);

        this.current_gfxclk = view.getUint16(72, true);
        this.current_socclk = view.getUint16(74, true);
        this.current_uclk = view.getUint16(76, true);
        this.current_fclk = view.getUint16(78, true);
        this.current_vclk = view.getUint16(80, true);
        this.current_dclk = view.getUint16(82, true);
        let coreclk_1 = view.getUint16(84, true);
        let coreclk_2 = view.getUint16(86, true);
        let coreclk_3 = view.getUint16(88, true);
        let coreclk_4 = view.getUint16(90, true);
        let coreclk_5 = view.getUint16(92, true);
        let coreclk_6 = view.getUint16(94, true);
        let coreclk_7 = view.getUint16(96, true);
        let coreclk_8 = view.getUint16(98, true);
        this.current_coreclk = [ coreclk_1, coreclk_2, coreclk_3, coreclk_4, coreclk_5, coreclk_6, coreclk_7, coreclk_8 ];
        let l3clk_1 = view.getUint16(100, true);
        let l3clk_2 = view.getUint16(102, true);
        this.current_l3clk = [ l3clk_1, l3clk_2 ];

        this.throttle_status = view.getUint32(104, true);

        this.fan_pwm = view.getUint16(108, true);

        let padding_1 = view.getUint16(110, true);
        let padding_2 = view.getUint16(112, true);
        let padding_3 = view.getUint16(114, true);
        this.padding = [ padding_1, padding_2, padding_3 ];
    }
}
