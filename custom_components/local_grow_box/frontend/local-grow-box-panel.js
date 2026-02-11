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
        if (!this._hass) {
            return;
        }

        // Find all config entries for our domain
        // We can't easily query config entries from frontend without a websocket call.
        // But we can find entities that belong to our integration if we knew them.
        // A better way is to look for the "master switches" which have a unique ID pattern.
        // or finding devices. 
        // For simplicity, let's look for entities with unique_id ending in _master_switch
        // Actually, we can just fetch all entities and filter by platform/integration if exposed.
        // But "local_grow_box" entities don't have a reliable easy-to-query attribute in states.
        // However, we can look for specific entity IDs or attributes.

        // Strategy: Look for all switches with "master_control" in the name or ID?
        // Better: The integration should expose a list of "Grow Boxes".
        // Let's assume we find them by iterating all states and finding ones that look like ours.
        // Specifically, we look for the "select" entity which tracks the phase, as it's unique per box.

        const entities = Object.values(this._hass.states);
        const boxes = [];

        // Find all "Grow Phase" selects. unique_id pattern: {entry_id}_phase
        // Entity ID typically: select.grow_phase, select.grow_phase_2, etc.
        // We can check the integration attribute if available, but standard states don't always have it.
        // Let's look for the phase selector.

        const phaseSelects = entities.filter(e =>
            e.entity_id.startsWith('select.') &&
            e.attributes.options &&
            e.attributes.options.includes('vegetative') &&
            e.attributes.options.includes('flowering')
        );

        phaseSelects.forEach(select => {
            // We can try to derive the other entities from the device registry, 
            // but we don't have easy access to device registry here without WS calls.
            // Assumption: The user sets up the integration. 
            // The entities are usually grouped or namable.

            // Allow manual configuration? No, that defeats the "Zero Config" goal.

            // Let's simplify. We will just list *all* grow box instances we can find.
            // We need to find the related entities (Fan, Light, Sensor, Pump) for this "Box".
            // Since we don't have the backend linking explicitly in the state object, 
            // we might need a helper.
            // BUT: The device registry links them.
            // We can call 'config/device_registry/list' via websocket.

            boxes.push({
                id: select.entity_id,
                name: select.attributes.friendly_name || "Grow Box",
                phase_entity: select.entity_id,
                // We'll guess the others or needed a lookup. 
                // Creating a proper backend API would be best. 
                // For now, let's query the device registry.
            });
        });

        // We need to do this async build only once or on change.
        if (!this._initialized) {
            this._initialized = true;
            this._fetchDevices();
        }

        // If we have data, render.
        if (this._devices) {
            this._render();
        }
    }

    async _fetchDevices() {
        if (!this._hass) return;

        // Fetch devices
        const devices = await this._hass.callWS({ type: 'config/device_registry/list' });
        const entities = await this._hass.callWS({ type: 'config/entity_registry/list' });

        // Filter for our integration
        const myDevices = devices.filter(d =>
            d.identifiers && d.identifiers.some(id => id[0] === 'local_grow_box')
        );

        this._devices = myDevices.map(device => {
            // Find entities for this device
            const deviceEntities = entities.filter(e => e.device_id === device.id);

            const findEntity = (domain, uniqueIdSuffix) => {
                const ent = deviceEntities.find(e => e.unique_id.endsWith(uniqueIdSuffix));
                return ent ? ent.entity_id : null;
            };

            // Unique IDs set in backend:
            // Phase: {entry_id}_phase
            // Master: {entry_id}_master_switch
            // VPD: {entry_id}_vpd
            // Pump: {entry_id}_water_pump
            // Days: {entry_id}_days_in_phase

            // But we don't know entry_id easily here without parsing unique_id.
            // unique_id format is typically "{entry_id}_{suffix}"

            return {
                name: device.name_by_user || device.name,
                id: device.id,
                entities: {
                    phase: findEntity('select', '_phase'),
                    master: findEntity('switch', '_master_switch'),
                    vpd: findEntity('sensor', '_vpd'),
                    pump: findEntity('switch', '_water_pump'),
                    days: findEntity('sensor', '_days_in_phase'),
                }
            };
        });

        this._render();
    }

    _render() {
        const root = this.shadowRoot;

        // Styles
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
                    height: 200px;
                    background-size: cover;
                    background-position: center;
                    background-color: #ddd; /* placeholder */
                    position: relative;
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
                    color: var(--secondary-text-color);
                }
                .sensor-bar {
                    flex: 1;
                    height: 8px;
                    background-color: var(--secondary-background-color);
                    border-radius: 4px;
                    overflow: hidden;
                    position: relative;
                }
                .sensor-value-fill {
                    height: 100%;
                    background-color: var(--primary-color);
                    border-radius: 4px;
                }
                .sensor-text {
                    width: 60px;
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
                }
                .control-icon {
                   background: var(--secondary-background-color);
                   border-radius: 50%;
                   padding: 10px;
                   margin-bottom: 4px;
                   transition: background-color 0.3s;
                }
                .control-btn.active .control-icon {
                    background: var(--primary-color);
                    color: white;
                }
                select {
                    padding: 8px;
                    border-radius: 4px;
                    border: 1px solid var(--divider-color);
                }
                .fab {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    background-color: var(--primary-color);
                    color: white;
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                    cursor: pointer;
                    font-size: 24px;
                }
                /* Flower Card Bars Colors */
                .bar-temp { background: linear-gradient(90deg, #3498db, #2ecc71, #e74c3c); }
                .bar-hum { background: linear-gradient(90deg, #e67e22, #2ecc71, #3498db); }
                .bar-vpd { background: linear-gradient(90deg, #3498db, #2ecc71, #e74c3c); }
            </style>
        `;

        let cardsHtml = '';

        if (this._devices && this._devices.length > 0) {
            cardsHtml = this._devices.map(device => {
                const masterState = this._hass.states[device.entities.master];
                const pumpState = this._hass.states[device.entities.pump];
                const vpdState = this._hass.states[device.entities.vpd];
                const daysState = this._hass.states[device.entities.days];
                const phaseState = this._hass.states[device.entities.phase];

                const isMasterOn = masterState && masterState.state === 'on';
                const isPumpOn = pumpState && pumpState.state === 'on';

                const vpdVal = vpdState ? parseFloat(vpdState.state) : 0;
                // Max VPD assumption 3.0?
                const vpdPercent = Math.min(100, Math.max(0, (vpdVal / 3.0) * 100));

                const phaseOptions = phaseState ? phaseState.attributes.options : [];
                const currentPhase = phaseState ? phaseState.state : '';

                return `
                    <div class="card">
                        <div class="card-header">
                            <span>${device.name}</span>
                            <span style="font-size: 0.8em; color: var(--secondary-text-color)">${daysState ? daysState.state + ' days' : ''}</span>
                        </div>
                        <div class="card-image" style="background-image: url('/local/growbox-default.jpg')">
                            <!-- Placeholder image, user should be able to configure this -->
                        </div>
                        <div class="card-content">
                             <div class="sensor-row">
                                <div class="sensor-text">Phase</div>
                                <select onchange="document.querySelector('local-grow-box-panel')._setPhase('${device.entities.phase}', this.value)">
                                    ${phaseOptions.map(opt => `<option value="${opt}" ${opt === currentPhase ? 'selected' : ''}>${opt}</option>`).join('')}
                                </select>
                             </div>
                             
                             <div class="sensor-row">
                                <div class="sensor-icon">💧</div>
                                <div class="sensor-bar" style="background: #ddd;">
                                    <div class="sensor-value-fill bar-vpd" style="width: ${vpdPercent}%;"></div>
                                </div>
                                <div class="sensor-text">${vpdState ? vpdVal + ' kPa' : 'N/A'}</div>
                             </div>
                        </div>
                        <div class="controls">
                            <div class="control-btn ${isMasterOn ? 'active' : ''}" onclick="document.querySelector('local-grow-box-panel')._toggle('${device.entities.master}')">
                                <div class="control-icon">🔌</div>
                                <span>Master</span>
                            </div>
                            ${device.entities.pump ? `
                            <div class="control-btn ${isPumpOn ? 'active' : ''}" onclick="document.querySelector('local-grow-box-panel')._toggle('${device.entities.pump}')">
                                <div class="control-icon">🚿</div>
                                <span>Pump</span>
                            </div>
                            ` : ''}
                             <div class="control-btn" onclick="document.querySelector('local-grow-box-panel')._openSettings('${device.id}')">
                                <div class="control-icon">⚙️</div>
                                <span>Settings</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            cardsHtml = '<div style="padding: 20px; text-align: center;">No Grow Boxes found. Click + to add one.</div>';
        }

        root.innerHTML = `
            ${style}
            <div class="header">
                <h1>My Grow Room</h1>
            </div>
            <div class="content">
                ${cardsHtml}
            </div>
            <div class="fab" onclick="document.querySelector('local-grow-box-panel')._addPlant()">+</div>
        `;
    }

    _toggle(entityId) {
        if (!entityId) return;
        const state = this._hass.states[entityId];
        const service = state.state === 'on' ? 'turn_off' : 'turn_on';
        this._hass.callService('switch', service, { entity_id: entityId });
    }

    _setPhase(entityId, value) {
        if (!entityId) return;
        this._hass.callService('select', 'select_option', { entity_id: entityId, option: value });
    }

    _addPlant() {
        // Navigate to integrations page or start flow
        // history.pushState(null, "", "/config/integrations/dashboard/add?domain=local_grow_box"); 
        // Force event
        const event = new Event('location-changed', { bubbles: true, composed: true });
        event.detail = { replace: false };
        history.pushState(null, "", "/config/integrations/dashboard");
        window.dispatchEvent(event);

        // Ideally we start the flow directly, but that requires internal knowledge of HA dialogs.
        // Best approach: alert user to add integration.
        alert("Please add a new 'Local Grow Box' integration from the Devices & Services screen.");
    }

    _openSettings(deviceId) {
        // Navigate to device page
        history.pushState(null, "", `/config/devices/device/${deviceId}`);
        window.dispatchEvent(new Event('location-changed', { bubbles: true, composed: true }));
    }
}

customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
