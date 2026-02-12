class LocalGrowBoxPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._initialized = false;
        this._activeTab = 'overview'; // 'overview', 'settings', 'phases'
    }

    set hass(hass) {
        this._hass = hass;
        this._update();
    }

    set narrow(narrow) {
        this._narrow = narrow;
        this._update();
    }

    set panel(panel) {
        this._panel = panel;
        this._update();
    }

    _update() {
        if (!this._hass) return;

        // Initialize fetching devices once
        if (!this._initialized) {
            this._initialized = true;
            this._fetchDevices();
        }

        // Re-render if we have devices to show status updates
        if (this._devices) {
            this._render();
        }
    }

    async _fetchDevices() {
        if (!this._hass) return;

        try {
            const devices = await this._hass.callWS({ type: 'config/device_registry/list' });
            const entities = await this._hass.callWS({ type: 'config/entity_registry/list' });
            const entries = await this._hass.callWS({ type: 'config_entries/get', domain: 'local_grow_box' });

            // Filter: Look for devices with identifiers matching our domain
            const myDevices = devices.filter(d =>
                d.identifiers && d.identifiers.some(id => id[0] === 'local_grow_box')
            );

            this._devices = myDevices.map(device => {
                const deviceEntities = entities.filter(e => e.device_id === device.id);
                // Find config entry for this device (to get Entry ID for updates)
                const entry = entries.find(e => e.entry_id === device.primary_config_entry);

                const findEntity = (uniqueIdSuffix) => {
                    const ent = deviceEntities.find(e => e.unique_id.endsWith(uniqueIdSuffix));
                    return ent ? ent.entity_id : null;
                };

                return {
                    name: device.name_by_user || device.name,
                    id: device.id,
                    entryId: entry ? entry.entry_id : null,
                    options: (entry && entry.options) ? entry.options : {}, // Ensure options is always an object
                    entities: {
                        phase: findEntity('_phase'),
                        master: findEntity('_master_switch'),
                        vpd: findEntity('_vpd'),
                        pump: findEntity('_water_pump'),
                        days: findEntity('_days_in_phase'),
                    }
                };
            });

            this._render();
        } catch (err) {
            console.error("Error fetching grow boxes:", err);
        }
    }

    _render() {
        const root = this.shadowRoot;
        // Basic CSS
        const style = `
            <style>
                :host {
                    --primary-color: #03a9f4;
                    --accent-color: #009688;
                    --text-primary-color: #ffffff;
                    --card-bg: #1c1c1e;
                    --primary-text: #ffffff;
                    --secondary-text: #b0b0b0;
                    --success-color: #4caf50;
                    --warning-color: #ff9800;
                    --danger-color: #f44336;
                    --info-color: #2196f3;
                    
                    --grad-success: linear-gradient(90deg, #66bb6a, #43a047);
                    --grad-warning: linear-gradient(90deg, #ffa726, #fb8c00);
                    --grad-danger: linear-gradient(90deg, #ef5350, #e53935);
                    --grad-info: linear-gradient(90deg, #42a5f5, #1e88e5);
                    --grad-inactive: linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));

                    display: block;
                    background-color: #121212;
                    min-height: 100vh;
                    font-family: 'Roboto', 'Segoe UI', sans-serif;
                    color: var(--primary-text);
                    padding-bottom: 40px;
                }
                .header {
                    background: linear-gradient(135deg, #0288d1, #00796b);
                    color: var(--text-primary-color);
                    padding: 0; /* Padding handled by toolbar */
                    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                    margin-bottom: 24px;
                }
                .toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 24px;
                }
                .toolbar h1 {
                    margin: 0;
                    font-size: 28px;
                    font-weight: 300;
                    letter-spacing: 0.5px;
                }
                .tabs {
                    display: flex;
                    background: rgba(0,0,0,0.2);
                }
                .tab {
                    flex: 1;
                    padding: 16px;
                    text-align: center;
                    cursor: pointer;
                    text-transform: uppercase;
                    font-weight: 500;
                    letter-spacing: 1px;
                    transition: background 0.3s;
                    border-bottom: 3px solid transparent;
                    color: rgba(255,255,255,0.7);
                }
                .tab:hover {
                    background: rgba(255,255,255,0.1);
                    color: white;
                }
                .tab.active {
                    border-bottom-color: var(--accent-color);
                    color: white;
                    background: rgba(255,255,255,0.05);
                }

                .add-btn {
                    background: rgba(255,255,255,0.15);
                    color: white;
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 28px;
                    cursor: pointer;
                    transition: all 0.3s;
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255,255,255,0.2);
                }
                .add-btn:hover {
                    background: rgba(255,255,255,0.3);
                    transform: scale(1.1);
                }

                /* Content Areas */
                .content {
                    padding: 0 24px;
                    display: none; /* Hidden by default */
                }
                .content.active {
                    display: grid;
                }
                .grid-view {
                    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
                    gap: 24px;
                }
                .list-view {
                    grid-template-columns: 1fr;
                    gap: 16px;
                    max-width: 800px;
                    margin: 0 auto;
                }

                /* Cards (Overview) */
                .card {
                    background-color: var(--card-bg);
                    border-radius: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    transition: transform 0.3s, box-shadow 0.3s;
                    border: 1px solid rgba(255,255,255,0.08); 
                    height: 100%;
                }
                .card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
                    border-color: rgba(255,255,255,0.15);
                }
                .card-header {
                    padding: 18px 24px;
                    background: rgba(255,255,255,0.03);
                    font-size: 18px;
                    font-weight: 500;
                    letter-spacing: 0.5px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                }
                .card-image {
                    height: 220px;
                    background-color: #2c2c2e;
                    background-size: cover;
                    background-position: center;
                    position: relative;
                }
                .card-image-overlay {
                    position: absolute;
                    bottom: 0; left: 0; right: 0;
                    padding: 12px;
                    background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
                    color: white;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .live-badge {
                    background: rgba(244, 67, 54, 0.85);
                    padding: 4px 8px; border-radius: 6px; font-size: 11px;
                    font-weight: bold; text-transform: uppercase;
                    display: flex; align-items: center; gap: 6px;
                }
                .live-badge::before {
                    content: ''; display: block; width: 6px; height: 6px;
                    background: white; border-radius: 50%;
                }
                .card-content {
                    padding: 24px; flex: 1; display: flex; flex-direction: column;
                }
                .sensor-row {
                    display: flex; align-items: center; margin-bottom: 24px;
                }
                .sensor-icon {
                    width: 40px; height: 40px; margin-right: 20px;
                    font-size: 24px; display: flex; align-items: center; justify-content: center;
                    background: rgba(255,255,255,0.05); border-radius: 50%;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .sensor-data { flex: 1; }
                .sensor-label { font-size: 11px; text-transform: uppercase; opacity: 0.6; }
                .sensor-value { font-size: 18px; font-weight: 600; float: right; }
                .sensor-bar-container { background: rgba(255,255,255,0.08); height: 10px; border-radius: 5px; margin-top: 10px; overflow:hidden;}
                .sensor-bar-fill { height: 100%; border-radius: 5px; }
                .grad-vpd { background: linear-gradient(90deg, #29b6f6, #66bb6a, #ef5350); }

                /* Sensor Grid */
                .sensor-grid {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 20px 32px;
                    margin-top: auto; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.08);
                }
                .sensor-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
                .sensor-icon-small { font-size: 22px; width: 28px; text-align: center; color: var(--secondary-text); }
                .sensor-data-row { flex: 1; display: flex; align-items: center; gap: 16px; }
                .sensor-bar-segmented { display: flex; gap: 4px; height: 8px; flex: 1; min-width: 50px; }
                .bar-segment {
                    flex: 1; height: 100%; background: rgba(255,255,255,0.1); border-radius: 2px;
                }
                .sensor-val-main { font-weight: 500; font-size: 15px; white-space: nowrap; text-align: right; min-width: 60px; color: #fff; }
                .sensor-unit { font-size: 0.85em; opacity: 0.6; font-weight: normal; }

                /* Controls */
                .controls {
                    display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; background: rgba(0,0,0,0.1);
                }
                .control-btn {
                    cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;
                    padding: 16px; border-radius: 16px; transition: all 0.2s; background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .control-btn:hover { background: rgba(255,255,255,0.1); transform: translateY(-2px); }
                .control-btn.active {
                    background: linear-gradient(135deg, var(--primary-color), var(--info-color));
                    color: white; border: none;
                }
                .control-icon { font-size: 32px; margin-bottom: 8px; color: #757575; }
                .control-btn.active .control-icon { color: white; }

                /* Settings Cards */
                .settings-card {
                     background-color: var(--card-bg);
                     border-radius: 16px;
                     padding: 24px;
                     border: 1px solid rgba(255,255,255,0.1);
                }
                .settings-card h3 { margin-top: 0; font-weight: 400; color: var(--primary-color); border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px; }
                
                .setting-row { margin-bottom: 16px; }
                .setting-label { display: block; font-size: 12px; text-transform: uppercase; color: var(--secondary-text); margin-bottom: 6px; letter-spacing: 0.5px; }
                
                select, input {
                    padding: 12px 14px;
                    border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.1);
                    background: #2c2c2e;
                    color: white;
                    font-size: 14px;
                    width: 100%;
                    outline: none;
                    box-sizing: border-box;
                }
                select:focus, input:focus { border-color: var(--primary-color); }
                
                .save-btn {
                    width: 100%;
                    padding: 14px;
                    background: var(--primary-color);
                    border: none; border-radius: 8px;
                    color: white; font-weight: 600; font-size: 14px;
                    cursor: pointer; margin-top: 10px;
                    transition: filter 0.2s;
                }
                .save-btn:hover { filter: brightness(1.1); }

                .input-group { display: flex; gap: 12px; align-items: flex-end; }
                .input-group > div { flex: 1; }

                /* Modals & Inputs from before */
                .modal-backdrop {
                    background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px);
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    display: none; justify-content: center; align-items: center; z-index: 100;
                }
                .modal-backdrop.open { display: flex; }
                .modal {
                    background: #2c2c2e; padding: 32px; width: 90%; max-width: 480px;
                    border-radius: 24px; border: 1px solid rgba(255,255,255,0.1);
                }
                .modal-actions { display: flex; justify-content: flex-end; gap: 16px; margin-top: 32px; }
                .modal-btn { padding: 12px 24px; border-radius: 12px; border:none; cursor: pointer; font-weight: 600; }
                .modal-btn.confirm { background: var(--primary-color); color: white; }
                .modal-btn.cancel { background: rgba(255,255,255,0.1); color: white; }
                input[type="file"] { display: none; }
                .edit-image-btn { 
                    width: 28px; height: 28px; border-radius: 50%; background:rgba(0,0,0,0.6); 
                    display:flex; align-items:center; justify-content:center; cursor:pointer; 
                    border: 1px solid white; transition: transform 0.2s;
                }
                .edit-image-btn:hover{ transform: scale(1.1); }
            </style>
        `;

        if (!this._devices) return; // Wait for data

        // --- Render Helpers ---

        const renderOverview = () => {
            return this._devices.map((device, index) => {
                // Fetch States & Attrs
                const masterState = this._hass.states[device.entities.master];
                const daysState = this._hass.states[device.entities.days];
                const phaseState = this._hass.states[device.entities.phase];
                const vpdState = this._hass.states[device.entities.vpd];
                const pumpState = this._hass.states[device.entities.pump];

                // Values
                const tempEntity = masterState?.attributes?.temp_sensor;
                const humidityEntity = masterState?.attributes?.humidity_sensor;
                const lightEntity = masterState?.attributes?.light_entity;
                const fanEntity = masterState?.attributes?.fan_entity;

                const tempVal = this._hass.states[tempEntity]?.state;
                const humVal = this._hass.states[humidityEntity]?.state;
                const lightVal = this._hass.states[lightEntity]?.state;
                const fanVal = this._hass.states[fanEntity]?.state;
                const currentPhase = phaseState?.state || 'vegetative';

                // Phase Options - Mix standard and custom
                const phases = ['seedling', 'vegetative', 'flowering', 'drying', 'curing'];
                // Add custom phases if defined in options
                // Add custom phases if defined in options
                if (device.options) {
                    ['custom1', 'custom2', 'custom3'].forEach(c => {
                        const name = device.options[`${c}_phase_name`];
                        if (name) phases.push(name);
                    });
                }

                const phaseTranslations = {
                    'seedling': 'Keimling', 'vegetative': 'Wachstum', 'flowering': 'Blüte', 'drying': 'Trocknen', 'curing': 'Veredelung'
                };

                // Image
                const timestamp = new Date().getTime();
                let imageUrl = `/local/local_grow_box_images/${device.id}.jpg?t=${timestamp}`;
                let isLive = false;
                if (masterState?.attributes?.camera_entity) {
                    const camState = this._hass.states[masterState.attributes.camera_entity];
                    if (camState) {
                        imageUrl = camState.attributes.entity_picture || `/api/camera_proxy_stream/${masterState.attributes.camera_entity}`;
                        isLive = true;
                    }
                }

                // Helpers for Status Bars
                const getStatus = (t, v) => {
                    if (!v || v === 'unavailable') return { color: 'var(--grad-inactive)', level: 0 };
                    v = parseFloat(v);
                    if (t === 'temp') {
                        if (v < 18) return { color: 'var(--grad-info)', level: 1 };
                        if (v > 28) return { color: 'var(--grad-danger)', level: 4 };
                        return { color: 'var(--grad-success)', level: 3 };
                    }
                    if (t === 'hum') {
                        if (v < 40) return { color: 'var(--grad-warning)', level: 1 };
                        if (v > 70) return { color: 'var(--grad-danger)', level: 4 };
                        return { color: 'var(--grad-success)', level: 3 };
                    }
                    return { color: 'var(--grad-success)', level: 2 };
                };

                const renderBar = (icon, val, unit, status) => {
                    let segs = '';
                    for (let i = 1; i <= 4; i++) {
                        segs += `<div class="bar-segment" style="${i <= status.level ? `background:${status.color}; box-shadow:0 0 6px ${status.color};` : ''}"></div>`;
                    }
                    return `<div class="sensor-item"><div class="sensor-icon-small">${icon}</div><div class="sensor-data-row"><div class="sensor-bar-segmented">${segs}</div><span class="sensor-val-main">${val || '--'} <span class="sensor-unit">${unit}</span></span></div></div>`;
                };

                return `
                    <div class="card">
                        <div class="card-header">
                            <span>${device.name}</span>
                            <span>${daysState?.state || '0'} Tage</span>
                        </div>
                        <div class="card-image">
                            <img src="${imageUrl}" onerror="this.onerror=null;this.src='/local/growbox-default.jpg';" style="width:100%;height:100%;object-fit:cover;">
                            <div class="card-image-overlay">
                                ${!isLive ? `<div class="edit-image-btn" id="edit-img-${index}">✎</div><input type="file" id="file-${index}" accept="image/*">` : '<div></div>'}
                                <span class="live-badge" style="${!isLive ? 'background:#607d8b;' : ''}">${isLive ? 'LIVE' : 'BILD'}</span>
                            </div>
                        </div>
                        <div class="card-content">
                            <div class="sensor-row">
                                <div class="sensor-icon">🌱</div>
                                <div class="sensor-data">
                                    <span class="sensor-label">Phase</span>
                                    <select id="phase-${index}" data-entity="${device.entities.phase}" style="margin-top:4px;">
                                        ${phases.map(o => `<option value="${o}" ${o === currentPhase ? 'selected' : ''}>${phaseTranslations[o] || o}</option>`).join('')}
                                    </select>
                                </div>
                            </div>
                            <!-- VPD Bar -->
                            <div class="sensor-row">
                                <div class="sensor-icon">💧</div>
                                <div class="sensor-data">
                                   <div style="display:flex;justify-content:space-between;"><span class="sensor-label">VPD</span><span class="sensor-value">${vpdState?.state || '--'} <small>kPa</small></span></div>
                                   <div class="sensor-bar-container"><div class="sensor-bar-fill grad-vpd" style="width:${Math.min(100, Math.max(0, (parseFloat(vpdState?.state) || 0) / 3 * 100))}%"></div></div>
                                </div>
                            </div>
                            <div class="sensor-grid">
                                ${renderBar('🌡️', tempVal, '°C', getStatus('temp', tempVal))}
                                ${renderBar('☁️', humVal, '%', getStatus('hum', humVal))}
                            </div>
                            <!-- Extra Sensors Row 2 -->
                            <div class="sensor-grid" style="border-top:none; padding-top:0; margin-top:20px;">
                                ${(() => {
                        const moistVal = this._hass.states[device.options.moisture_sensor]?.state;
                        return renderBar('💧', moistVal, '%', getStatus('hum', moistVal)); // Reuse hum status logic for now
                    })()}
                                
                                <div class="sensor-item">
                                    <div class="sensor-icon-small">💡</div>
                                    <div style="flex:1;">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                             <span style="font-weight:500; font-size:15px; color:${lightVal === 'on' ? 'var(--warning-color)' : '#fff'}">${lightVal === 'on' ? 'AN' : 'AUS'}</span>
                                             <span style="font-size:11px; opacity:0.6;">Start: ${device.options.light_start_hour || 6}:00</span>
                                        </div>
                                        <div class="sensor-bar-segmented" style="height:4px; margin-top:6px; opacity:0.5;">
                                            <div class="bar-segment" style="background:${lightVal === 'on' ? 'var(--warning-color)' : 'rgba(255,255,255,0.2)'}"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="controls">
                             <div class="control-btn ${masterState?.state === 'on' ? 'active' : ''}" id="master-${index}" data-entity="${device.entities.master}"><div class="control-icon">🔌</div><span>Master</span></div>
                             <div class="control-btn ${pumpState?.state === 'on' ? 'active' : ''}" id="pump-${index}" data-entity="${device.entities.pump}"><div class="control-icon">🚿</div><span>Pumpe</span></div>
                             <div class="control-btn" id="settings-nav-${index}"><div class="control-icon">⚙️</div><span>Einst.</span></div>
                        </div>
                    </div>
                 `;
            }).join('');
        };

        const renderSettings = () => {
            const allEntities = Object.keys(this._hass.states).sort();
            const filterDomain = (d) => allEntities.filter(e => e.startsWith(d));
            const switches = [...filterDomain('switch.'), ...filterDomain('light.')];
            const fans = [...filterDomain('switch.'), ...filterDomain('fan.')];
            const cameras = filterDomain('camera.');
            const sensors = filterDomain('sensor.');

            const renderSelect = (label, id, value, options) => `
                <div class="setting-row">
                    <label class="setting-label">${label}</label>
                    <select id="${id}">
                         <option value="">-- Wählen --</option>
                         ${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${this._hass.states[o].attributes.friendly_name || o}</option>`).join('')}
                    </select>
                </div>
             `;

            return this._devices.map((device, index) => {
                const masterState = this._hass.states[device.entities.master];
                const attrs = masterState?.attributes || {};

                return `
                    <div class="settings-card">
                        <h3>${device.name} - Geräte</h3>
                        ${renderSelect('Licht-Steuerung', `cfg-light-${index}`, attrs.light_entity, switches)}
                        ${renderSelect('Abluft-Ventilator', `cfg-fan-${index}`, attrs.fan_entity, fans)}
                        ${renderSelect('Wasserpumpe', `cfg-pump-${index}`, attrs.pump_entity, filterDomain('switch.'))}
                        ${renderSelect('Kamera', `cfg-camera-${index}`, attrs.camera_entity, cameras)}
                        ${renderSelect('Temperatur Sensor', `cfg-temp-${index}`, attrs.temp_sensor, sensors)}
                        ${renderSelect('Luftfeuchtigkeit Sensor', `cfg-hum-${index}`, attrs.humidity_sensor, sensors)}
                        ${renderSelect('Bodenfeuchte Sensor', `cfg-mois-${index}`, device.options.moisture_sensor, sensors)}
                        
                        <div class="setting-row" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
                             <div>
                                <label class="setting-label">Ziel-Temp (°C)</label>
                                <input type="number" id="cfg-target-temp-${index}" value="${attrs.target_temp || 24}" style="width:100%;">
                             </div>
                             <div>
                                <label class="setting-label">Max. Feuchte (%)</label>
                                <input type="number" id="cfg-target-hum-${index}" value="${attrs.max_humidity || 60}" style="width:100%;">
                             </div>
                        </div>

                        <div class="setting-row" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:16px;">
                             <div>
                                <label class="setting-label">Ziel-Boden (%)</label>
                                <input type="number" id="cfg-target-mois-${index}" value="${device.options.target_moisture || 40}" style="width:100%;">
                             </div>
                             <div>
                                <label class="setting-label">Pumpen-Laufzeit (s)</label>
                                <input type="number" id="cfg-pump-dur-${index}" value="${device.options.pump_duration || 30}" style="width:100%;">
                             </div>
                             <div>
                                <label class="setting-label">Licht-Start (Std)</label>
                                <input type="number" id="cfg-light-start-${index}" value="${device.options.light_start_hour || 6}" style="width:100%;">
                             </div>
                        </div>

                        <button class="save-btn" id="save-cfg-${index}" data-entry="${device.entryId}">Speichern</button>
                    </div>
                  `;
            }).join('');
        };

        const renderPhases = () => {
            return this._devices.map((device, index) => {
                const opts = device.options;

                const renderPhaseInput = (label, key, defaultVal) => `
                    <div class="setting-row">
                        <label class="setting-label">${label} (Licht-Std.)</label>
                        <input type="number" id="ph-${key}-${index}" value="${opts[`phase_${key}_hours`] || defaultVal}" placeholder="${defaultVal}">
                    </div>
                `;

                const renderCustomPhase = (num) => `
                    <div class="setting-row" style="border-top:1px solid rgba(255,255,255,0.05); padding-top:12px;">
                        <label class="setting-label">Benutzerdefinierte Phase ${num}</label>
                        <div class="input-group">
                            <div>
                                <input type="text" id="ph-c${num}-name-${index}" value="${opts[`custom${num}_phase_name`] || ''}" placeholder="Name (z.B. Late Bloom)">
                            </div>
                            <div style="flex:0.5;">
                                <input type="number" id="ph-c${num}-hours-${index}" value="${opts[`custom${num}_phase_hours`] || 0}" placeholder="Std.">
                            </div>
                        </div>
                    </div>
                `;

                return `
                    <div class="settings-card">
                        <h3>${device.name} - Phasen</h3>
                        <p style="font-size:13px; color:gray; margin-bottom:16px;">Definieren Sie hier, wie viele Stunden das Licht in welcher Phase an sein soll (0-24).</p>
                        
                        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px;">
                            ${renderPhaseInput('Keimling', 'seedling', 18)}
                            ${renderPhaseInput('Wachstum', 'vegetative', 18)}
                            ${renderPhaseInput('Blüte', 'flowering', 12)}
                        </div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                            ${renderPhaseInput('Trocknen', 'drying', 0)}
                            ${renderPhaseInput('Veredelung', 'curing', 0)}
                        </div>

                        ${renderCustomPhase(1)}
                        ${renderCustomPhase(2)}
                        ${renderCustomPhase(3)}

                        <button class="save-btn" id="save-phases-${index}">Speichern</button>
                    </div>
                `;
            }).join('');
        };

        // --- View HTML ---
        root.innerHTML = `
            ${style}
            <div class="header">
                <div class="toolbar">
                    <h1>Mein Anbauraum</h1>
                    <div class="add-btn" id="add-plant-nav">+</div>
                </div>
                <div class="tabs">
                    <div class="tab ${this._activeTab === 'overview' ? 'active' : ''}" id="tab-overview">Übersicht</div>
                    <div class="tab ${this._activeTab === 'settings' ? 'active' : ''}" id="tab-settings">Geräte</div>
                    <div class="tab ${this._activeTab === 'phases' ? 'active' : ''}" id="tab-phases">Phasen</div>
                </div>
            </div>
            
            <div class="content ${this._activeTab === 'overview' ? 'active' : ''} grid-view" id="view-overview">
                ${this._devices && this._devices.length ? renderOverview() : '<p style="color:gray;text-align:center;width:100%;">Keine Boxen gefunden.</p>'}
            </div>

            <div class="content ${this._activeTab === 'settings' ? 'active' : ''} list-view" id="view-settings">
                 ${this._devices ? renderSettings() : ''}
            </div>

            <div class="content ${this._activeTab === 'phases' ? 'active' : ''} list-view" id="view-phases">
                 ${this._devices ? renderPhases() : ''}
            </div>

            <div class="modal-backdrop" id="add-modal">
                <div class="modal">
                    <h2>Neue Pflanze</h2>
                    <p>Neue Box in den Einstellungen anlegen?</p>
                    <div class="modal-actions">
                        <button class="modal-btn cancel" id="modal-cancel">Abbrechen</button>
                        <button class="modal-btn confirm" id="modal-confirm">Ja, anlegen</button>
                    </div>
                </div>
            </div>
        `;

        // --- Event Listeners ---

        // Tab Navigation
        root.getElementById('tab-overview').addEventListener('click', () => { this._activeTab = 'overview'; this._render(); });
        root.getElementById('tab-settings').addEventListener('click', () => { this._activeTab = 'settings'; this._render(); });
        root.getElementById('tab-phases').addEventListener('click', () => { this._activeTab = 'phases'; this._render(); });

        // Add Modal
        root.getElementById('add-plant-nav').addEventListener('click', () => root.getElementById('add-modal').classList.add('open'));
        root.getElementById('modal-cancel').addEventListener('click', () => root.getElementById('add-modal').classList.remove('open'));
        root.getElementById('modal-confirm').addEventListener('click', () => {
            history.pushState(null, "", "/config/integrations/dashboard");
            this.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
        });

        if (this._devices) {
            this._devices.forEach((d, i) => {
                if (this._activeTab === 'overview') {
                    root.getElementById(`master-${i}`)?.addEventListener('click', () => this._hass.callService("homeassistant", "toggle", { entity_id: d.entities.master }));
                    root.getElementById(`pump-${i}`)?.addEventListener('click', () => this._hass.callService("homeassistant", "toggle", { entity_id: d.entities.pump }));
                    root.getElementById(`phase-${i}`)?.addEventListener('change', (e) => this._hass.callService("select", "select_option", { entity_id: d.entities.phase, option: e.target.value }));

                    const fileInput = root.getElementById(`file-${i}`);
                    root.getElementById(`edit-img-${i}`)?.addEventListener('click', () => fileInput.click());
                    fileInput?.addEventListener('change', (e) => {
                        if (e.target.files[0]) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                this._hass.callWS({ type: 'local_grow_box/upload_image', device_id: d.id, image: ev.target.result })
                                    .then(() => setTimeout(() => this._render(), 1000));
                            };
                            reader.readAsDataURL(e.target.files[0]);
                        }
                    });
                    root.getElementById(`settings-nav-${i}`)?.addEventListener('click', () => { this._activeTab = 'settings'; this._render(); });
                }

                if (this._activeTab === 'settings') {
                    root.getElementById(`save-cfg-${i}`)?.addEventListener('click', () => {
                        const cfg = {
                            light_entity: root.getElementById(`cfg-light-${i}`).value,
                            fan_entity: root.getElementById(`cfg-fan-${i}`).value,
                            pump_entity: root.getElementById(`cfg-pump-${i}`).value,
                            camera_entity: root.getElementById(`cfg-camera-${i}`).value,
                            temp_sensor: root.getElementById(`cfg-temp-${i}`).value,
                            humidity_sensor: root.getElementById(`cfg-hum-${i}`).value,
                            target_temp: parseFloat(root.getElementById(`cfg-target-temp-${i}`).value),
                            max_humidity: parseFloat(root.getElementById(`cfg-target-hum-${i}`).value),
                            moisture_sensor: root.getElementById(`cfg-mois-${i}`).value,
                            target_moisture: parseFloat(root.getElementById(`cfg-target-mois-${i}`).value),
                            pump_duration: parseInt(root.getElementById(`cfg-pump-dur-${i}`).value),
                            light_start_hour: parseInt(root.getElementById(`cfg-light-start-${i}`).value),
                        };
                        this._saveConfig(d.entryId, cfg);
                    });
                }

                if (this._activeTab === 'phases') {
                    root.getElementById(`save-phases-${i}`)?.addEventListener('click', () => {
                        const cfg = {
                            phase_seedling_hours: parseInt(root.getElementById(`ph-seedling-${i}`).value),
                            phase_vegetative_hours: parseInt(root.getElementById(`ph-vegetative-${i}`).value),
                            phase_flowering_hours: parseInt(root.getElementById(`ph-flowering-${i}`).value),
                            phase_drying_hours: parseInt(root.getElementById(`ph-drying-${i}`).value),
                            phase_curing_hours: parseInt(root.getElementById(`ph-curing-${i}`).value),

                            custom1_phase_name: root.getElementById(`ph-c1-name-${i}`).value,
                            custom1_phase_hours: parseInt(root.getElementById(`ph-c1-hours-${i}`).value),
                            custom2_phase_name: root.getElementById(`ph-c2-name-${i}`).value,
                            custom2_phase_hours: parseInt(root.getElementById(`ph-c2-hours-${i}`).value),
                            custom3_phase_name: root.getElementById(`ph-c3-name-${i}`).value,
                            custom3_phase_hours: parseInt(root.getElementById(`ph-c3-hours-${i}`).value),
                        };
                        this._saveConfig(d.entryId, cfg);
                    });
                }
            });
        }
    }

    async _saveConfig(entryId, config) {
        try {
            await this._hass.callWS({
                type: 'local_grow_box/update_config',
                entry_id: entryId,
                config: config
            });
            alert('Gespeichert!');
            // Refresh logic to show new phases in dropdown immediately
            this._fetchDevices();
        } catch (err) {
            alert('Fehler: ' + err.message);
        }
    }
}
customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
