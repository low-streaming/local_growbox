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

        // Re-render logic
        if (this._devices) {
            // If we are in Settings or Phases, DO NOT blow away the DOM on every state update.
            // The user is likely typing or selecting.
            if (this._activeTab === 'settings' || this._activeTab === 'phases') {
                // But we MUST update the hass object on pickers so they can search
                if (this.shadowRoot) {
                    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(picker => {
                        picker.hass = this._hass;
                    });
                }
                return;
            }

            // In Overview, we want live updates, but maybe debounce or check logic?
            // for now, just render is fine as it's read-only
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
                const entry = entries.find(e => e.entry_id === device.primary_config_entry);

                const findEntity = (uniqueIdSuffix) => {
                    const ent = deviceEntities.find(e => e.unique_id.endsWith(uniqueIdSuffix));
                    return ent ? ent.entity_id : null;
                };

                return {
                    name: device.name_by_user || device.name,
                    id: device.id,
                    entryId: entry ? entry.entry_id : null,
                    options: (entry) ? { ...entry.data, ...entry.options } : {},
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
        if (!this.shadowRoot) return;

        // If we haven't created the basic structure yet
        if (!this.shadowRoot.querySelector('.header')) {
            this._renderStructure();
        }

        this._updateContent();
    }

    _renderStructure() {
        const style = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
                
                :host {
                    --primary-color: #03a9f4;
                    --accent-color: #ff9800;
                    --bg-color: #111827;
                    --card-bg: #1f2937;
                    --text-primary: #f9fafb;
                    --text-secondary: #9ca3af;
                    --success-color: #10b981;
                    --danger-color: #ef4444;
                    font-family: 'Roboto', sans-serif;
                    display: block;
                    background-color: var(--bg-color);
                    min-height: 100vh;
                    color: var(--text-primary);
                }
                
                /* Layout */
                .header {
                    background-color: var(--card-bg);
                    padding: 16px 24px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .header h1 { margin: 0; font-size: 20px; font-weight: 500; color: var(--primary-color); }
                
                .tabs { display: flex; gap: 24px; margin-left: 48px; }
                .tab { 
                    cursor: pointer; padding: 8px 0; border-bottom: 2px solid transparent; 
                    opacity: 0.6; transition: all 0.2s; text-transform: uppercase; font-size: 14px; font-weight: 500; 
                }
                .tab:hover { opacity: 1; }
                .tab.active { opacity: 1; border-bottom-color: var(--primary-color); color: var(--primary-color); }

                .content { padding: 24px; max-width: 1200px; margin: 0 auto; }
                
                /* Cards */
                .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 24px; }
                
                .card {
                    background: var(--card-bg);
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    border: 1px solid rgba(255,255,255,0.05);
                }
                
                .card-image {
                    height: 200px; background: #000; position: relative;
                }
                .card-image img { width: 100%; height: 100%; object-fit: cover; opacity: 0.8; }
                .live-badge {
                    position: absolute; top: 12px; right: 12px;
                    background: rgba(220, 38, 38, 0.9); padding: 4px 8px;
                    border-radius: 4px; font-size: 10px; font-weight: bold;
                }
                
                .card-header {
                    padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05);
                    display: flex; justify-content: space-between; align-items: center;
                }
                .card-title { font-size: 18px; font-weight: 500; }
                .card-subtitle { font-size: 12px; color: var(--text-secondary); }
                
                .card-body { padding: 16px; }
                
                .stat-row { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center; }
                .stat-label { color: var(--text-secondary); font-size: 13px; display: flex; align-items: center; gap: 8px; }
                .stat-value { font-weight: 500; font-size: 15px; }
                
                .bar-bg { height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-top: 4px; }
                .bar-fill { height: 100%; border-radius: 3px; background: var(--primary-color); }
                
                /* Controls */
                .controls { padding: 16px; background: rgba(0,0,0,0.2); display: flex; gap: 8px; }
                .btn {
                    flex: 1; padding: 10px; border-radius: 8px; border: none; cursor: pointer;
                    background: rgba(255,255,255,0.1); color: var(--text-primary);
                    font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;
                    transition: background 0.2s;
                }
                .btn:hover { background: rgba(255,255,255,0.15); }
                .btn.active { background: var(--primary-color); color: white; }
                
                /* Settings Form */
                .settings-section { background: var(--card-bg); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
                .section-title { font-size: 16px; color: var(--primary-color); margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
                
                .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
                .form-group { margin-bottom: 16px; }
                .form-label { display: block; margin-bottom: 6px; font-size: 12px; color: var(--text-secondary); text-transform: uppercase; }
                
                input, select {
                    width: 100%; padding: 10px; background: #111827; border: 1px solid rgba(255,255,255,0.1);
                    color: white; border-radius: 6px; box-sizing: border-box;
                }
                
                /* HA Entity Picker override */
                ha-entity-picker {
                    display: block; width: 100%;
                }
                
                .save-bar {
                    position: fixed; bottom: 20px; right: 20px;
                    background: var(--success-color); color: white;
                    padding: 12px 24px; border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    transform: translateY(100px); transition: transform 0.3s;
                    display: flex; align-items: center; gap: 8px;
                }
                .save-bar.visible { transform: translateY(0); }
                
                .fab {
                    position: fixed; bottom: 24px; right: 24px;
                    width: 56px; height: 56px; border-radius: 50%;
                    background: var(--primary-color); color: white;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    cursor: pointer; z-index: 100;
                }
            </style>
            
            <div class="header">
                <div style="display:flex; align-items:center;">
                    <h1>GROW ROOM</h1>
                    <div class="tabs">
                        <div class="tab active" data-tab="overview">Übersicht</div>
                        <div class="tab" data-tab="settings">Geräte & Config</div>
                        <div class="tab" data-tab="phases">Phasen</div>
                    </div>
                </div>
            </div>
            
            <div class="content" id="main-content">
                <!-- Injected via JS -->
            </div>
            
            <div class="save-bar" id="save-toast">
                <span>✅ Einstellungen gespeichert!</span>
            </div>
        `;

        this.shadowRoot.innerHTML = style;

        // Tab Event Listeners
        this.shadowRoot.querySelectorAll('.tab').forEach(t => {
            t.addEventListener('click', (e) => {
                this._activeTab = e.target.dataset.tab;

                // Update UI
                this.shadowRoot.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                e.target.classList.add('active');

                this._updateContent();
            });
        });
    }

    _updateContent() {
        const container = this.shadowRoot.getElementById('main-content');
        if (!container || !this._devices) return;

        container.innerHTML = '';

        if (this._activeTab === 'overview') {
            this._renderOverview(container);
        } else if (this._activeTab === 'settings') {
            this._renderSettings(container);
        } else if (this._activeTab === 'phases') {
            this._renderPhases(container);
        }
    }

    _renderOverview(container) {
        if (this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden. Bitte Integration hinzufügen.</div>';
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'grid';

        this._devices.forEach(device => {
            const card = document.createElement('div');
            card.className = 'card';

            // Data
            const masterState = this._hass.states[device.entities.master];
            const pumpState = this._hass.states[device.entities.pump];
            const daysInPhase = this._hass.states[device.entities.days]?.state || 0;
            const phase = this._hass.states[device.entities.phase]?.state || device.options.current_phase || 'vegetative';

            // Image
            const timestamp = new Date().getTime();
            let imgUrl = `/local/local_grow_box_images/${device.id}.jpg?t=${timestamp}`;
            let isLive = false;

            // Check Camera
            if (device.options.camera_entity) {
                const cam = this._hass.states[device.options.camera_entity];
                if (cam) {
                    imgUrl = cam.attributes.entity_picture;
                    isLive = true;
                }
            }

            // Calculations for Bars
            const getVal = (entity) => {
                if (!entity) return null;
                const s = this._hass.states[entity];
                return s && !isNaN(s.state) ? parseFloat(s.state) : null;
            }

            const temp = getVal(device.options.temp_sensor);
            const hum = getVal(device.options.humidity_sensor);
            const vpd = getVal(device.entities.vpd);

            // Translations
            const phaseNames = {
                'seedling': 'Keimling', 'vegetative': 'Wachstum', 'flowering': 'Blüte', 'drying': 'Trocknen', 'curing': 'Veredelung'
            };
            const phaseDisplay = device.options[`${phase}_phase_name`] || phaseNames[phase] || phase;

            card.innerHTML = `
                <div class="card-image">
                    <img src="${imgUrl}" onerror="this.src='https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg'">
                    ${isLive ? '<div class="live-badge">LIVE</div>' : ''}
                    <div style="position:absolute; bottom:0; left:0; right:0; padding:12px; background:linear-gradient(to top, rgba(0,0,0,0.9), transparent);">
                        <div style="color:white; font-weight:500;">${phaseDisplay}</div>
                        <div style="color:var(--text-secondary); font-size:12px;">Tag ${daysInPhase}</div>
                    </div>
                </div>
                
                <div class="card-header">
                    <div class="card-title">${device.name}</div>
                    <div>${masterState && masterState.state === 'on' ? '🟢 Online' : '⚪ Offline'}</div>
                </div>
                
                <div class="card-body">
                    ${this._renderStatBar('Temperatur', temp, '°C', 18, 30, '#ef4444')}
                    ${this._renderStatBar('Luftfeuchte', hum, '%', 30, 80, '#3b82f6')}
                    ${this._renderStatBar('VPD', vpd, 'kPa', 0, 3, '#10b981')}
                </div>
                
                <div class="controls">
                    <button class="btn ${masterState?.state === 'on' ? 'active' : ''}" id="btn-master-${device.id}">
                        ⚡ Master
                    </button>
                    <button class="btn ${pumpState?.state === 'on' ? 'active' : ''}" id="btn-pump-${device.id}">
                        💧 Pumpe
                    </button>
                    <button class="btn" id="btn-upload-${device.id}">
                        📷 Bild
                    </button>
                </div>
            `;

            // Events
            const q = s => card.querySelector(s);
            q(`#btn-master-${device.id}`).onclick = () => this._toggle(device.entities.master);
            q(`#btn-pump-${device.id}`).onclick = () => this._hass.callService('homeassistant', 'toggle', { entity_id: device.entities.pump || device.options.pump_entity });
            q(`#btn-upload-${device.id}`).onclick = () => this._triggerUpload(device.id);

            grid.appendChild(card);
        });

        container.appendChild(grid);
    }

    _renderStatBar(label, val, unit, min, max, color) {
        if (val === null) return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">--</span></div>`;

        const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));

        return `
            <div style="margin-bottom:12px;">
                <div class="stat-row" style="margin-bottom:4px;">
                    <span class="stat-label">${label}</span>
                    <span class="stat-value">${val} ${unit}</span>
                </div>
                <div class="bar-bg">
                    <div class="bar-fill" style="width:${pct}%; background-color:${color};"></div>
                </div>
            </div>
        `;
    }

    _renderSettings(container) {
        this._devices.forEach(device => {
            const section = document.createElement('div');
            section.className = 'settings-section';

            const title = document.createElement('div');
            title.className = 'section-title';
            title.innerText = `${device.name} - Konfiguration`;
            section.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'form-grid';

            // Helper to create columns
            const createCol = (titleText) => {
                const div = document.createElement('div');
                const h4 = document.createElement('h4');
                h4.style.cssText = "margin:0 0 16px 0; color:var(--text-secondary);";
                h4.innerText = titleText;
                div.appendChild(h4);
                return div;
            };

            const col1 = createCol('Klima & Sensoren');
            const col2 = createCol('Bewässerung & Licht');
            const col3 = createCol('Erweitert');

            // DOM-based Helper for Picker
            const appendPicker = (parent, label, configKey, domains) => {
                const group = document.createElement('div');
                group.className = 'form-group';

                const lbl = document.createElement('label');
                lbl.className = 'form-label';
                lbl.innerText = label;
                group.appendChild(lbl);

                const picker = document.createElement('ha-entity-picker');
                picker.hass = this._hass;
                picker.value = device.options[configKey];
                picker.includeDomains = domains;
                picker.dataset.key = configKey; // For saving

                // Add class for later updates if needed
                picker.classList.add('live-picker');

                group.appendChild(picker);
                parent.appendChild(group);
            };

            // DOM-based Helper for Input
            const appendInput = (parent, label, configKey, type = 'text') => {
                const group = document.createElement('div');
                group.className = 'form-group';

                const lbl = document.createElement('label');
                lbl.className = 'form-label';
                lbl.innerText = label;
                group.appendChild(lbl);

                const input = document.createElement('input');
                input.type = type;
                input.value = device.options[configKey] !== undefined ? device.options[configKey] : '';
                input.dataset.key = configKey; // For saving

                group.appendChild(input);
                parent.appendChild(group);
            };

            // Col 1
            appendPicker(col1, 'Temp. Sensor', 'temp_sensor', ['sensor']);
            appendPicker(col1, 'Luftfeuchte Sensor', 'humidity_sensor', ['sensor']);
            appendPicker(col1, 'Abluft Ventilator', 'fan_entity', ['switch', 'fan', 'input_boolean']);
            appendInput(col1, 'Ziel Temperatur (°C)', 'target_temp', 'number');
            appendInput(col1, 'Max. Feuchte (%)', 'max_humidity', 'number');

            // Col 2
            appendPicker(col2, 'Licht Quelle', 'light_entity', ['switch', 'light', 'input_boolean']);
            appendInput(col2, 'Licht Start (Stunde)', 'light_start_hour', 'number');

            appendPicker(col2, 'Wasserpumpe', 'pump_entity', ['switch', 'input_boolean']);
            appendPicker(col2, 'Bodenfeuchte Sensor', 'moisture_sensor', ['sensor']);
            appendInput(col2, 'Ziel Bodenfeuchte (%)', 'target_moisture', 'number');
            appendInput(col2, 'Pumpen Dauer (s)', 'pump_duration', 'number');

            // Col 3
            appendPicker(col3, 'Kamera', 'camera_entity', ['camera']);
            appendInput(col3, 'Phasen Startdatum', 'phase_start_date', 'date');

            grid.appendChild(col1);
            grid.appendChild(col2);
            grid.appendChild(col3);
            section.appendChild(grid);

            // Save Button
            const btnDiv = document.createElement('div');
            btnDiv.style.cssText = "margin-top:24px; text-align:right;";
            const btn = document.createElement('button');
            btn.className = 'btn active';
            btn.style.cssText = "width:auto; display:inline-flex; padding:12px 24px;";
            btn.id = `save-${device.id}`; // Add ID for consistency
            btn.innerText = 'Speichern';
            btn.onclick = () => this._saveConfig_V2(section, device.entryId);
            btnDiv.appendChild(btn);

            section.appendChild(btnDiv);

            container.appendChild(section);
        });
    }

    _renderPhases(container) {
        this._devices.forEach(device => {
            const section = document.createElement('div');
            section.className = 'settings-section';

            const renderInput = (label, configKey, val) => `
                <div class="form-group">
                    <label class="form-label">${label}</label>
                    <input type="number" value="${val}" data-key="${configKey}" data-entry="${device.entryId}">
                </div>
            `;

            section.innerHTML = `
                <div class="section-title">${device.name} - Phasen Zeiten (Stunden)</div>
                <div class="form-grid">
                    ${renderInput('Keimling', 'phase_seedling_hours', device.options.phase_seedling_hours || 18)}
                    ${renderInput('Wachstum', 'phase_vegetative_hours', device.options.phase_vegetative_hours || 18)}
                    ${renderInput('Blüte', 'phase_flowering_hours', device.options.phase_flowering_hours || 12)}
                </div>
                
                <h4 style="margin:24px 0 16px 0; color:var(--text-secondary);">Benutzerdefinierte Phasen (Name | Stunden)</h4>
                
                <div class="form-grid">
                     <div class="form-group">
                        <label class="form-label">Custom 1 Name</label>
                        <input type="text" value="${device.options.custom1_phase_name || ''}" data-key="custom1_phase_name" data-entry="${device.entryId}">
                     </div>
                     <div class="form-group">
                        <label class="form-label">Stunden</label>
                        <input type="number" value="${device.options.custom1_phase_hours || 0}" data-key="custom1_phase_hours" data-entry="${device.entryId}">
                     </div>
                </div>
                
                 <div style="margin-top:24px; text-align:right;">
                    <button class="btn active" id="save-p-${device.id}" style="width:auto; display:inline-flex; padding:12px 24px;">
                        Speichern
                    </button>
                </div>
            `;

            section.querySelector(`#save-p-${device.id}`).onclick = () => this._saveConfig_V2(section, device.entryId);
            container.appendChild(section);
        });
    }

    async _saveConfig_V2(section, entryId) {
        const updates = {};

        // Inputs
        section.querySelectorAll('input, select').forEach(el => {
            if (el.dataset.key) {
                updates[el.dataset.key] = el.value;
            }
        });

        // Entity Pickers
        section.querySelectorAll('ha-entity-picker').forEach(el => {
            if (el.dataset.key) {
                updates[el.dataset.key] = el.value;
            }
        });

        try {
            await this._hass.callWS({
                type: 'local_grow_box/update_config',
                entry_id: entryId,
                config: updates
            });

            const toast = this.shadowRoot.getElementById('save-toast');
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 3000);

            // Refresh
            this._fetchDevices();

        } catch (e) {
            alert("Fehler beim Speichern: " + e.message);
        }
    }

    _toggle(entityId) {
        if (!entityId) return;
        this._hass.callService('homeassistant', 'toggle', { entity_id: entityId });
    }

    _triggerUpload(deviceId) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    await this._hass.callWS({
                        type: 'local_grow_box/upload_image',
                        device_id: deviceId,
                        image: ev.target.result
                    });
                    this._fetchDevices(); // Refresh
                } catch (err) {
                    alert('Upload fehlgeschlagen');
                }
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
}

customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
