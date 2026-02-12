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
                    --card-bg: #1c1c1e; /* Darker, sleek background */
                    --primary-text: #ffffff;
                    --secondary-text: #b0b0b0;
                    --success-color: #4caf50;
                    --warning-color: #ff9800;
                    --danger-color: #f44336;
                    --info-color: #2196f3;
                    
                    /* Gradients for bars */
                    --grad-success: linear-gradient(90deg, #66bb6a, #43a047);
                    --grad-warning: linear-gradient(90deg, #ffa726, #fb8c00);
                    --grad-danger: linear-gradient(90deg, #ef5350, #e53935);
                    --grad-info: linear-gradient(90deg, #42a5f5, #1e88e5);
                    --grad-inactive: linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));

                    display: block;
                    background-color: #121212; /* Deep dark bg */
                    min-height: 100vh;
                    font-family: 'Roboto', 'Segoe UI', sans-serif;
                    color: var(--primary-text);
                    padding-bottom: 40px;
                }
                .header {
                    background: linear-gradient(135deg, #0288d1, #00796b);
                    color: var(--text-primary-color);
                    padding: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                    margin-bottom: 24px;
                }
                .header h1 {
                    margin: 0;
                    font-size: 28px;
                    font-weight: 300;
                    letter-spacing: 0.5px;
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
                .content {
                    padding: 0 24px;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
                    gap: 24px;
                }
                .card {
                    background-color: var(--card-bg);
                    border-radius: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    transition: transform 0.3s, box-shadow 0.3s;
                    border: 1px solid rgba(255,255,255,0.08); /* Subtle highlight */
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
                .card-header span:last-child {
                   font-size: 0.75em;
                   background: var(--info-color);
                   color: white;
                   padding: 4px 10px;
                   border-radius: 20px;
                   font-weight: 600;
                   box-shadow: 0 2px 8px rgba(33, 150, 243, 0.3);
                }
                .card-image {
                    height: 220px;
                    background-color: #2c2c2e;
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
                    padding: 12px;
                    background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
                    color: white;
                    display: flex;
                    justify-content: space-between; /* Changed for edit btn */
                    align-items: center;
                }
                .edit-image-btn {
                    background: rgba(0,0,0,0.6);
                    color: white;
                    border: 1px solid rgba(255,255,255,0.3);
                    border-radius: 50%;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 16px;
                    transition: all 0.2s;
                    opacity: 0; /* Hidden by default */
                }
                .card-image:hover .edit-image-btn {
                    opacity: 1;
                }
                .edit-image-btn:hover {
                    background: rgba(255,255,255,0.2);
                    transform: scale(1.1);
                }
                .live-badge {
                    background: rgba(244, 67, 54, 0.85);
                    padding: 4px 8px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: bold;
                    text-transform: uppercase;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                }
                .live-badge::before {
                    content: '';
                    display: block;
                    width: 6px;
                    height: 6px;
                    background: white;
                    border-radius: 50%;
                    box-shadow: 0 0 4px rgba(255,255,255,0.8);
                }
                .card-content {
                    padding: 24px;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }
                .sensor-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 24px;
                }
                
                /* Refined Grid Layout */
                .sensor-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px 32px; /* Increased gap */
                    margin-top: auto;
                    padding-top: 24px;
                    border-top: 1px solid rgba(255,255,255,0.08); /* Subtle separator */
                }

                .sensor-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                }
                
                .sensor-icon-small {
                    font-size: 22px;
                    width: 28px;
                    text-align: center;
                    color: var(--secondary-text);
                    opacity: 1;
                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                    flex-shrink: 0;
                }

                .sensor-data-row {
                     flex: 1;
                     display: flex;
                     align-items: center;
                     gap: 16px;
                }

                .sensor-bar-segmented {
                    display: flex;
                    gap: 4px;
                    height: 8px;
                    flex: 1; 
                    min-width: 50px;
                }
                
                .bar-segment {
                    flex: 1;
                    height: 100%;
                    background: rgba(255,255,255,0.1);
                    border-radius: 2px;
                    transition: background 0.3s;
                }

                .sensor-val-main {
                    font-weight: 500;
                    font-size: 15px;
                    white-space: nowrap;
                    text-align: right;
                    min-width: 60px;
                    color: #fff;
                }
                
                .sensor-unit {
                    font-size: 0.85em;
                    opacity: 0.6;
                    font-weight: normal;
                }

                .sensor-icon {
                    width: 40px;
                    height: 40px;
                    margin-right: 20px;
                    font-size: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255,255,255,0.05);
                    border-radius: 50%;
                    box-shadow: inset 0 0 10px rgba(0,0,0,0.2);
                    flex-shrink: 0;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .sensor-data {
                    flex: 1;
                }
                .sensor-bar-container {
                    background-color: rgba(255,255,255,0.08);
                    height: 10px;
                    border-radius: 5px;
                    overflow: hidden;
                    margin-top: 10px;
                }
                .sensor-bar-fill {
                    height: 100%;
                    border-radius: 5px;
                    transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .sensor-value {
                    font-size: 18px;
                    font-weight: 600;
                    float: right;
                }
                .sensor-label {
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 1.2px;
                    opacity: 0.6;
                    color: var(--secondary-text);
                }
                .controls {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 16px;
                    padding: 24px;
                    background: rgba(0,0,0,0.1); /* Darker footer */
                }
                .control-btn {
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    border-radius: 16px;
                    transition: all 0.2s;
                    background: rgba(255,255,255,0.05); /* Slight glassy */
                    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .control-btn:hover {
                    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
                    transform: translateY(-2px);
                    background: rgba(255,255,255,0.1);
                }
                .control-btn.active {
                    background: var(--primary-color);
                    background: linear-gradient(135deg, var(--primary-color), var(--info-color));
                    color: white;
                    box-shadow: 0 4px 15px rgba(3, 169, 244, 0.4);
                    border: none;
                }
                .control-btn.active .control-icon {
                    color: white;
                }
                .control-icon {
                    font-size: 32px;
                    margin-bottom: 8px;
                    color: #757575;
                    transition: color 0.2s;
                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
                }
                select {
                    padding: 10px 14px;
                    border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.1);
                    background: #2c2c2e;
                    color: white;
                    font-size: 14px;
                    width: 100%;
                    outline: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                /* Gradients */
                .grad-vpd { background: linear-gradient(90deg, #29b6f6, #66bb6a, #ef5350); }
                
                /* Modal refinement */
                .modal-backdrop {
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(8px);
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
                    background: #2c2c2e;
                    color: white;
                    padding: 32px;
                    width: 90%;
                    max-width: 480px;
                    border-radius: 24px;
                    box-shadow: 0 25px 60px rgba(0,0,0,0.6);
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .modal h2 { margin-top: 0; margin-bottom: 20px; color: var(--primary-color); }
                .modal-actions {
                    margin-top: 32px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 16px;
                }
                .modal-btn {
                    padding: 12px 24px;
                    font-size: 14px;
                    border: none;
                    border-radius: 12px;
                    cursor: pointer;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                }
                .modal-btn.cancel {
                    background: rgba(255,255,255,0.1);
                    color: white;
                }
                .modal-btn.confirm {
                    background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
                    color: white;
                    box-shadow: 0 4px 15px rgba(0,150,136, 0.4);
                }
                input[type="file"] {
                    display: none;
                }
            </style>
        `;

        const getEntityState = (entityId) => {
            if (!entityId) return null;
            return this._hass.states[entityId];
        };

        // Helper to determine color based on value and type - Returns GRADIENT string
        const getSensorStatus = (type, value) => {
            if (value === null || value === undefined) return { color: 'var(--grad-inactive)', level: 0 };

            if (type === 'temp') {
                if (value < 18) return { color: 'var(--grad-info)', level: 1 };
                if (value > 28) return { color: 'var(--grad-danger)', level: 4 };
                return { color: 'var(--grad-success)', level: 3 };
            }
            if (type === 'humidity') {
                if (value < 40) return { color: 'var(--grad-warning)', level: 1 };
                if (value > 70) return { color: 'var(--grad-danger)', level: 4 };
                return { color: 'var(--grad-success)', level: 3 };
            }
            if (type === 'light') {
                return value === 'on'
                    ? { color: 'var(--grad-warning)', level: 3 }
                    : { color: 'var(--grad-inactive)', level: 0 };
            }
            if (type === 'fan') {
                return value === 'on'
                    ? { color: 'var(--grad-success)', level: 3 }
                    : { color: 'var(--grad-inactive)', level: 0 };
            }
            return { color: 'var(--grad-success)', level: 2 };
        };

        let cardsHtml = '';
        const timestamp = new Date().getTime(); // Cache buster for images

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

                const phaseTranslations = {
                    'seedling': 'Keimling',
                    'vegetative': 'Wachstum',
                    'flowering': 'Blüte',
                    'drying': 'Trocknen',
                    'curing': 'Veredelung'
                };

                // Camera/Image logic
                // Priority: 1. Configured Camera Entity, 2. Uploaded Custom Image, 3. Default Placeholder
                let imageUrl = '/local/growbox-default.jpg';
                let isLive = false;
                let badgeText = 'Keine Kamera';

                // Check for custom upload first (fallback)
                // We use the timestamp to attempt finding it
                const customImage = `/local/local_grow_box_images/${device.id}.jpg?t=${timestamp}`;

                // Construct HTML - we accept the image might broken if not exists, 
                // so we use onerror to fallback to placeholder.
                // But if Camera Entity exists, we use that.

                if (masterState && masterState.attributes.camera_entity) {
                    const cameraEntity = masterState.attributes.camera_entity;
                    const cameraState = this._hass.states[cameraEntity];
                    if (cameraState) {
                        imageUrl = cameraState.attributes.entity_picture || `/api/camera_proxy_stream/${cameraEntity}`;
                        isLive = true;
                        badgeText = 'LIVE';
                    }
                }

                // If NOT live, we try the custom image
                // Note: We render img tag. If specific custom image doesn't exist, it might show broken icon unless handled.
                // We'll use a trick: standard src is custom, onerror sets it to default.

                let imgTag = '';
                if (isLive) {
                    imgTag = `<img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
                } else {
                    // Try custom image, fallback to default
                    imgTag = `<img src="${customImage}" onerror="this.onerror=null;this.src='/local/growbox-default.jpg';" style="width: 100%; height: 100%; object-fit: cover;" />`;
                }

                // Edit button only shows if NOT a live camera entity (or maybe always?)
                // Let's allow always in case they want a static cover for a live cam (not imp. yet)
                // For now, allow upload for everyone.

                const cameraHtml = `
                    <div class="card-image">
                        ${imgTag}
                        <div class="card-image-overlay">
                            ${!isLive ? `
                            <div class="edit-image-btn" id="edit-img-${index}" title="Bild hochladen">
                                ✎
                            </div>
                            <input type="file" id="file-${index}" accept="image/*" />
                            ` : '<div></div>'}
                            
                            <span class="live-badge" style="${!isLive ? 'background:#607d8b;' : ''}">
                                ${badgeText}
                            </span>
                        </div>
                    </div>
                `;

                // Sensors
                const tempVal = tempState ? parseFloat(tempState.state) : null;
                const humVal = humidityState ? parseFloat(humidityState.state) : null;
                const lightVal = lightState ? lightState.state : null;
                const fanVal = fanState ? fanState.state : null;

                const tempStatus = getSensorStatus('temp', tempVal);
                const humStatus = getSensorStatus('humidity', humVal);
                const lightStatus = getSensorStatus('light', lightVal);
                const fanStatus = getSensorStatus('fan', fanVal);

                const renderSegmentedItem = (icon, valStr, unit, status) => {
                    const maxSegments = 4;
                    let segmentsHtml = '';
                    for (let i = 1; i <= maxSegments; i++) {
                        const isActive = i <= status.level;
                        const bgStyle = isActive ? `background: ${status.color}; filter: brightness(1.2); box-shadow: 0 0 8px ${status.color};` : '';
                        segmentsHtml += `<div class="bar-segment" style="${bgStyle}"></div>`;
                    }

                    return `
                    <div class="sensor-item">
                        <div class="sensor-icon-small">${icon}</div>
                        <div class="sensor-data-row">
                             <div class="sensor-bar-segmented">
                                ${segmentsHtml}
                             </div>
                             <span class="sensor-val-main">${valStr} <span class="sensor-unit">${unit}</span></span>
                        </div>
                    </div>
                    `;
                };

                const tempDisplay = tempState ? tempState.state : '--';
                const humDisplay = humidityState ? humidityState.state : '--';

                return `
                    <div class="card">
                        <div class="card-header">
                            <span>${device.name}</span>
                            <span>${daysState ? daysState.state + ' Tage' : '0 Tage'}</span>
                        </div>
                        ${cameraHtml}
                        <div class="card-content">
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

                             <div class="sensor-grid">
                                ${renderSegmentedItem('🌡️', tempDisplay, '°C', tempStatus)}
                                ${renderSegmentedItem('☁️', humDisplay, '%', humStatus)}
                                ${renderSegmentedItem('💡', lightVal === 'on' ? 'AN' : 'AUS', '', lightStatus)}
                                ${renderSegmentedItem('💨', fanVal === 'on' ? 'AN' : 'AUS', '', fanStatus)}
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
                                <span>Einst.</span>
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
        const addBtn = root.getElementById('add-plant-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const modal = root.getElementById('add-modal');
                modal.classList.add('open');
            });
        }

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

        const modalBackdrop = root.getElementById('add-modal');
        if (modalBackdrop) {
            modalBackdrop.addEventListener('click', (e) => {
                if (e.target === modalBackdrop) {
                    modalBackdrop.classList.remove('open');
                }
            });
        }

        if (this._devices) {
            this._devices.forEach((device, index) => {
                // Basic Events
                const phaseSelect = root.getElementById(`phase-${index}`);
                if (phaseSelect) phaseSelect.addEventListener('change', (e) => this._setPhase(e.target.dataset.entity, e.target.value));

                const masterBtn = root.getElementById(`master-${index}`);
                if (masterBtn) masterBtn.addEventListener('click', (e) => this._toggleEntity(masterBtn.dataset.entity));

                const pumpBtn = root.getElementById(`pump-${index}`);
                if (pumpBtn) pumpBtn.addEventListener('click', (e) => this._toggleEntity(pumpBtn.dataset.entity));

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

                // Image Upload Events
                const editBtn = root.getElementById(`edit-img-${index}`);
                const fileInput = root.getElementById(`file-${index}`);

                if (editBtn && fileInput) {
                    editBtn.addEventListener('click', () => {
                        fileInput.click();
                    });

                    fileInput.addEventListener('change', (e) => {
                        if (e.target.files && e.target.files[0]) {
                            const file = e.target.files[0];
                            const reader = new FileReader();

                            reader.onload = async (e) => {
                                const base64Img = e.target.result;
                                await this._uploadImage(device.id, base64Img);
                            };

                            reader.readAsDataURL(file);
                        }
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

    async _uploadImage(deviceId, base64Image) {
        if (!this._hass) return;

        try {
            await this._hass.callWS({
                type: 'local_grow_box/upload_image',
                device_id: deviceId,
                image: base64Image
            });
            // Force refresh of specific image or component
            // Simple way: re-render
            this._render();
        } catch (err) {
            console.error("Image upload failed:", err);
            alert("Upload fehlgeschlagen: " + err.message);
        }
    }
}

customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
