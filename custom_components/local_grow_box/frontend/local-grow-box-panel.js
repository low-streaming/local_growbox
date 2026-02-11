class LocalGrowBoxPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._initialized = false;
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

        const style = `
            <style>
                :host {
                    --primary-color: #03a9f4;
                    --accent-color: #009688;
                    --text-primary-color: #ffffff;
                    --card-bg: var(--ha-card-background, var(--card-background-color, #fff));
                    --primary-text: var(--primary-text-color);
                    --secondary-text: var(--secondary-text-color);
                    display: block;
                    background-color: var(--primary-background-color);
                    min-height: 100vh;
                    font-family: 'Roboto', 'Segoe UI', sans-serif;
                    color: var(--primary-text);
                    padding-bottom: 40px;
                }
                .header {
                    background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
                    color: var(--text-primary-color);
                    padding: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    margin-bottom: 24px;
                }
                .header h1 {
                    margin: 0;
                    font-size: 28px;
                    font-weight: 300;
                    letter-spacing: 0.5px;
                }
                .add-btn {
                    background: rgba(255,255,255,0.2);
                    color: white;
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 28px;
                    cursor: pointer;
                    transition: background 0.3s, transform 0.2s;
                    backdrop-filter: blur(5px);
                }
                .add-btn:hover {
                    background: rgba(255,255,255,0.4);
                    transform: scale(1.05);
                }
                .content {
                    padding: 0 24px;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
                    gap: 24px;
                }
                .card {
                    background-color: var(--card-bg);
                    border-radius: 16px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 10px 15px rgba(0,0,0,0.1);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    transition: transform 0.2s, box-shadow 0.2s;
                    border: 1px solid var(--divider-color, rgba(0,0,0,0.1));
                    height: 100%;
                }
                .card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 12px rgba(0,0,0,0.1), 0 15px 25px rgba(0,0,0,0.15);
                }
                .card-header {
                    padding: 16px 20px;
                    background: rgba(0,0,0,0.03);
                    font-size: 18px;
                    font-weight: 600;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(0,0,0,0.05);
                }
                .card-header span:last-child {
                   font-size: 0.75em;
                   background: var(--primary-color);
                   color: white;
                   padding: 2px 8px;
                   border-radius: 12px;
                   font-weight: normal;
                }
                .card-image {
                    height: 200px;
                    background-color: #2c3e50;
                    background-image: url('/local/growbox-default.jpg');
                    background-size: cover;
                    background-position: center;
                    position: relative;
                }
                .card-image-overlay {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    padding: 10px;
                    background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
                    color: white;
                    display: flex;
                    justify-content: flex-end;
                }
                .live-badge {
                    background: rgba(255, 0, 0, 0.7);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    text-transform: uppercase;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .live-badge::before {
                    content: '';
                    display: block;
                    width: 6px;
                    height: 6px;
                    background: white;
                    border-radius: 50%;
                }
                .card-content {
                    padding: 20px;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }
                .sensor-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 20px;
                }
                
                .sensor-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px 24px;
                    margin-top: auto; /* Push to bottom of content area */
                    padding-top: 20px;
                    border-top: 1px solid rgba(0,0,0,0.05);
                }

                .sensor-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .sensor-icon-small {
                    font-size: 20px;
                    width: 24px;
                    text-align: center;
                    color: var(--accent-color);
                }

                .sensor-info {
                    flex: 1;
                    overflow: hidden;
                }

                .sensor-status-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    font-size: 14px;
                    margin-bottom: 4px;
                }

                .sensor-bar-mini {
                    height: 6px;
                    background: rgba(0,0,0,0.05);
                    border-radius: 3px;
                    overflow: hidden;
                }
                .sensor-bar-mini-fill {
                    height: 100%;
                    border-radius: 3px;
                    background: var(--accent-color);
                }
                .sensor-bar-mini-fill.warn { background: #ff9800; }
                .sensor-bar-mini-fill.cool { background: #2196f3; }

                .sensor-icon {
                    width: 32px;
                    height: 32px;
                    margin-right: 16px;
                    font-size: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: white;
                    border-radius: 50%;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                    flex-shrink: 0;
                }
                .sensor-data {
                    flex: 1;
                }
                .sensor-bar-container {
                    background-color: rgba(0,0,0,0.1);
                    height: 8px;
                    border-radius: 4px;
                    overflow: hidden;
                    margin-top: 8px;
                }
                .sensor-bar-fill {
                    height: 100%;
                    border-radius: 4px;
                    transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .sensor-value {
                    font-size: 18px;
                    font-weight: 700;
                    float: right;
                }
                .sensor-label {
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    opacity: 0.7;
                }
                .controls {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                    padding: 20px;
                    background: rgba(0,0,0,0.02);
                }
                .control-btn {
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                    border-radius: 12px;
                    transition: all 0.2s;
                    background: white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    border: 1px solid transparent;
                }
                .control-btn:hover {
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    transform: translateY(-1px);
                }
                .control-btn.active {
                    background: var(--primary-color);
                    color: white;
                    box-shadow: 0 4px 10px rgba(3, 169, 244, 0.4);
                }
                .control-btn.active .control-icon {
                    color: white;
                }
                .control-icon {
                    font-size: 28px;
                    margin-bottom: 6px;
                    color: #7f8c8d;
                    transition: color 0.2s;
                }
                select {
                    padding: 8px 12px;
                    border-radius: 8px;
                    border: 1px solid rgba(0,0,0,0.1);
                    background: white;
                    color: #333;
                    font-size: 14px;
                    width: 100%;
                    outline: none;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                /* Gradients */
                .grad-vpd { background: linear-gradient(90deg, #3498db, #2ecc71, #e74c3c); }
                
                /* Modal refinement */
                .modal-backdrop {
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(4px);
                    position: fixed;
                    top: 0; left: 0; width: 100%; height: 100%;
                    display: none;
                    justify-content: center;
                    align-items: center;
                    z-index: 100;
                }
                .modal-backdrop.open {
                    display: flex;
                }
                .modal {
                    background: white;
                    padding: 30px;
                    width: 90%;
                    max-width: 500px;
                    border-radius: 20px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
                }
                .modal h2 { margin-top: 0; margin-bottom: 16px; color: var(--primary-color); }
                .modal-actions {
                    margin-top: 24px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }
                .modal-btn {
                    padding: 12px 24px;
                    font-size: 14px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 600;
                }
                .modal-btn.cancel {
                    background: #f5f5f5;
                    color: #333;
                }
                .modal-btn.confirm {
                    background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
                    color: white;
                    box-shadow: 0 4px 15px rgba(0,150,136, 0.4);
                }
            </style>
        `;

        const getEntityState = (entityId) => {
            if (!entityId) return null;
            return this._hass.states[entityId];
        };

        let cardsHtml = '';

        if (this._devices && this._devices.length > 0) {
            cardsHtml = this._devices.map((device, index) => {
                const masterState = this._hass.states[device.entities.master];
                const pumpState = this._hass.states[device.entities.pump];
                const vpdState = this._hass.states[device.entities.vpd];
                const daysState = this._hass.states[device.entities.days];
                const phaseState = this._hass.states[device.entities.phase];

                // Additional Sensors from Attributes
                const tempEntity = masterState ? masterState.attributes.temp_sensor : null;
                const humidityEntity = masterState ? masterState.attributes.humidity_sensor : null;
                const lightEntity = masterState ? masterState.attributes.light_entity : null;
                const fanEntity = masterState ? masterState.attributes.fan_entity : null;

                const tempState = getEntityState(tempEntity);
                const humidityState = getEntityState(humidityEntity);
                const lightState = getEntityState(lightEntity);
                const fanState = getEntityState(fanEntity);

                const isMasterOn = masterState && masterState.state === 'on';
                const isPumpOn = pumpState && pumpState.state === 'on';

                const vpdVal = vpdState ? parseFloat(vpdState.state) : 0;
                const vpdPercent = Math.min(100, Math.max(0, (vpdVal / 3.0) * 100));

                const defaultPhaseOptions = ['seedling', 'vegetative', 'flowering', 'drying', 'curing'];
                const phaseOptions = (phaseState && phaseState.attributes && phaseState.attributes.options) ? phaseState.attributes.options : defaultPhaseOptions;
                const currentPhase = phaseState ? phaseState.state : '';

                // Translation Map
                const phaseTranslations = {
                    'seedling': 'Keimling',
                    'vegetative': 'Wachstum',
                    'flowering': 'Blüte',
                    'drying': 'Trocknen',
                    'curing': 'Veredelung'
                };

                // Camera handling
                let cameraHtml = `
                    <div class="card-image">
                       <div class="card-image-overlay">
                            <span class="live-badge">Keine Kamera</span>
                        </div>
                    </div>
                `;

                if (masterState && masterState.attributes.camera_entity) {
                    const cameraEntity = masterState.attributes.camera_entity;
                    const cameraState = this._hass.states[cameraEntity];
                    if (cameraState) {
                        // Use entity_picture if available (contains token), else fallback
                        const camUrl = cameraState.attributes.entity_picture || `/api/camera_proxy_stream/${cameraEntity}`;
                        cameraHtml = `
                            <div class="card-image">
                                <img src="${camUrl}" style="width: 100%; height: 100%; object-fit: cover;" />
                                <div class="card-image-overlay">
                                    <span class="live-badge">LIVE</span>
                                </div>
                            </div>
                        `;
                    }
                }

                // Sensor Grid Rendering
                const renderGridItem = (icon, val, sub, pct, colorClass) => `
                    <div class="sensor-item">
                        <div class="sensor-icon-small">${icon}</div>
                        <div class="sensor-info">
                            <div class="sensor-status-row">
                                <span style="font-weight:700;">${val}</span>
                                <span style="font-size:11px; opacity:0.6;">${sub}</span>
                            </div>
                            <div class="sensor-bar-mini">
                                <div class="sensor-bar-mini-fill ${colorClass}" style="width: ${pct}%"></div>
                            </div>
                        </div>
                    </div>
                `;

                // Calculate display values
                const tempVal = tempState ? parseFloat(tempState.state) : 0;
                const tempStr = tempState ? `${tempState.state} ${tempState.attributes.unit_of_measurement || '°C'}` : '--';
                const tempPct = Math.min(100, (tempVal / 40) * 100);

                const humVal = humidityState ? parseFloat(humidityState.state) : 0;
                const humStr = humidityState ? `${humidityState.state} ${humidityState.attributes.unit_of_measurement || '%'}` : '--';
                const humPct = Math.min(100, humVal);

                const lightOn = lightState && lightState.state === 'on';
                const fanOn = fanState && fanState.state === 'on';

                return `
                    <div class="card">
                        <div class="card-header">
                            <span>${device.name}</span>
                            <span>${daysState ? daysState.state + ' Tage' : '0 Tage'}</span>
                        </div>
                        ${cameraHtml}
                        <div class="card-content">
                             <!-- Main Controls -->
                             <div class="sensor-row">
                                <div class="sensor-icon">🌱</div>
                                <div class="sensor-data">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                        <span class="sensor-label">Phase</span>
                                    </div>
                                    <select id="phase-${index}" data-entity="${device.entities.phase}">
                                        ${phaseOptions.map(opt => `<option value="${opt}" ${opt === currentPhase ? 'selected' : ''}>${phaseTranslations[opt] || opt}</option>`).join('')}
                                    </select>
                                </div>
                             </div>
                             
                             <div class="sensor-row">
                                <div class="sensor-icon">💧</div>
                                <div class="sensor-data">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                       <span class="sensor-label">VPD (Dampfdruckdefizit)</span>
                                       <span class="sensor-value">${vpdState ? vpdVal + ' <small>kPa</small>' : '--'}</span>
                                    </div>
                                    <div class="sensor-bar-container">
                                        <div class="sensor-bar-fill grad-vpd" style="width: ${vpdPercent}%;"></div>
                                    </div>
                                </div>
                             </div>

                             <!-- Environment Grid -->
                             <div class="sensor-grid">
                                ${renderGridItem('🌡️', tempStr, 'Temp', tempPct, tempVal > 28 ? 'warn' : 'cool')}
                                ${renderGridItem('☁️', humStr, 'Feuchtigkeit', humPct, 'cool')}
                                ${renderGridItem('💡', lightOn ? 'AN' : 'AUS', 'Licht', lightOn ? 100 : 0, 'warn')}
                                ${renderGridItem('💨', fanOn ? 'AN' : 'AUS', 'Lüfter', fanOn ? 100 : 0, 'cool')}
                             </div>

                        </div>
                        <div class="controls">
                            <div class="control-btn ${isMasterOn ? 'active' : ''}" id="master-${index}" data-entity="${device.entities.master}">
                                <div class="control-icon">🔌</div>
                                <span>Master</span>
                            </div>
                            <div class="control-btn ${isPumpOn ? 'active' : ''}" id="pump-${index}" data-entity="${device.entities.pump}" style="${!device.entities.pump ? 'opacity:0.2; pointer-events:none;' : ''}">
                                <div class="control-icon">🚿</div>
                                <span>Pumpe</span>
                            </div>
                             <div class="control-btn" id="settings-${index}" data-device="${device.id}">
                                <div class="control-icon">⚙️</div>
                                <span>Einstellungen</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            cardsHtml = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--secondary-text-color);">
                    <div style="font-size: 60px; margin-bottom: 20px; opacity: 0.5;">🌱</div>
                    <h2 style="font-weight: 300;">Keine Grow-Boxen gefunden</h2>
                    <p>Beginnen Sie Ihre Reise, indem Sie eine "Local Grow Box"-Integration in den Einstellungen hinzufügen.</p>
                </div>
            `;
        }

        const html = `
            ${style}
            <div class="header">
                <h1>Mein Anbauraum</h1>
                <div class="add-btn" id="add-plant-btn">+</div>
            </div>
            <div class="content">
                ${cardsHtml}
            </div>

            <!-- Modal -->
            <div class="modal-backdrop" id="add-modal">
                <div class="modal">
                    <h2>Neue Pflanze hinzufügen</h2>
                    <p>Um eine neue Grow-Box hinzuzufügen, müssen Sie einen neuen Integrationseintrag in den Home Assistant-Einstellungen konfigurieren.</p>
                    <div class="modal-actions">
                        <button class="modal-btn cancel" id="modal-cancel">Abbrechen</button>
                        <button class="modal-btn confirm" id="modal-confirm">Zu den Einstellungen</button>
                    </div>
                </div>
            </div>
        `;

        root.innerHTML = html;

        // Bind Events

        // Add Plant Button
        const addBtn = root.getElementById('add-plant-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const modal = root.getElementById('add-modal');
                modal.classList.add('open');
            });
        }

        // Modal Actions
        const modalCancel = root.getElementById('modal-cancel');
        if (modalCancel) {
            modalCancel.addEventListener('click', () => {
                const modal = root.getElementById('add-modal');
                modal.classList.remove('open');
            });
        }

        const modalConfirm = root.getElementById('modal-confirm');
        if (modalConfirm) {
            modalConfirm.addEventListener('click', () => {
                const modal = root.getElementById('add-modal');
                modal.classList.remove('open');
                this._navigateToAddIntegration();
            });
        }

        // Outside click to close
        const modalBackdrop = root.getElementById('add-modal');
        if (modalBackdrop) {
            modalBackdrop.addEventListener('click', (e) => {
                if (e.target === modalBackdrop) {
                    modalBackdrop.classList.remove('open');
                }
            });
        }

        // Bind Card Events
        if (this._devices) {
            this._devices.forEach((device, index) => {
                const phaseSelect = root.getElementById(`phase-${index}`);
                if (phaseSelect) {
                    phaseSelect.addEventListener('change', (e) => this._setPhase(e.target.dataset.entity, e.target.value));
                }

                const masterBtn = root.getElementById(`master-${index}`);
                if (masterBtn) {
                    masterBtn.addEventListener('click', (e) => this._toggleEntity(masterBtn.dataset.entity));
                }

                const pumpBtn = root.getElementById(`pump-${index}`);
                if (pumpBtn) {
                    pumpBtn.addEventListener('click', (e) => this._toggleEntity(pumpBtn.dataset.entity));
                }

                const settingsBtn = root.getElementById(`settings-${index}`);
                if (settingsBtn) {
                    settingsBtn.addEventListener('click', () => {
                        const event = new CustomEvent("hass-more-info", {
                            bubbles: true,
                            composed: true,
                            detail: { entityId: device.entities.master }
                        });
                        this.dispatchEvent(event);
                    });
                }
            });
        }
    }

    _navigateToAddIntegration() {
        history.pushState(null, "", "/config/integrations/dashboard");
        const event = new Event("location-changed", { bubbles: true, composed: true });
        this.dispatchEvent(event);
    }

    _toggleEntity(entityId) {
        if (!this._hass || !entityId) return;
        this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
    }

    _setPhase(entityId, option) {
        if (!this._hass || !entityId) return;
        this._hass.callService("select", "select_option", { entity_id: entityId, option: option });
    }
}

customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
