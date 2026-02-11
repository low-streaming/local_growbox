class LocalGrowBoxPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
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

            // Filter: Look for devices with identifiers matching our domain
            const myDevices = devices.filter(d =>
                d.identifiers && d.identifiers.some(id => id[0] === 'local_grow_box')
            );

            this._devices = myDevices.map(device => {
                const deviceEntities = entities.filter(e => e.device_id === device.id);

                const findEntity = (uniqueIdSuffix) => {
                    const ent = deviceEntities.find(e => e.unique_id.endsWith(uniqueIdSuffix));
                    return ent ? ent.entity_id : null;
                };

                return {
                    name: device.name_by_user || device.name,
                    id: device.id,
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

        // STYLES
        const style = `
            <style>
                :host {
                    --app-header-background-color: var(--primary-color);
                    --app-header-text-color: var(--text-primary-color);
                    --app-header-background-color: var(--primary-background-color);
                    display: block;
                    background-color: var(--primary-background-color);
                    min-height: 100vh;
                    font-family: var(--paper-font-body1_-_font-family);
                    color: var(--primary-text-color);
                }
                .header {
                    background-color: var(--app-header-background-color);
                    color: var(--app-header-text-color);
                    padding: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid var(--divider-color);
                }
                .header h1 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 500;
                }
                .add-btn {
                    background: var(--primary-color);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    padding: 8px 16px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                }
                .content {
                    padding: 16px;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                    gap: 16px;
                }
                .card {
                    background-color: var(--card-background-color);
                    border-radius: 12px;
                    box-shadow: var(--ha-card-box-shadow, 0 2px 2px 0 rgba(0, 0, 0, 0.14), 0 1px 5px 0 rgba(0, 0, 0, 0.12), 0 3px 1px -2px rgba(0, 0, 0, 0.2));
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                .card-header {
                    padding: 16px;
                    font-size: 18px;
                    font-weight: 500;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .card-image {
                    height: 150px;
                    background-color: #4CAF50; /* Fallback color */
                    background-image: url('/local/growbox-default.jpg');
                    background-size: cover;
                    background-position: center;
                }
                .card-content {
                    padding: 16px;
                }
                .sensor-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 12px;
                }
                .sensor-icon {
                    width: 24px;
                    height: 24px;
                    margin-right: 12px;
                    font-size: 20px;
                    text-align: center;
                }
                .sensor-bar-container {
                    flex: 1;
                    background-color: var(--secondary-background-color);
                    height: 10px;
                    border-radius: 5px;
                    overflow: hidden;
                    margin-right: 12px;
                }
                .sensor-bar-fill {
                    height: 100%;
                    border-radius: 5px;
                    transition: width 0.5s ease-out;
                }
                .sensor-text {
                    min-width: 60px;
                    text-align: right;
                    font-size: 14px;
                }
                .controls {
                    display: flex;
                    justify-content: space-around;
                    padding: 16px;
                    border-top: 1px solid var(--divider-color);
                    background-color: rgba(0,0,0,0.02);
                }
                .control-btn {
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    color: var(--primary-text-color);
                    opacity: 0.6;
                    transition: opacity 0.2s;
                }
                .control-btn:hover {
                    opacity: 1.0;
                }
                .control-btn.active {
                    opacity: 1.0;
                    color: var(--primary-color);
                }
                .control-icon {
                   font-size: 24px;
                   margin-bottom: 4px;
                }
                select {
                    padding: 4px;
                    border-radius: 4px;
                    border: 1px solid var(--divider-color);
                    background: var(--card-background-color);
                    color: var(--primary-text-color);
                }
                /* Gradients */
                .grad-vpd { background: linear-gradient(90deg, #3498db, #2ecc71, #e74c3c); }
            </style>
        `;

        let cardsHtml = '';

        if (this._devices && this._devices.length > 0) {
            cardsHtml = this._devices.map((device, index) => {
                const masterState = this._hass.states[device.entities.master];
                const pumpState = this._hass.states[device.entities.pump];
                const vpdState = this._hass.states[device.entities.vpd];
                const daysState = this._hass.states[device.entities.days];
                const phaseState = this._hass.states[device.entities.phase];

                const isMasterOn = masterState && masterState.state === 'on';
                const isPumpOn = pumpState && pumpState.state === 'on';

                const vpdVal = vpdState ? parseFloat(vpdState.state) : 0;
                const vpdPercent = Math.min(100, Math.max(0, (vpdVal / 3.0) * 100));

                const phaseOptions = phaseState ? phaseState.attributes.options : [];
                const currentPhase = phaseState ? phaseState.state : '';

                // Camera handling
                let cameraHtml = `
                    <div class="card-image" style="background-color: #4CAF50; background-image: url('/local/growbox-default.jpg'); background-size: cover; background-position: center;">
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 8px; background: rgba(0,0,0,0.6); color: white; display: flex; justify-content: center;">
                            <span>Active</span>
                        </div>
                    </div>
                `;

                if (masterState && masterState.attributes.camera_entity) {
                    const cameraEntity = masterState.attributes.camera_entity;
                    const cameraState = this._hass.states[cameraEntity];
                    if (cameraState) {
                        // Use entity picture for simpler snapshot, or try a stream URL
                        // Note: For live stream we'd need access to auth tokens which is complex here.
                        // We will use the camera_proxy url which usually works if authenticated in browser.
                        const camUrl = `/api/camera_proxy_stream/${cameraEntity}`;
                        cameraHtml = `
                            <div class="card-image" style="background-color: black; position: relative;">
                                <img src="${camUrl}" style="width: 100%; height: 100%; object-fit: cover;" />
                            </div>
                        `;
                    }
                }

                // We attach IDs to elements to bind events later
                return `
                    <div class="card">
                        <div class="card-header">
                            <span>${device.name}</span>
                            <span style="font-size: 0.8em; opacity: 0.7">${daysState ? daysState.state + ' days' : ''}</span>
                        </div>
                        ${cameraHtml}
                        <div class="card-content">
                             <div class="sensor-row">
                                <span class="sensor-icon">🌱</span>
                                <div style="flex:1">
                                    <select id="phase-${index}" data-entity="${device.entities.phase}">
                                        ${phaseOptions.map(opt => `<option value="${opt}" ${opt === currentPhase ? 'selected' : ''}>${opt}</option>`).join('')}
                                    </select>
                                </div>
                             </div>
                             
                             <div class="sensor-row">
                                <span class="sensor-icon">💧</span>
                                <div class="sensor-bar-container">
                                    <div class="sensor-bar-fill grad-vpd" style="width: ${vpdPercent}%;"></div>
                                </div>
                                <div class="sensor-text">${vpdState ? vpdVal + ' kPa' : 'N/A'}</div>
                             </div>
                        </div>
                        <div class="controls">
                            <div class="control-btn ${isMasterOn ? 'active' : ''}" id="master-${index}" data-entity="${device.entities.master}">
                                <div class="control-icon">🔌</div>
                                <span>Master</span>
                            </div>
                            ${device.entities.pump ? `
                            <div class="control-btn ${isPumpOn ? 'active' : ''}" id="pump-${index}" data-entity="${device.entities.pump}">
                                <div class="control-icon">🚿</div>
                                <span>Pump</span>
                            </div>
                            ` : ''}
                             <div class="control-btn" id="settings-${index}" data-device="${device.id}">
                                <div class="control-icon">⚙️</div>
                                <span>Settings</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            cardsHtml = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--secondary-text-color);">
                    <h2>No Grow Boxes Found</h2>
                    <p>Please add a "Local Grow Box" integration first.</p>
                </div>
            `;
        }

        root.innerHTML = `
            ${style}
            <div class="header">
                <h1>My Grow Room</h1>
                <button class="add-btn" id="add-btn">Add Plant +</button>
            </div>
            <div class="content">
                ${cardsHtml}
            </div>
        `;

        // Bind Events
        root.getElementById('add-btn').addEventListener('click', () => this._addPlant());

        if (this._devices) {
            this._devices.forEach((device, index) => {
                // Phase Select
                const phaseSel = root.getElementById(`phase-${index}`);
                if (phaseSel) {
                    phaseSel.addEventListener('change', (e) => {
                        this._setPhase(e.target.dataset.entity, e.target.value);
                    });
                }
                // Master Toggle
                const masterBtn = root.getElementById(`master-${index}`);
                if (masterBtn) {
                    masterBtn.addEventListener('click', (e) => {
                        this._toggle(e.currentTarget.dataset.entity);
                    });
                }
                // Pump Toggle
                const pumpBtn = root.getElementById(`pump-${index}`);
                if (pumpBtn) {
                    pumpBtn.addEventListener('click', (e) => {
                        this._toggle(e.currentTarget.dataset.entity);
                    });
                }
                // Settings
                const setBtn = root.getElementById(`settings-${index}`);
                if (setBtn) {
                    setBtn.addEventListener('click', (e) => {
                        this._openSettings(e.currentTarget.dataset.device);
                    });
                }
            });
        }
    }

    _toggle(entityId) {
        if (!entityId || !this._hass) return;
        const state = this._hass.states[entityId];
        const service = state.state === 'on' ? 'turn_off' : 'turn_on';
        this._hass.callService('switch', service, { entity_id: entityId });
    }

    _setPhase(entityId, value) {
        if (!entityId || !this._hass) return;
        this._hass.callService('select', 'select_option', { entity_id: entityId, option: value });
    }

    _addPlant() {
        // Since we can't easily trigger the config flow config panel from here without internals,
        // we'll navigate to the integrations page and show a message.
        // Or deeper: /config/integrations/dashboard/add?domain=local_grow_box
        const url = "/config/integrations/dashboard";
        history.pushState(null, "", url);
        window.dispatchEvent(new Event('location-changed', { bubbles: true, composed: true }));

        // Show a toast or alert - primitive but effective
        setTimeout(() => alert("Click 'Add Integration' and search for 'Local Grow Box' to add a new plant."), 500);
    }

    _openSettings(deviceId) {
        history.pushState(null, "", `/config/devices/device/${deviceId}`);
        window.dispatchEvent(new Event('location-changed', { bubbles: true, composed: true }));
    }
}

customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
