class LocalGrowBoxPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._initialized = false;
        this._activeTab = 'overview'; // 'overview', 'statistics', 'settings', 'phases'
        this._draft = {}; // entryId -> { key: value }
        this.historyData = {};
        this.fetchingHistory = {};
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
            // Stability Fix: Only re-render 'overview' and 'statistics' on every state update.
            // Other tabs (settings, phases, logs, info) are static or input-heavy and should NOT
            // be wiped and re-created every time a sensor value changes in the background.
            const persistentTabs = ['settings', 'phases', 'logs', 'diary', 'info'];
            if (persistentTabs.includes(this._activeTab)) {
                // For dynamic elements inside persistent tabs (like entity pickers), 
                // we still update their hass object so they stay functional.
                if (this.shadowRoot) {
                    this.shadowRoot.querySelectorAll('ha-entity-picker, ha-selector').forEach(el => {
                        el.hass = this._hass;
                    });
                }
                if (this._activeTab === 'diary') {
                    this._updateDiaryValues();
                }
                return;
            }

            // Overview and Statistics get live updates
            this._render();
        }
    }

    async _fetchDevices() {
        if (!this._hass) return;

        // Ensure helpers are loaded (might trigger Custom Element upgrades for ha-selector)
        if (window.loadCardHelpers) {
            try {
                await window.loadCardHelpers();
            } catch (e) { console.warn("Could not load card helpers", e); }
        }

        try {
            const devices = await this._hass.callWS({ type: 'config/device_registry/list' });
            const entities = await this._hass.callWS({ type: 'config/entity_registry/list' });
            const entries = await this._hass.callWS({ type: 'config_entries/get', domain: 'local_grow_box' });
            // console.log("Fetched entries:", entries);

            // Filter: Look for devices with identifiers matching our domain
            const myDevices = devices.filter(d =>
                d.identifiers && d.identifiers.some(id => id[0] === 'local_grow_box')
            );

            // map() with async is tricky, use Promise.all
            this._devices = await Promise.all(myDevices.map(async device => {
                const deviceEntities = entities.filter(e => e.device_id === device.id);
                const entry = entries.find(e => e.entry_id === device.primary_config_entry);

                // console.log(`[FETCH] Device: ${device.name} (${device.id})`);

                // Fetch actual config via custom command because standard list might exclude options
                let combinedOptions = {};
                if (entry) {
                    try {
                        const confResp = await this._hass.callWS({
                            type: 'local_grow_box/get_config',
                            entry_id: entry.entry_id
                        });
                        combinedOptions = confResp.config || {};
                        // console.log(`[FETCH] -> Fetched Config:`, combinedOptions);
                    } catch (e) {
                        console.warn(`[FETCH] Failed to fetch config for ${device.name}:`, e);
                    }
                }

                const findEntity = (uniqueIdSuffix) => {
                    const ent = deviceEntities.find(e => e.unique_id.endsWith(uniqueIdSuffix));
                    return ent ? ent.entity_id : null;
                };

                return {
                    name: device.name_by_user || device.name,
                    id: device.id,
                    entryId: entry ? entry.entry_id : null,
                    options: combinedOptions,
                    entities: {
                        phase: findEntity('_phase'),
                        master: findEntity('_master_switch'),
                        vpd: findEntity('_vpd'),
                        pump: findEntity('_water_pump'),
                        humidifier: findEntity('_humidifier_switch'),
                        days: findEntity('_days_in_phase'),
                    }
                };
            }));

            if (this.shadowRoot && this.shadowRoot.querySelector('.header')) {
                this._updateContent();
            } else {
                this._render();
            }
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

    async _fetchGrows(entryId = null) {
        if (!this._hass || !this._devices) return;
        try {
            for (const device of this._devices) {
                if (entryId && device.entryId !== entryId) continue;
                const res = await this._hass.callWS({
                    type: 'local_grow_box/get_grows',
                    entry_id: device.entryId
                });
                device.grows = res.grows || [];
                
                // Also fetch VPD history for the active grow if in diary tab
                if (this._activeTab === 'diary') {
                    const active = device.grows.find(g => g.status === 'active');
                    if (active && device.entities.vpd) {
                        this.fetchHistoryData(device.entities.vpd);
                    }
                }
            }
            if (this._activeTab === 'diary') {
                this._renderDiary(this.shadowRoot.getElementById('main-content'));
            }
        } catch (e) {
            console.error("Fetch grows error:", e);
        }
    }

    _renderSparkline(svg, data, minTarget, maxTarget) {
        if (!data || data.length === 0) return;
        
        const validData = data.filter(d => d && d.state && !isNaN(parseFloat(d.state)));
        if (validData.length === 0) return;

        const points = validData.map(s => ({
            x: new Date(s.last_changed).getTime(),
            y: parseFloat(s.state)
        }));

        // Extension logic to current time (like in _fetchHistory)
        if (points.length === 1) {
            points.push({ x: Date.now(), y: points[0].y });
        } else if (points.length > 1) {
            const lastPoint = points[points.length - 1];
            if (Date.now() - lastPoint.x > 60000) {
                 points.push({ x: Date.now(), y: lastPoint.y });
            }
        }

        const width = 100;
        const height = 40;
        const padding = 2;
        
        const xMin = points[0].x;
        const xMax = points[points.length-1].x;
        const yMin = 0;
        const yMax = Math.max(2.5, ...points.map(p => p.y));
        
        const getX = (val) => ((val - xMin) / (xMax - xMin)) * (width - 2 * padding) + padding;
        const getY = (val) => height - (((val - yMin) / (yMax - yMin)) * (height - 2 * padding) + padding);
        
        // Background target zone
        const targetTop = getY(maxTarget);
        const targetBottom = getY(minTarget);
        
        let html = `
            <rect x="0" y="${targetTop}" width="${width}" height="${targetBottom - targetTop}" fill="rgba(16, 185, 129, 0.15)" />
            <line x1="0" y1="${targetTop}" x2="${width}" y2="${targetTop}" stroke="rgba(16, 185, 129, 0.3)" stroke-width="0.5" stroke-dasharray="2,2" />
            <line x1="0" y1="${targetBottom}" x2="${width}" y2="${targetBottom}" stroke="rgba(16, 185, 129, 0.3)" stroke-width="0.5" stroke-dasharray="2,2" />
        `;
        
        // Path
        let path = `M ${getX(points[0].x)} ${getY(points[0].y)}`;
        for (let i = 1; i < points.length; i++) {
            path += ` L ${getX(points[i].x)} ${getY(points[i].y)}`;
        }
        
        html += `<path d="${path}" fill="none" stroke="var(--primary-color)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`;
        
        svg.innerHTML = html;
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

                    /* Force HA Light Theme compatibility */
                    --primary-text-color: #f9fafb;
                    --secondary-text-color: #9ca3af;
                    --paper-input-container-color: rgba(255, 255, 255, 0.5);
                    --paper-input-container-focus-color: #03a9f4;
                    --mdc-theme-primary: #03a9f4;
                    --mdc-text-field-ink-color: #ffffff;
                    --mdc-select-ink-color: #ffffff;
                    --mdc-text-field-label-ink-color: #9ca3af;
                    --mdc-text-field-fill-color: rgba(255, 255, 255, 0.05);

                    font-family: 'Roboto', sans-serif;
                    display: block;
                    /* Modern Tech Pattern Background */
                    background-color: #0b1121;
                    background-image: 
                        radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.08) 0px, transparent 50%), 
                        radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.08) 0px, transparent 50%), 
                        radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
                    background-size: 100% 100%, 100% 100%, 24px 24px;
                    background-attachment: fixed;
                    min-height: 100vh;
                    color: var(--text-primary);
                }
                

                
                /* Layout */
                .header { 
                    background-color: var(--card-bg); 
                    padding: 16px 24px; 
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                    display: flex; align-items: center; 
                }
                .header h1 { 
                    margin: 0; 
                    font-size: 24px; 
                    font-weight: 800; 
                    background: linear-gradient(135deg, #4ade80 0%, #3b82f6 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    display: flex; align-items: center; gap: 8px;
                    letter-spacing: -0.5px;
                    text-transform: uppercase;
                }
                
                .tabs { 
                    display: flex; gap: 8px; margin-left: auto; margin-right: 0; 
                    background: rgba(0,0,0,0.3); padding: 4px; border-radius: 20px;
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .tab { 
                    cursor: pointer; padding: 6px 16px; border-radius: 16px;
                    opacity: 0.7; transition: all 0.2s; text-transform: uppercase; 
                    font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
                    color: var(--text-secondary);
                    border: 1px solid transparent;
                }
                .tab:hover { opacity: 1; color: var(--text-primary); background: rgba(255,255,255,0.05); }
                .tab.active { 
                    opacity: 1; 
                    background: var(--primary-color); 
                    color: white; 
                    box-shadow: 0 2px 8px rgba(3, 169, 244, 0.25);
                    border-color: rgba(255,255,255,0.1);
                }

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
                .controls { 
                    padding: 16px; 
                    background: rgba(0,0,0,0.2); 
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); 
                    gap: 12px; 
                    border-top: 1px solid rgba(255,255,255,0.05);
                }
                .btn {
                    padding: 12px; border-radius: 8px; border: none; cursor: pointer;
                    background: rgba(255,255,255,0.05); color: var(--text-primary);
                    font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 8px;
                    transition: all 0.2s;
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .btn:hover { background: rgba(255,255,255,0.1); transform: translateY(-1px); }
                .btn.active { 
                    background: rgba(3, 169, 244, 0.2); 
                    color: #38bdf8; 
                    border-color: rgba(3, 169, 244, 0.4);
                }
                
                /* Enhanced UI Elements */
                .status-badge {
                    font-size: 11px; padding: 4px 10px; border-radius: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;
                }
                .status-badge.online { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }
                .status-badge.offline { background: rgba(107, 114, 128, 0.15); color: #9ca3af; border: 1px solid rgba(107, 114, 128, 0.2); }

                .info-box {
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 10px;
                    padding: 10px 12px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                .info-icon { font-size: 20px; line-height: 1; opacity: 0.9; }
                .info-content { display: flex; flex-direction: column; gap: 2px; }
                .info-label { font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
                .info-val { font-size: 13px; font-weight: 500; color: var(--text-primary); }
                
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
                    display: none; align-items: center; gap: 8px; font-weight: 500;
                    z-index: 100;
                }
                .save-bar.visible { display: flex; animation: slideUp 0.3s ease-out; }
                
                @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

                /* Modal */
                .modal {
                    display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%;
                    background-color: rgba(0,0,0,0.9); backdrop-filter: blur(8px);
                    align-items: center; justify-content: center;
                }
                .modal.visible { display: flex; animation: fadeIn 0.2s; }
                .modal-content {
                    background: var(--card-bg); padding: 16px; border-radius: 12px; 
                    max-width: 95%; max-height: 95vh; overflow: auto;
                    position: relative; border: 1px solid rgba(255,255,255,0.1);
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                .close-modal {
                    position: absolute; top: -40px; right: 0; color: #fff; font-size: 30px; font-weight: bold; cursor: pointer;
                    background: rgba(0,0,0,0.5); width: 40px; height: 40px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                }
                .close-modal:hover { background: rgba(255,255,255,0.2); }

                /* Mobile Responsive */
                @media (max-width: 600px) {
                    .header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 12px;
                        padding: 12px 16px;
                    }
                    .tabs {
                        margin-left: 0;
                        width: 100%;
                        overflow-x: auto;
                        justify-content: flex-start;
                        padding-bottom: 8px;
                        background: transparent;
                        border: none;
                        padding: 0;
                    }
                    .tab {
                        flex-shrink: 0;
                        font-size: 11px;
                        padding: 8px 12px;
                        background: rgba(255,255,255,0.08);
                        margin-right: 6px;
                        white-space: nowrap;
                    }
                    .tab.active {
                        background: var(--primary-color);
                    }
                    .content { padding: 12px; }
                    .card-body { padding: 12px; }
                    .controls {
                        grid-template-columns: 1fr;
                        gap: 8px;
                    }
                    /* Mobile Diary Adjustments */
                    .diary-active-grid {
                        grid-template-columns: 1fr !important;
                        gap: 16px !important;
                    }
                    .active-grow-card {
                        padding: 15px !important;
                    }
                    .btn {
                        padding: 14px !important; /* Larger touch targets */
                    }
                }
            </style>
            
            <div class="header">
                <div style="display:flex; align-items:center; gap:12px;">
                    <h1>🌱 <span>Grow Room</span></h1>
                </div>
                <div class="tabs">
                    <div class="tab active" data-tab="overview">Übersicht</div>
                    <div class="tab" data-tab="statistics">Statistiken</div>
                    <div class="tab" data-tab="settings">Geräte & Config</div>
                    <div class="tab" data-tab="phases">Phasen</div>
                    <div class="tab" data-tab="logs">Protokoll</div>
                    <div class="tab" data-tab="diary">Tagebuch</div>
                    <div class="tab" data-tab="recipes">Rezepte 📋</div>
                    <div class="tab" data-tab="info">Info / Hilfe</div>
                </div>
            </div>
            
            <div class="content" id="main-content"></div>
            
            <div id="save-toast" class="save-bar">
                <span>✅</span> Einstellungen gespeichert!
            </div>
            
            <!-- Camera Modal -->
            <div id="camera-modal" class="modal">
                <div class="close-modal">&times;</div>
                <div class="modal-content">
                    <img id="modal-img" src="" style="width:100%; height:auto; display:block; border-radius:8px;">
                    <div id="modal-title" style="margin-top:12px; font-size:16px; font-weight:500; text-align:center;"></div>
                </div>
            </div>

            <div style="text-align:center; padding:32px; margin-top:40px; border-top: 1px solid rgba(255,255,255,0.1);">
                <span style="font-size:14px; opacity:0.8; letter-spacing: 0.5px; color:var(--text-secondary);">Powered by</span>
                <a href="https://openkairo.de" target="_blank" style="
                    display: inline-block;
                    margin-left: 8px;
                    color: #38bdf8; /* Bright Cyan/Blue */
                    text-decoration: none;
                    font-weight: 900;
                    font-size: 16px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    text-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
                    transition: all 0.3s ease;
                ">
                    OpenKAIRO
                </a>
            </div>
        `;

        this.shadowRoot.innerHTML = style;

        // Tab Event Listeners
        this.shadowRoot.querySelectorAll('.tab').forEach(t => {
            t.addEventListener('click', (e) => {
                this._activeTab = e.target.dataset.tab;
                if (this._activeTab === 'diary') {
                    this._fetchGrows();
                }

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
        } else if (this._activeTab === 'statistics') {
            this._renderStatistics(container);
        } else if (this._activeTab === 'settings') {
            this._renderSettings(container);
        } else if (this._activeTab === 'phases') {
            this._renderPhases(container);
        } else if (this._activeTab === 'logs') {
            this._renderLogs(container);
        } else if (this._activeTab === 'diary') {
            this._renderDiary(container);
        } else if (this._activeTab === 'recipes') {
            this._renderRecipes(container);
        } else if (this._activeTab === 'info') {
            this._renderInfo(container);
        }
    }

    _renderOverview(container) {
        if (this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden. Bitte Integration hinzufügen.</div>';
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'grid';

        // Phase Hours Map (default)
        const PHASE_HOURS = {
            'seedling': 18,
            'vegetative': 18,
            'flowering': 12,
            'drying': 0,
            'curing': 0
        };
        const PHASES = [
            { id: 'seedling', label: '🌱 Keimling' },
            { id: 'vegetative', label: '🌿 Wachstum' },
            { id: 'flowering', label: '🌸 Blüte' },
            { id: 'drying', label: '🍂 Trocknen' },
            { id: 'curing', label: '🏺 Veredelung' }
        ];

        this._devices.forEach(device => {
            const card = document.createElement('div');
            card.className = 'card';

            // Data
            const masterState = this._hass.states[device.entities.master];
            const pumpState = this._hass.states[device.entities.pump];
            const daysInPhase = this._hass.states[device.entities.days]?.state || 0;
            // Fix: Prioritize options over sensor state to avoid stale data after update
            const currentPhase = device.options.current_phase || this._hass.states[device.entities.phase]?.state || 'vegetative';

            // --- Light Timer Logic ---
            // --- Light Timer Logic ---
            let lightInfo = "Unbekannt";
            // Use ACTUAL state for the icon/visual
            const realLightState = this._hass.states[device.options.light_entity]?.state;
            const isLightOn = realLightState === 'on';
            // Variable used by rendering for Icon/Color
            let lightStatus = isLightOn ? 'on' : 'off';

            const startHour = parseInt(device.options.light_start_hour || 18);
            let duration = PHASE_HOURS[currentPhase] || 12;
            if (device.options[`${currentPhase}_hours`]) duration = parseFloat(device.options[`${currentPhase}_hours`]);

            // Format Schedule Display (e.g. 13:00 - 07:00)
            const endTotal = startHour + duration;
            const endH = Math.floor(endTotal % 24);
            const endM = Math.floor((endTotal % 1) * 60);
            // Simple check: if duration is integer, don't show :00 for end if you want cleaner look, but consistency is good.
            const fmtSchedule = `${startHour}:00 - ${endH}:${endM.toString().padStart(2, '0')}`;

            const now = new Date();
            const start = new Date(now);
            start.setHours(startHour, 0, 0, 0);

            let startTime = start.getTime();
            let endTime = startTime + (duration * 3600 * 1000);

            if (now.getHours() < startHour) {
                startTime -= 24 * 3600 * 1000;
                endTime -= 24 * 3600 * 1000;
            }

            const nowTime = now.getTime();
            const isLightTime = nowTime >= startTime && nowTime < endTime;

            if (isLightTime) {
                const remainingMs = endTime - nowTime;
                const hrs = Math.floor(remainingMs / (1000 * 60 * 60));
                const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

                if (isLightOn) {
                    lightInfo = `An (noch ${hrs}h ${mins}m)<br><span style="font-size:10px; opacity:0.7">${fmtSchedule}</span>`;
                } else {
                    lightInfo = `Aus (Sollte AN sein!)<br><span style="font-size:10px; opacity:0.7">${fmtSchedule}</span>`;
                }
            } else {
                let nextStart = startTime + 24 * 3600 * 1000;
                if (nowTime > endTime) {
                    nextStart = startTime + 24 * 3600 * 1000;
                }
                const untilStart = nextStart - nowTime;
                const hrs = Math.floor(untilStart / (1000 * 60 * 60));
                const mins = Math.floor((untilStart % (1000 * 60 * 60)) / (1000 * 60));

                if (isLightOn) {
                    lightInfo = `An (Sollte AUS sein!)<br><span style="font-size:10px; opacity:0.7">${fmtSchedule}</span>`;
                } else {
                    lightInfo = `Aus (Start in ${hrs}h ${mins}m)<br><span style="font-size:10px; opacity:0.7">${fmtSchedule}</span>`;
                }
            }



            // Image Logic with Cache Busting (Persisted)
            const imgVer = device.options.image_version || 0;
            let imgUrl = `/local/local_grow_box_images/${device.id}.jpg?v=${imgVer}`;
            let isLive = false;
            let camStateObj = null;
            if (device.options.camera_entity) {
                camStateObj = this._hass.states[device.options.camera_entity];
                if (camStateObj && camStateObj.attributes.entity_picture) {
                    imgUrl = camStateObj.attributes.entity_picture;
                    isLive = true;
                }
            }

            // Calculations for Bars
            const getVal = (entity) => {
                if (!entity) return null;
                const s = this._hass.states[entity];
                return s && !isNaN(s.state) ? Math.round(parseFloat(s.state) * 100) / 100 : null;
            }

            const temp = getVal(device.options.temp_sensor);
            const hum = getVal(device.options.humidity_sensor);
            const vpd = getVal(device.entities.vpd);

            const targetHum = parseFloat(device.options.target_humidity || 65);
            const targetTemp = parseFloat(device.options.target_temp || 24);
            const humHysteresis = parseFloat(device.options.humidity_hysteresis || 2);
            const tempHysteresis = parseFloat(device.options.temp_hysteresis || 1);
            
            // Symmetric Target Zones (+/- Hysteresis)
            const humTarget = { min: targetHum - humHysteresis, max: targetHum + humHysteresis };
            const tempTarget = { min: targetTemp - tempHysteresis, max: targetTemp + tempHysteresis };

            let vpdTarget = null;
            if (currentPhase === 'seedling') vpdTarget = { min: 0.4, max: 0.8 };
            else if (currentPhase === 'vegetative') vpdTarget = { min: 0.8, max: 1.2 };
            else if (currentPhase === 'flowering') vpdTarget = { min: 1.2, max: 1.6 };
            else if (currentPhase === 'drying') vpdTarget = { min: 0.8, max: 1.0 };
            else if (currentPhase === 'curing') vpdTarget = { min: 0.5, max: 0.7 };

            // Phase Options HTML
            const phaseOptions = PHASES.map(p =>
                `<option value="${p.id}" ${currentPhase === p.id ? 'selected' : ''}>${p.label}</option>`
            ).join('');

            card.innerHTML = `
                <div class="card-image">
                    <img src="${imgUrl}" onerror="this.src='https://upload.wikimedia.org/wikipedia/commons/1/14/No_Image_Available.jpg'">
                    ${isLive ? '<div class="live-badge">LIVE</div>' : ''}
                    <div style="position:absolute; bottom:0; left:0; right:0; padding:12px; background:linear-gradient(to top, rgba(0,0,0,0.9), transparent); display:flex; justify-content:space-between; align-items:end;">
                        <div>
                             <select class="phase-select" id="phase-select-${device.id}" style="
                                background: rgba(0,0,0,0.6); 
                                border: 1px solid rgba(255,255,255,0.2); 
                                color: white; 
                                padding: 4px 8px; 
                                border-radius: 4px; 
                                font-size: 14px;
                                cursor: pointer;
                                outline: none;
                             ">
                                ${phaseOptions}
                            </select>
                            <div style="color:white; font-weight:500; font-size:13px; margin-top:6px; margin-left:2px; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">Tag ${daysInPhase}</div>
                        </div>
                    </div>
                </div>
                
                <div class="card-header">
                    <div class="card-title">${device.name}</div>
                    <div class="status-badge ${masterState && masterState.state === 'on' ? 'online' : 'offline'}">
                        ${masterState && masterState.state === 'on' ? '● Online' : '○ Offline'}
                    </div>
                </div>
                
                <div class="card-body">
                    ${this._renderStatBar('Temperatur', temp, '°C', 10, 45, '#ef4444', '🌡️', tempTarget)}
                    ${this._renderStatBar('Luftfeuchte', hum, '%', 20, 90, '#3b82f6', '💧', humTarget)}
                    ${this._renderStatBar('VPD', vpd, 'kPa', 0, 3.0, '#10b981', '🍃', vpdTarget)}
                    ${device.options.moisture_sensor ? this._renderStatBar('Bodenfeuchte', getVal(device.options.moisture_sensor), '%', 0, 100, '#8b5cf6', '🪴') : ''}
                    
                    <div style="margin-top:16px; border-top:1px solid rgba(255,255,255,0.05); padding-top:16px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                        
                        <div class="info-box">
                            <div class="info-icon">⚡</div>
                            <div class="info-content">
                                <div class="info-label">Leistung</div>
                                <div class="info-val">${Math.round(this._getSummedValue(device.options.power_sensor) || 0)} W</div>
                            </div>
                        </div>


                        <div class="info-box">
                            <div class="info-icon">${lightStatus === 'on' ? '💡' : '🌑'}</div>
                            <div class="info-content">
                                <div class="info-label">Licht</div>
                                <div class="info-val" style="font-size:12px;">${lightInfo}</div>
                            </div>
                        </div>

                         <div class="info-box">
                            <div class="info-icon">${this._hass.states[device.options.fan_entity]?.state === 'on' ? '🌪️' : '💨'}</div>
                            <div class="info-content">
                                <div class="info-label">Abluft</div>
                                <div class="info-val">${this._hass.states[device.options.fan_entity]?.state === 'on' ? 'An' : 'Aus'}</div>
                            </div>
                        </div>
                        
                        ${device.options.pump_entity ? `
                        <div class="info-box">
                            <div class="info-icon">${pumpState?.state === 'on' ? '💧' : '⛔'}</div>
                            <div class="info-content">
                                <div class="info-label">Pumpe</div>
                                <div class="info-val">${pumpState?.state === 'on' ? 'Läuft' : 'Aus'}</div>
                            </div>
                        </div>
                        ` : ''}

                        ${device.options.humidifier_entity ? `
                         <div class="info-box">
                            <div class="info-icon">${this._hass.states[device.options.humidifier_entity]?.state === 'on' ? '💦' : '🌫️'}</div>
                            <div class="info-content">
                                <div class="info-label">Befeuchter</div>
                                <div class="info-val">${this._hass.states[device.options.humidifier_entity]?.state === 'on' ? 'An' : 'Aus'}</div>
                            </div>
                        </div>
                        ` : `
                        <div class="info-box" style="opacity:0.4;">
                            <div class="info-icon">🌫️</div>
                            <div class="info-content">
                                <div class="info-label">Befeuchter</div>
                                <div class="info-val">Nicht konfiguriert</div>
                            </div>
                        </div>
                        `}
                    </div>
                </div>
                
                <div class="controls">
                    <button class="btn ${masterState?.state === 'on' ? 'active' : ''}" id="btn-master-${device.id}">
                        ⚡ Master
                    </button>
                    ${device.options.pump_entity ? `
                    <button class="btn ${pumpState?.state === 'on' ? 'active' : ''}" id="btn-pump-${device.id}">
                        💧 Pumpe
                    </button>
                    ` : ''}
                    ${device.options.humidifier_entity ? `
                    <button class="btn ${this._hass.states[device.options.humidifier_entity]?.state === 'on' ? 'active' : ''}" id="btn-humid-${device.id}">
                        💦 Befeuchter
                    </button>
                    ` : ''}
                    <button class="btn" id="btn-upload-${device.id}">
                        📷 Bild
                    </button>
                </div>
            `;

            // Events
            const q = s => card.querySelector(s);
            q(`#btn-master-${device.id}`).onclick = () => this._toggle(device.entities.master);
            const btnPump = q(`#btn-pump-${device.id}`);
            if (btnPump) btnPump.onclick = () => this._toggle(device.entities.pump || device.options.pump_entity);
            const btnHumid = q(`#btn-humid-${device.id}`);
            if (btnHumid) btnHumid.onclick = () => this._toggle(device.entities.humidifier || device.options.humidifier_entity);
            q(`#btn-upload-${device.id}`).onclick = () => this._triggerUpload(device.id);
            q('.card-image').style.cursor = 'pointer';
            q('.card-image').onclick = (e) => {
                // Prevent click if clicking the select or badge
                if (e.target.tagName === 'SELECT' || e.target.closest('.phase-select')) return;
                this._openCameraModal(imgUrl, device.name, camStateObj);
            };

            // Inject Livestream into Card if Live
            if (isLive && camStateObj) {
                const imgContainer = q('.card-image');
                const oldImg = q('img');
                if (oldImg) oldImg.style.display = 'none';

                const stream = document.createElement('ha-camera-stream');
                stream.hass = this._hass;
                stream.stateObj = camStateObj;
                stream.muted = true;
                stream.allowExoplayer = true;
                stream.style.cssText = "width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; position:absolute; top:0; left:0; opacity:0.8;";

                imgContainer.insertBefore(stream, imgContainer.firstChild);
            }

            // Phase Change Event
            const phaseSelect = q(`#phase-select-${device.id}`);
            phaseSelect.onchange = async (e) => {
                const newPhase = e.target.value;
                if (confirm(`Phase wirklich auf "${PHASES.find(p => p.id === newPhase).label}" ändern?`)) {
                    try {
                        await this._hass.callWS({
                            type: 'local_grow_box/update_config',
                            entry_id: device.entryId,
                            config: { current_phase: newPhase }
                        });
                        // Optimistic update or wait for reload
                        // setTimeout(() => this._fetchDevices(), 500); // Reload data
                        // actually config update should trigger reload via HA events if wired? 
                        // But _fetchDevices is manual. Let's trigger it.
                        this._fetchDevices();
                    } catch (err) {
                        alert("Fehler beim Ändern der Phase: " + err);
                    }
                } else {
                    e.target.value = currentPhase; // Revert
                }
            };

            grid.appendChild(card);
        });

        container.appendChild(grid);
    }

    _openCameraModal(url, title, camStateObj = null) {
        const modal = this.shadowRoot.getElementById('camera-modal');
        const content = modal.querySelector('.modal-content');
        const txt = this.shadowRoot.getElementById('modal-title');

        // Remove old media
        const oldImg = this.shadowRoot.getElementById('modal-img');
        if (oldImg) oldImg.remove();
        const oldStream = this.shadowRoot.getElementById('modal-stream');
        if (oldStream) oldStream.remove();

        if (camStateObj) {
            const stream = document.createElement('ha-camera-stream');
            stream.id = 'modal-stream';
            stream.hass = this._hass;
            stream.stateObj = camStateObj;
            stream.muted = true;
            stream.controls = true;
            stream.allowExoplayer = true;
            stream.style.cssText = "width:100%; height:auto; display:block; border-radius:8px;";
            content.insertBefore(stream, txt);
        } else {
            const img = document.createElement('img');
            img.id = 'modal-img';
            img.style.cssText = "width:100%; height:auto; display:block; border-radius:8px;";
            img.src = url.includes('?') ? url + '&t=' + Date.now() : url + '?t=' + Date.now();
            content.insertBefore(img, txt);
        }

        txt.innerText = title;
        modal.classList.add('visible');

        const cleanup = () => {
            modal.classList.remove('visible');
            const toRemove = this.shadowRoot.getElementById('modal-stream');
            if (toRemove) toRemove.remove(); // Stop stream on close
        };

        const close = modal.querySelector('.close-modal');
        close.onclick = cleanup;
        modal.onclick = (e) => {
            if (e.target === modal) cleanup();
        }
    }

    _renderStatBar(label, val, unit, min, max, color, icon, targetRange) {
        if (val === null) return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">--</span></div>`;

        const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));

        // Target Area Rendering
        let targetArea = '';
        if (targetRange) {
            const tMinPct = Math.min(100, Math.max(0, ((targetRange.min - min) / (max - min)) * 100));
            const tMaxPct = Math.min(100, Math.max(0, ((targetRange.max - min) / (max - min)) * 100));
            const width = tMaxPct - tMinPct;

            targetArea = `<div style="position:absolute; left:${tMinPct}%; width:${width}%; height:100%; background:rgba(255,255,255,0.3); z-index:1;"></div>`;
            label += ` <span style="font-size:10px; opacity:0.7;">(Ziel: ${targetRange.min}-${targetRange.max})</span>`;
        }

        return `
            <div style="margin-bottom:12px;">
                <div class="stat-row" style="margin-bottom:4px;">
                    <span class="stat-label">${label}</span>
                    <span class="stat-value">${val} ${unit}</span>
                </div>
                <div class="bar-bg" style="position:relative;">
                    ${targetArea}
                    <div class="bar-fill" style="width:${pct}%; background-color:${color}; position:relative; z-index:2; opacity:0.8;"></div>
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
                picker.id = `picker-${device.id}-${configKey}`;
                picker.dataset.key = configKey; // For saving

                // Draft logic
                const entryId = device.entryId;
                const draftVal = this._draft[entryId] && this._draft[entryId][configKey];
                const storedVal = device.options[configKey];
                const finalVal = (draftVal !== undefined) ? draftVal : (storedVal || '');

                // Append to DOM first - Critical for some Custom Elements
                group.appendChild(picker);
                parent.appendChild(group);

                // Function to set properties safely
                const setProps = () => {
                    picker.hass = this._hass;
                    picker.includeDomains = domains;

                    if (finalVal) {
                        picker.value = finalVal;
                    }
                    // Double check value set after a microtask for LitElement reactivity
                    setTimeout(() => {
                        if (finalVal && picker.value !== finalVal) {
                            picker.value = finalVal;
                        }
                    }, 50);
                };

                // Initialize properties
                if (customElements.get('ha-entity-picker')) {
                    setProps();
                } else {
                    customElements.whenDefined('ha-entity-picker').then(setProps);
                }

                // Listen for changes
                picker.addEventListener('value-changed', (ev) => {
                    const v = ev.detail?.value;
                    if (v !== undefined) {
                        if (!this._draft[entryId]) this._draft[entryId] = {};
                        this._draft[entryId][configKey] = v;
                    }
                });
            };

            // NEW: HA Selector Helper (Modern)
            const appendSelector = (parent, label, configKey, domain, multiple = false) => {
                const group = document.createElement('div');
                group.className = 'form-group';
                group.style.marginBottom = '12px';

                const selector = document.createElement('ha-selector');
                selector.label = label;
                const entryId = device.entryId;
                const draftVal = this._draft[entryId] && this._draft[entryId][configKey];
                const storedVal = device.options[configKey];
                const finalVal = (draftVal !== undefined) ? draftVal : (storedVal || '');

                selector.hass = this._hass;
                selector.selector = { entity: { domain: domain, multiple: multiple } };
                selector.value = finalVal;
                selector.required = false;

                selector.addEventListener('value-changed', (ev) => {
                    const v = ev.detail?.value;
                    if (!this._draft[entryId]) this._draft[entryId] = {};
                    this._draft[entryId][configKey] = (v === undefined || v === null || v === '') ? '' : v;
                });

                group.appendChild(selector);
                parent.appendChild(group);
            };

            // DOM-based Helper for Input
            const appendInput = (parent, label, configKey, type = 'text', icon = '') => {
                const group = document.createElement('div');
                group.className = 'form-group';
                group.style.marginBottom = '12px';

                const lbl = document.createElement('label');
                lbl.className = 'form-label';
                lbl.style.display = 'flex';
                lbl.style.alignItems = 'center';
                lbl.style.gap = '8px';
                lbl.innerHTML = `${icon ? `<span style="font-size:16px;">${icon}</span>` : ''} ${label}`;
                group.appendChild(lbl);

                const input = document.createElement('input');
                input.type = type;
                input.style.marginTop = '4px';

                const draftVal = this._draft[device.entryId] && this._draft[device.entryId][configKey];
                const storedVal = device.options[configKey] !== undefined ? device.options[configKey] : '';
                input.value = (draftVal !== undefined) ? draftVal : storedVal;

                input.addEventListener('input', (e) => {
                    if (!this._draft[device.entryId]) this._draft[device.entryId] = {};
                    this._draft[device.entryId][configKey] = e.target.value;
                });

                group.appendChild(input);
                parent.appendChild(group);
            };

            // NEW: Card Helper
            const createCard = (title, icon) => {
                const card = document.createElement('div');
                card.style.cssText = "background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 4px;";
                
                const header = document.createElement('div');
                header.style.cssText = "display: flex; align-items: center; gap: 10px; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;";
                header.innerHTML = `<span style="font-size: 20px;">${icon}</span> <span style="font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--primary-color);">${title}</span>`;
                card.appendChild(header);

                const body = document.createElement('div');
                body.style.display = 'flex';
                body.style.flexDirection = 'column';
                body.style.gap = '8px';
                card.appendChild(body);

                return { card, body };
            };

            const settingsGrid = document.createElement('div');
            settingsGrid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 24px; width: 100%;";

            // Card 1: Klima & Geräte
            const cardKlimaEntities = createCard('Klima & Geräte', '🌪️');
            appendSelector(cardKlimaEntities.body, 'Temperatur Sensor', 'temp_sensor', ['sensor']);
            appendSelector(cardKlimaEntities.body, 'Feuchtigkeits Sensor', 'humidity_sensor', ['sensor']);
            appendSelector(cardKlimaEntities.body, 'Abluft Ventilator', 'fan_entity', ['switch', 'fan', 'input_boolean']);
            appendSelector(cardKlimaEntities.body, 'Luftbefeuchter', 'humidifier_entity', ['switch', 'input_boolean', 'humidifier']);
            appendSelector(cardKlimaEntities.body, 'Stromzähler (kWh)', 'energy_sensor', ['sensor'], true);
            appendSelector(cardKlimaEntities.body, 'Leistungssensor (W)', 'power_sensor', ['sensor'], true);
            
            const rowPrice = document.createElement('div');
            rowPrice.className = 'form-group';
            rowPrice.innerHTML = `<label>Strompreis (€/kWh)</label>`;
            const inputPrice = document.createElement('input');
            inputPrice.type = 'number';
            inputPrice.step = '0.01';
            inputPrice.style.cssText = "width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:white; padding:8px; border-radius:4px;";
            inputPrice.value = device.options.electric_price || 0.35;
            inputPrice.onchange = (e) => {
                this._draft[device.entryId] = this._draft[device.entryId] || {};
                this._draft[device.entryId].electric_price = parseFloat(e.target.value);
            };
            rowPrice.appendChild(inputPrice);
            cardKlimaEntities.body.appendChild(rowPrice);

            settingsGrid.appendChild(cardKlimaEntities.card);

            // Card 2: Klima-Sollwerte
            const cardKlimaValues = createCard('Klima-Sollwerte', '🎯');
            appendInput(cardKlimaValues.body, 'Ziel Temperatur (°C)', 'target_temp', 'number', '🌡️');
            appendInput(cardKlimaValues.body, 'Temp Hysterese (Lüfter °C)', 'temp_hysteresis', 'number', '🌡️');
            appendInput(cardKlimaValues.body, 'Ziel Feuchte (%)', 'target_humidity', 'number', '🎯');
            appendInput(cardKlimaValues.body, 'Feuchte Hysterese (Befeuchter %)', 'humidity_hysteresis', 'number', '🔄');
            appendInput(cardKlimaValues.body, 'Abluft-Limit (Max %)', 'max_humidity', 'number', '🌪️');
            appendInput(cardKlimaValues.body, 'Abluft Hysterese (%)', 'fan_hysteresis', 'number', '💨');
            settingsGrid.appendChild(cardKlimaValues.card);

            // Card 3: Bewässerung & Licht
            const cardWaterLight = createCard('Bewässerung & Licht', '💧');
            appendSelector(cardWaterLight.body, 'Licht Quelle', 'light_entity', ['switch', 'light', 'input_boolean']);
            appendSelector(cardWaterLight.body, 'Bodenfeuchte Sensor', 'moisture_sensor', ['sensor']);
            appendSelector(cardWaterLight.body, 'Wasserpumpe', 'pump_entity', ['switch', 'input_boolean']);
            appendInput(cardWaterLight.body, 'Ziel Bodenfeuchte (%)', 'target_moisture', 'number', '🌱');
            appendInput(cardWaterLight.body, 'Pumpen Dauer (Sek)', 'pump_duration', 'number', '⏲️');
            settingsGrid.appendChild(cardWaterLight.card);

            // Card 4: Zeitplan & Erweitert
            const cardAdvanced = createCard('Zeitplan & Erweitert', '📅');
            appendInput(cardAdvanced.body, 'Licht Start (Stunde 0-23)', 'light_start_hour', 'number', '☀️');
            appendInput(cardAdvanced.body, 'Phasen Startdatum', 'phase_start_date', 'date', '🏁');
            appendSelector(cardAdvanced.body, 'Kamera', 'camera_entity', ['camera']);
            settingsGrid.appendChild(cardAdvanced.card);

            section.appendChild(settingsGrid);

            // Save Button
            const btnDiv = document.createElement('div');
            btnDiv.style.cssText = "margin-top:32px; text-align:right;";
            const btn = document.createElement('button');
            btn.className = 'btn active';
            btn.style.cssText = "width:auto; display:inline-flex; padding:12px 32px; font-weight:700;";
            btn.id = `save-${device.id}`;
            btn.innerText = 'Einstellungen Speichern';
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

            const renderPhaseRow = (label, sub, icon, configKey, val) => `
                <div style="
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between; 
                    background: rgba(255,255,255,0.03); 
                    border: 1px solid rgba(255,255,255,0.05);
                    border-radius: 8px; 
                    padding: 12px 16px; 
                    margin-bottom: 8px;
                ">
                    <div style="display:flex; align-items:center; gap:16px;">
                        <span style="font-size:24px;">${icon}</span>
                        <div>
                            <div style="font-weight:500; font-size:14px;">${label}</div>
                            <div style="font-size:11px; color:var(--text-secondary);">${sub}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <input type="number" value="${val}" data-key="${configKey}" data-entry="${device.entryId}" 
                            style="width:70px; text-align:center; font-weight:bold; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); padding:8px; border-radius:6px;">
                        <span style="font-size:12px; color:var(--text-secondary); width:50px;">Std.</span>
                    </div>
                </div>
            `;

            section.innerHTML = `
                <div class="section-title">${device.name} - Phasen Management</div>
                <p style="color:var(--text-secondary); margin-bottom:24px; font-size:13px; line-height:1.5;">
                    Definiere hier die tägliche Beleuchtungsdauer für jede Wachstumsphase. 
                    <br>Das System schaltet basierend auf der aktuellen Phase automatisch um.
                </p>

                <div style="display:flex; flex-direction:column; gap:8px; max-width:600px;">
                    ${renderPhaseRow('Keimling', 'Hohe Luftfeuchte (65-80%), 20-25°C, sanftes Licht', '🌱', 'phase_seedling_hours', device.options.phase_seedling_hours !== undefined ? device.options.phase_seedling_hours : 18)}
                    ${renderPhaseRow('Wachstum', 'Viel Stickstoff, 18h Licht, RLF 50-70%', '🌿', 'phase_vegetative_hours', device.options.phase_vegetative_hours !== undefined ? device.options.phase_vegetative_hours : 18)}
                    ${renderPhaseRow('Blüte', '12h Licht zwingend, RLF <50% (Schimmelgefahr!), P-K Dünger', '🌸', 'phase_flowering_hours', device.options.phase_flowering_hours !== undefined ? device.options.phase_flowering_hours : 12)}
                    ${renderPhaseRow('Trocknen', 'Dunkel & Kühl (18-20°C), 50-60% RLF, 10-14 Tage', '🍂', 'phase_drying_hours', device.options.phase_drying_hours !== undefined ? device.options.phase_drying_hours : 0)}
                    ${renderPhaseRow('Veredelung', 'Im Glas/Bag, RLF stabil bei 58-62% halten', '🏺', 'phase_curing_hours', device.options.phase_curing_hours !== undefined ? device.options.phase_curing_hours : 0)}
                </div>
                
                 <div style="margin-top:24px; max-width:600px; display:flex; justify-content:flex-end;">
                    <button class="btn active" id="save-p-${device.id}" style="width:auto; display:inline-flex; padding:12px 32px;">
                        Speichern
                    </button>
                </div>
            `;

            section.querySelector(`#save-p-${device.id}`).onclick = () => this._saveConfig_V2(section, device.entryId);
            container.appendChild(section);
        });
    }

    async _saveConfig_V2(section, entryId) {
        // Start with draft values if they exist
        const updates = { ...(this._draft && this._draft[entryId] ? this._draft[entryId] : {}) };

        // Inputs
        section.querySelectorAll('input, select').forEach(el => {
            if (el.dataset.key) {
                updates[el.dataset.key] = el.value;
            }
        });

        // Entity Pickers
        // Fix: Don't blindly overwrite from DOM if we have a draft value (DOM might be empty/reset)
        section.querySelectorAll('ha-entity-picker').forEach(el => {
            const key = el.dataset.key;
            if (key) {
                // Only take from DOM if NOT in draft (e.g. initial load unmodified)
                // If user modified it, it's in draft.
                // If user didn't modify, draft is undefined for this key.
                if (updates[key] === undefined) {
                    updates[key] = el.value;
                }
            }
        });

        try {
            console.log("Sending config update for entry:", entryId, updates);
            // Result contains { options: { ... } }
            const result = await this._hass.callWS({
                type: 'local_grow_box/update_config',
                entry_id: entryId,
                config: updates
            });

            console.log("Save successful, received options:", result.options);

            // Update local cache directly to avoid race conditions with registry fetch
            const devIndex = this._devices.findIndex(d => d.entryId === entryId);
            if (devIndex >= 0) {
                // Merge new options into local device options
                this._devices[devIndex].options = {
                    ...this._devices[devIndex].options,
                    ...result.options
                };
            }

            // Clear draft for this entry as it is now saved
            if (this._draft[entryId]) {
                delete this._draft[entryId];
            }

            const toast = this.shadowRoot.getElementById('save-toast');
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 3000);

            // Re-render immediately with local data
            this._updateContent();

        } catch (e) {
            console.error("Save error:", e);
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
                    const device = this._devices.find(d => d.id === deviceId);
                    const result = await this._hass.callWS({
                        type: 'local_grow_box/upload_image',
                        device_id: deviceId,
                        entry_id: device ? device.entryId : null,
                        image: ev.target.result
                    });

                    // Update local state immediately with returned version
                    if (result && result.version) {
                        if (device) {
                            if (!device.options) device.options = {};
                            device.options.image_version = result.version;
                            this._updateContent(); // Instant visual update
                        }
                    }

                    // And refresh from backend to be sure
                    setTimeout(() => this._fetchDevices(), 1000);
                } catch (err) {
                    console.error("Upload error:", err);
                    alert('Upload fehlgeschlagen: ' + (err.message || err));
                }
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    async _renderLogs(container) {
        if (this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden.</div>';
            return;
        }

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; color: var(--text-secondary);">
                <div style="font-size: 32px; margin-bottom: 16px; animation: pulse 1.5s infinite;">🔄</div>
                <div>Lade Protokoll...</div>
            </div>
            <style>@keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }</style>
        `;

        try {
            // Fetch logs for all devices
            let allLogs = [];
            for (const device of this._devices) {
                if (!device.entryId) continue;
                try {
                    const result = await this._hass.callWS({
                        type: 'local_grow_box/get_logs',
                        entry_id: device.entryId
                    });
                    if (result && result.logs) {
                        result.logs.forEach(logLine => {
                            allLogs.push({ devName: device.name, line: logLine });
                        });
                    }
                } catch (err) {
                    console.warn("Could not fetch logs for " + device.name, err);
                }
            }

            container.innerHTML = '';
            const listContainer = document.createElement('div');
            listContainer.style.maxWidth = '800px';
            listContainer.style.margin = '0 auto';
            listContainer.style.background = 'var(--card-bg)';
            listContainer.style.borderRadius = '12px';
            listContainer.style.border = '1px solid rgba(255,255,255,0.05)';
            listContainer.style.overflow = 'hidden';

            // Sort combined logs chronologically (newest first)
            allLogs.sort((a, b) => {
                const parseDate = (str) => {
                    const match = str.match(/^\[(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})\]/);
                    if (!match) return 0;
                    return new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}`).getTime();
                };
                return parseDate(b.line) - parseDate(a.line);
            });

            const header = document.createElement('div');
            header.style.cssText = "padding:16px 20px; font-size:16px; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.05); color:var(--text-primary); display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.2);";
            header.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:22px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.2));">📋</span> 
                    <span>Protokoll-Historie</span>
                </div>
                <button class="btn" id="btn-refresh-logs" style="padding: 6px 16px; font-size: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);">
                    🔄 Aktualisieren
                </button>
            `;
            listContainer.appendChild(header);

            if (allLogs.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = "padding:32px; text-align:center; color:var(--text-secondary);";
                empty.innerText = "Bisher keine Ereignisse protokolliert.";
                listContainer.appendChild(empty);
            } else {
                for (const entry of allLogs) {
                    const item = document.createElement('div');
                    item.style.cssText = "padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.02); display:flex; align-items:center; gap:16px; transition:background 0.2s;";
                    item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.02)';
                    item.onmouseleave = () => item.style.background = 'transparent';

                    let timeStr = "";
                    let msgStr = entry.line;

                    const match = entry.line.match(/^\[(.*?)\]\s+(.*)$/);
                    if (match) {
                        timeStr = match[1];
                        msgStr = match[2];
                    }

                    // Choose icon based on content
                    let icon = '📝';
                    if (msgStr.includes('Licht')) icon = '💡';
                    else if (msgStr.includes('Pumpe')) icon = '💧';
                    else if (msgStr.includes('Abluft')) icon = '🌪️';
                    else if (msgStr.includes('Befeuchter')) icon = '💦';

                    // Highlight keywords playfully
                    if (msgStr.includes('eingeschaltet')) {
                        msgStr = msgStr.replace('eingeschaltet', '<span style="color:#10b981; font-weight:600;">eingeschaltet</span>');
                    }
                    if (msgStr.includes('ausgeschaltet')) {
                        msgStr = msgStr.replace('ausgeschaltet', '<span style="color:#ef4444; font-weight:600;">ausgeschaltet</span>');
                    }

                    item.innerHTML = `
                        <div style="color:var(--text-secondary); font-size:12px; min-width:80px; text-align:right; font-variant-numeric: tabular-nums; opacity:0.8;">
                            ${timeStr}
                        </div>
                        <div style="display:flex; align-items:center; justify-content:center; position:relative; width: 32px; height: 32px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 50%;">
                            <div style="font-size:16px; line-height:1; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
                                ${icon}
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; justify-content: center; gap:4px; flex:1;">
                            <span style="font-size:10px; font-weight:700; color:#3bacf6; letter-spacing:1px; text-transform:uppercase; background: rgba(59, 172, 246, 0.1); padding: 2px 6px; border-radius: 4px; display: inline-block; width: max-content;">
                                ${entry.devName}
                            </span>
                            <span style="font-size:14px; color:var(--text-primary); margin-top: 2px; line-height: 1.4;">
                                ${msgStr}
                            </span>
                        </div>
                    `;
                    listContainer.appendChild(item);
                }
            }

            container.appendChild(listContainer);
            
            // Attach refresh event AFTER appending to DOM
            setTimeout(() => {
                const btn = document.getElementById('btn-refresh-logs');
                if (btn) btn.onclick = () => this._renderLogs(container);
            }, 0);

        } catch (e) {
            console.error("Log fetch failed", e);
            container.innerHTML = `<div style="color:var(--danger-color); padding:24px;">Fehler beim Laden des Protokolls: ${e.message}</div>`;
        }
    }

    _renderInfo(container) {
        container.innerHTML = `
            <div style="max-width:900px; margin:0 auto; padding:16px;">
                <h2 style="text-align:center; margin-bottom:32px; background: linear-gradient(135deg, #4ade80 0%, #3b82f6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; font-size: 28px;">
                    Grow Guide & Hilfe-Center
                </h2>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px;">
                    <!-- VPD Section -->
                    <div class="card">
                        <div class="card-header">
                            <div class="card-title">🍃 VPD (Vapor Pressure Deficit)</div>
                        </div>
                        <div class="card-body">
                            <p style="color:var(--text-secondary); margin-bottom:16px; font-size: 13px; line-height: 1.5;">
                                Der VPD-Wert beschreibt den Dampfdrucksättigungsdefizit – also wie "durstig" die Luft ist. Ein optimaler VPD sorgt dafür, dass die Pflanze Nährstoffe effizient transportieren kann.
                            </p>
                            <table style="width:100%; text-align:left; border-collapse:collapse; color:white; font-size: 13px;">
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                                    <th style="padding:8px; color: var(--primary-color);">Phase</th>
                                    <th style="padding:8px; color: var(--primary-color);">Ziel-Bereich (kPa)</th>
                                </tr>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:8px;">🌱 Keimling</td>
                                    <td style="padding:8px; color:#4ade80; font-weight: 600;">0.4 - 0.8</td>
                                </tr>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:8px;">🌿 Wachstum</td>
                                    <td style="padding:8px; color:#4ade80; font-weight: 600;">0.8 - 1.2</td>
                                </tr>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:8px;">🌸 Blüte</td>
                                    <td style="padding:8px; color:#4ade80; font-weight: 600;">1.2 - 1.6</td>
                                </tr>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:8px;">🍂 Trocknen</td>
                                    <td style="padding:8px; color:#4ade80; font-weight: 600;">0.8 - 1.0</td>
                                </tr>
                            </table>
                        </div>
                    </div>

                    <!-- NEW: Smart Humidity Logic -->
                    <div class="card" style="border-left: 4px solid #3b82f6;">
                        <div class="card-header">
                            <div class="card-title">💦 Intelligente Befeuchtung (Neu)</div>
                        </div>
                        <div class="card-body">
                            <p style="color:var(--text-secondary); margin-bottom:12px; font-size: 13px;">
                                In v2.1.5 wurde die Steuerung des Luftbefeuchters optimiert, um ein Überfeuchten zu verhindern:
                            </p>
                            <ul style="color:var(--text-secondary); padding-left:20px; line-height:1.6; font-size: 13px;">
                                <li><strong>Impuls-Logik:</strong> Der Befeuchter läuft für einen kurzen "Impuls" und wartet dann 10 Minuten.</li>
                                <li><strong>Verteilung:</strong> Die Pause gibt dem Wasser Zeit, sich im Raum zu verteilen, bevor der Sensor erneut misst.</li>
                                <li><strong>Ziel-Zone:</strong> Auf dem Dashboard zeigt der blaue Balken nun einen hellen Bereich basierend auf deiner eingestellten <strong>Hysterese</strong> (+/-) als Zielvorgabe an.</li>
                            </ul>
                        </div>
                    </div>

                    <!-- Controls Section -->
                    <div class="card">
                        <div class="card-header">
                            <div class="card-title">🎮 Dashboard-Steuerung</div>
                        </div>
                        <div class="card-body">
                            <ul style="color:var(--text-secondary); padding-left:20px; line-height:1.6; font-size: 13px;">
                                <li><strong>⚡ Master:</strong> Automatik AN/AUS. Im AUS-Zustand werden keine Geräte automatisch geschaltet.</li>
                                <li><strong>💦 Befeuchter:</strong> (Neu) Direkter Schalter für den Luftbefeuchter. Überschreibt kurzzeitig die Automatik.</li>
                                <li><strong>💧 Pumpe:</strong> Startet den Gießvorgang für die eingestellte Dauer (Sekunden).</li>
                                <li><strong>📷 Bild:</strong> Manueller Kamera-Upload für die Box-Vorschau.</li>
                            </ul>
                        </div>
                    </div>

                    <!-- Light Timer Section -->
                    <div class="card">
                        <div class="card-header">
                            <div class="card-title">💡 Licht & Phasen</div>
                        </div>
                        <div class="card-body">
                            <p style="color:var(--text-secondary); font-size: 13px; line-height:1.5;">
                                Jede Phase hat ihre eigene Beleuchtungsdauer (z.B. 18h oder 12h). Diese stellst du unter <strong>"Phasen"</strong> ein.
                                <br><br>
                                Die <strong>Startzeit</strong> unter "Geräte & Config" legt fest, wann der "Tag" beginnt.
                            </p>
                        </div>
                    </div>

                    <!-- Watering Section -->
                    <div class="card">
                         <div class="card-header">
                            <div class="card-title">🌱 Bewässerung-Logik</div>
                        </div>
                        <div class="card-body">
                            <p style="color:var(--text-secondary); font-size: 13px; line-height:1.5;">
                                Wenn die Bodenfeuchte unter den Zielwert fällt, wird die Pumpe aktiviert.
                                <br><br>
                                Nach jedem Gießen folgt eine <strong>15-minütige Sperre</strong>, damit das Wasser einsickern kann und der Sensor nicht sofort wieder auslöst.
                            </p>
                        </div>
                    </div>

                    <!-- Support Section -->
                    <div class="card" style="border: 1px solid rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.05);">
                        <div class="card-header" style="border-bottom-color: rgba(251, 191, 36, 0.1);">
                            <div class="card-title" style="color: #fbbf24;">💛 Support & OpenKairo</div>
                        </div>
                        <div class="card-body" style="text-align:center;">
                            <p style="color:var(--text-secondary); margin-bottom:16px; font-size: 13px;">
                                Gefällt dir das Projekt? Unterstütze die Entwicklung!
                            </p>
                            <a href="https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=info@low-streaming.de&currency_code=EUR" target="_blank" style="text-decoration:none;">
                                <button class="btn" style="background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%); color: #111827; font-weight:bold; margin:0 auto; width:auto; padding:12px 24px; border:none; box-shadow: 0 4px 12px rgba(251, 191, 36, 0.2);">
                                    ☕ Jetzt Spenden
                                </button>
                            </a>
                        </div>
                    </div>
                </div>
                
                <div style="text-align:center; margin-top:40px; opacity:0.8; font-size:12px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px;">
                    <div style="background:rgba(251, 191, 36, 0.1); border:1px solid rgba(251, 191, 36, 0.3); padding:10px; margin-bottom:20px; border-radius:8px; color:#fbbf24;">
                        <strong>💡 Tipp bei UI-Problemen:</strong> Falls Änderungen (wie gelöschte Boxen) nicht erscheinen, drücke bitte <strong>STRG + F5</strong> um den Browser-Cache zu leeren.
                    </div>
                    Local Grow Box Integration v2.4.2
                </div>
            </div>
        `;
    }

    async fetchHistoryData(entityId) {
        if (!this._hass || !entityId) return;
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const startStr = yesterday.toISOString();

        try {
            const response = await this._hass.callApi('GET', `history/period/${startStr}?filter_entity_id=${entityId}&minimal_response`);
            if (response && response.length > 0) {
                this.historyData = { ...this.historyData, [entityId]: response[0] };
            } else {
                this.historyData = { ...this.historyData, [entityId]: [] };
            }
        } catch (e) {
            console.error("Failed to fetch history for " + entityId, e);
            this.historyData = { ...this.historyData, [entityId]: [] };
        } finally {
            this.fetchingHistory[entityId] = false;
            // Triggers UI update based on tab
            const container = this.shadowRoot.getElementById('main-content');
            if (container) {
                if (this._activeTab === 'statistics') {
                    this._renderStatistics(container);
                } else if (this._activeTab === 'diary') {
                    // Update only sparklines to avoid full re-render of complex cards
                    this._devices.forEach(d => {
                        const svg = this.shadowRoot.getElementById(`vpd-sparkline-${d.id}`);
                        if (svg && d.entities.vpd === entityId) {
                            this._renderSparkline(svg, this.historyData[entityId], 0.8, 1.2);
                        }
                    });
                }
            }
        }
    }

    _showMoreInfo(entityId) {
        if (!entityId) return;
        const event = new Event('hass-more-info', { bubbles: true, composed: true });
        event.detail = { entityId: entityId };
        this.dispatchEvent(event);
    }

    _renderChart(entityId, colorHex, label, unit) {
        if (!this.historyData[entityId] && !this.fetchingHistory[entityId]) {
            this.fetchingHistory[entityId] = true;
            this.fetchHistoryData(entityId);
            return '<div style="height: 150px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 15px;">Lade ' + label + '...</div>';
        }

        const data = this.historyData[entityId] || [];
        const currentState = this._hass && this._hass.states[entityId] ? this._hass.states[entityId].state : '-';

        if (data.length === 0 || data.filter(d => !isNaN(parseFloat(d.state))).length === 0) {
            return `
                <div class="chart-row" data-entity="${entityId}" style="margin-bottom: 20px; text-align: left; cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
                        <h4 style="color: ${colorHex}; margin: 0; font-size: 1.0em; text-transform: uppercase;">${label}</h4>
                        <span style="color: #fff; font-size: 1.1em; font-weight: bold;">${currentState} ${unit}</span>
                    </div>
                    <div style="height: 120px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="text-align:center;">
                            <div style="font-size:20px; margin-bottom:8px;">⏳</div>
                            Warte auf Datenpunkte...<br>
                            <small style="opacity:0.5;">(Kann nach Neustart 1-2 Min dauern)</small>
                        </div>
                    </div>
                </div>
            `;
        }

        const validData = data.filter(d => !isNaN(parseFloat(d.state)));
        const values = validData.map(d => parseFloat(d.state));
        const times = validData.map(d => new Date(d.last_changed).getTime());

        const minVal = Math.min(...values);
        let maxVal = Math.max(...values);
        if (minVal === maxVal) maxVal = minVal + 1;
        const minTime = Math.min(...times);
        let maxTime = Math.max(...times);
        if (minTime === maxTime) maxTime = minTime + 1000;

        const rangeY = maxVal - minVal;
        const rangeX = maxTime - minTime;
        const width = 600;
        const height = 120;
        const padding = 20;

        const points = validData.map(d => {
            const x = ((new Date(d.last_changed).getTime() - minTime) / rangeX) * width;
            const y = height - (((parseFloat(d.state) - minVal) / rangeY) * height);
            return `${x},${y}`;
        });

        const pathData = `M ${points[0]} L ${points.join(' L ')}`;
        const fillPathData = `M ${points[0].split(',')[0]},${height} L ${points.join(' L ')} L ${points[points.length - 1].split(',')[0]},${height} Z`;
        const safeId = entityId.replace(/\./g, '_');

        const lastState = validData[validData.length - 1].state;

        return `
            <div class="chart-row" data-entity="${entityId}" style="margin-bottom: 20px; text-align: left; cursor: pointer;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
                    <h4 style="color: ${colorHex}; margin: 0; font-size: 1.0em; text-transform: uppercase;">${label}</h4>
                    <span style="color: #fff; font-size: 1.1em; font-weight: bold;">
                        ${lastState} ${unit}
                    </span>
                </div>
                <div style="position: relative; height: ${height + padding * 2}px; border-radius: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); overflow: hidden;">
                    <svg viewBox="0 -${padding} ${width} ${height + padding * 2}" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
                        <defs>
                            <linearGradient id="grad_${safeId}" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:${colorHex};stop-opacity:0.4" />
                                <stop offset="100%" style="stop-color:${colorHex};stop-opacity:0.0" />
                            </linearGradient>
                        </defs>
                        <path d="${fillPathData}" fill="url(#grad_${safeId})" />
                        <path d="${pathData}" fill="none" stroke="${colorHex}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
                    </svg>
                    <div style="position: absolute; top: 10px; left: 10px; color: rgba(255,255,255,0.8); font-size: 0.8em; font-weight: bold;">
                        MAX: ${maxVal.toFixed(2)}
                    </div>
                    <div style="position: absolute; bottom: 10px; left: 10px; color: rgba(255,255,255,0.4); font-size: 0.8em;">
                        MIN: ${minVal.toFixed(2)}
                    </div>
                </div>
            </div >
            `;
    }

    _renderStatistics(container) {
        if (!this._devices || this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden. Bitte Integration hinzufügen.</div>';
            return;
        }

        const statsDiv = document.createElement('div');
        statsDiv.innerHTML = `
            <div style="max-width:1200px; margin:0 auto; padding:16px;">
                <h2 style="color:var(--text-primary); margin-bottom:12px;">📊 Statistiken & Graphen</h2>
                <p style="color:var(--text-secondary); margin-bottom:24px;">Übersicht über die Messwerte deiner Growbox im zeitlichen Verlauf (24h).</p>
                <div class="grid" id="stats-grid"></div>
            </div>
        `;

        const grid = statsDiv.querySelector('#stats-grid');

        this._devices.forEach(device => {
            const tempSensor = device.options.temp_sensor;
            const humSensor = device.options.humidity_sensor;
            const vpdSensor = device.entities.vpd;
            const moistSensor = device.options.moisture_sensor;

            if (!tempSensor && !humSensor && !vpdSensor && !moistSensor) {
                return;
            }

            const getUnit = (entityId, deflt) => {
                if (!entityId || !this._hass || !this._hass.states[entityId]) return deflt;
                return this._hass.states[entityId].attributes.unit_of_measurement || deflt;
            };

            const cardWrapper = document.createElement('div');
            cardWrapper.className = 'card';
            cardWrapper.style.padding = '24px';
            cardWrapper.style.display = 'block';

            cardWrapper.innerHTML = `
                <div style="border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 20px;">
                    <h3 style="margin:0; font-size:20px; color:#38bdf8;">${device.name}</h3>
                </div>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${tempSensor ? this._renderChart(tempSensor, '#ef4444', '🌡️ Temperatur', getUnit(tempSensor, '°C')) : ''}
                    ${humSensor ? this._renderChart(humSensor, '#3b82f6', '💧 Luftfeuchte', getUnit(humSensor, '%')) : ''}
                    ${vpdSensor ? this._renderChart(vpdSensor, '#10b981', '🍃 VPD', getUnit(vpdSensor, 'kPa')) : ''}
                    ${moistSensor ? this._renderChart(moistSensor, '#8b5cf6', '🪴 Bodenfeuchte', getUnit(moistSensor, '%')) : ''}
                </div>
                <div style="margin-top: 20px; text-align: left; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 8px;">
                    <h4 style="margin: 0; color: var(--text-secondary); font-size: 0.85em;">Klicke auf einen Graphen, um die detaillierte Ansicht von Home Assistant zu öffnen.</h4>
                </div>
            `;

            // Attach listeners
            const charts = cardWrapper.querySelectorAll('.chart-row');
            charts.forEach(c => {
                c.onclick = () => this._showMoreInfo(c.dataset.entity);
            });

            grid.appendChild(cardWrapper);
        });

        container.appendChild(statsDiv);
    }

    _showMoreInfo(entityId) {
        if (!entityId) return;
        const event = new Event('hass-more-info', { bubbles: true, composed: true });
        event.detail = { entityId: entityId };
        this.dispatchEvent(event);
    }

    _getSummedValue(entities) {
        if (!entities || !this._hass) return 0;
        const list = Array.isArray(entities) ? entities : (entities.includes(',') ? entities.split(',').map(e => e.trim()) : [entities]);
        let sum = 0;
        let found = false;
        list.forEach(entId => {
            const s = this._hass.states[entId];
            if (s && !isNaN(s.state)) {
                sum += parseFloat(s.state);
                found = true;
            }
        });
        return found ? sum : null;
    }

    async _renderDiary(container) {
        if (this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden.</div>';
            return;
        }

        // Only show loading if we really have no data yet
        if (!this._devices[0].grows) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; color: var(--text-secondary);">
                    <div style="font-size: 32px; margin-bottom: 16px; animation: pulse 1.5s infinite;">📖</div>
                    <div>Lade Tagebuch...</div>
                </div>
            `;
            await this._fetchGrows();
            return;
        }

        container.innerHTML = '';
        
        this._devices.forEach(device => {
            const section = document.createElement('div');
            section.className = 'settings-section';
            section.style.marginBottom = '40px';
            
            const title = document.createElement('div');
            title.className = 'section-title';
            title.style.display = 'flex';
            title.style.justifyContent = 'space-between';
            title.style.alignItems = 'center';
            title.innerHTML = `
                <span>📖 ${device.name} - Tagebuch</span>
                <button class="btn active" style="width:auto; padding:8px 16px; font-size:12px;" id="start-grow-${device.id}">
                    ➕ Neuer Grow
                </button>
            `;
            section.appendChild(title);

            const activeGrow = (device.grows || []).find(g => g.status === 'active');
            
            if (activeGrow) {
                const activeCard = document.createElement('div');
                activeCard.id = `active-grow-card-${device.id}`;
                activeCard.className = 'active-grow-card';
                activeCard.style.cssText = "background: linear-gradient(135deg, rgba(3, 169, 244, 0.1) 0%, rgba(3, 169, 244, 0.02) 100%); border: 1px solid rgba(3, 169, 244, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 24px; position:relative; overflow:hidden;";
                
                const startDate = new Date(activeGrow.start_date);
                const now = new Date();
                const days = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
                const totalDays = (activeGrow.expected_weeks || 8) * 7;
                const progress = Math.min(100, (days / totalDays) * 100);
                
                // Power & Cost
                let consumed = activeGrow.consumed_kwh || 0;
                const price = device.options.electric_price || 0.35;

                // Fallback to Total Energy if no integrated kWh recorded yet
                if (consumed <= 0 && device.options.energy_sensor) {
                    const currentEnergy = this._getSummedValue(device.options.energy_sensor);
                    if (currentEnergy !== null) {
                        consumed = Math.max(0, currentEnergy - (activeGrow.start_energy || 0));
                    }
                }

                const powerStr = consumed < 1.0 ? consumed.toFixed(3) : consumed.toFixed(2);
                const costStr = (consumed * price).toFixed(2);
                let wattStr = "0";

                if (device.options.power_sensor) {
                    const currentWatts = this._getSummedValue(device.options.power_sensor);
                    if (currentWatts !== null) wattStr = Math.round(currentWatts).toString();
                }

                // VPD Health
                const vpdTotal = activeGrow.vpd_total_mins || 0;
                const vpdIdeal = activeGrow.vpd_ideal_mins || 0;
                const vpdScore = vpdTotal > 0 ? Math.round((vpdIdeal / vpdTotal) * 100) : 100;
                const healthColor = vpdScore > 80 ? "#4ade80" : (vpdScore > 50 ? "#fbbf24" : "#ef4444");

                activeCard.innerHTML = `
                    <div style="position:absolute; top:-10px; right:-10px; font-size:80px; opacity:0.05; pointer-events:none;">🌿</div>
                    <div class="diary-active-grid" style="display:grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap:20px; align-items:center;">
                        <div>
                            <div style="font-size:12px; color:var(--primary-color); text-transform:uppercase; font-weight:700; letter-spacing:1px;">Aktueller Grow</div>
                            <div style="font-size:24px; font-weight:800; margin:4px 0;">${activeGrow.name}</div>
                            <div style="color:var(--text-secondary); font-size:14px;">${activeGrow.strain || 'Unbekannte Sorte'}</div>
                            
                            <div style="margin-top:16px;">
                                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                                    <span>Fortschritt</span>
                                    <span class="val-days">Tag ${days} / ${totalDays}</span>
                                </div>
                                <div style="height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                                    <div style="width:${progress}%; height:100%; background:linear-gradient(90deg, #4ade80, #38bdf8); border-radius:4px;"></div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="text-align:center; border-left:1px solid rgba(255,255,255,0.1); padding-left:20px; position:relative;">
                            <div style="font-size:12px; color:var(--text-secondary); text-transform:uppercase;">Energie & Kosten</div>
                            <div style="font-size:24px; font-weight:800; color:#fbbf24;"><span class="val-kwh">${powerStr}</span> <small style="font-size:12px;">kWh</small></div>
                            <div style="font-size:16px; font-weight:600; color:#4ade80;">~ <span class="val-cost">${costStr}</span> €</div>
                            <div style="font-size:10px; opacity:0.7; margin-top:4px;"><span class="val-watts">${wattStr}</span> W aktuell</div>
                            <button id="reset-energy-${activeGrow.id}" style="
                                position:absolute; top:-10px; right:0; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); 
                                color:white; font-size:10px; padding:2px 6px; border-radius:4px; cursor:pointer;
                            ">⚖️ Reset</button>
                        </div>

                        <div style="text-align:center; border-left:1px solid rgba(255,255,255,0.1); padding-left:20px;">
                            <div style="font-size:12px; color:var(--text-secondary); text-transform:uppercase;">Klima-Score</div>
                            <div style="position:relative; width:60px; height:60px; margin:8px auto;">
                                <svg viewBox="0 0 36 36" style="width:60px; height:60px; transform: rotate(-90deg);">
                                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3" />
                                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${healthColor}" stroke-dasharray="${vpdScore}, 100" stroke-width="3" stroke-linecap="round" />
                                </svg>
                                <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); font-size:14px; font-weight:bold;">${vpdScore}%</div>
                            </div>
                            <div style="font-size:10px; opacity:0.6; margin-bottom:8px;">VPD-Qualität</div>
                            <div style="background:rgba(0,0,0,0.2); border-radius:4px; padding:4px;">
                                <svg id="vpd-sparkline-${device.id}" width="100" height="40" viewBox="0 0 100 40"></svg>
                                <div style="font-size:9px; opacity:0.5; margin-top:2px;">Trend (24h)</div>
                            </div>
                        </div>

                        <div style="display:flex; flex-direction:column; justify-content:center; gap:8px;">
                            <button class="btn active" id="add-event-${activeGrow.id}">➕ Event</button>
                            <button class="btn" id="edit-grow-${activeGrow.id}">📝 Notizen</button>
                            <button class="btn" id="take-snapshot-${activeGrow.id}">📸 Foto</button>
                            <button class="btn" style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid #ef4444;" id="stop-grow-${activeGrow.id}">🚀 Beenden</button>
                        </div>
                    </div>
                    <div id="gallery-container-${activeGrow.id}" style="margin-top:20px; border-top:1px solid rgba(255,255,255,0.05); padding-top:15px;"></div>
                `;
                section.appendChild(activeCard);
                
                setTimeout(() => {
                    const btnStop = section.querySelector(`#stop-grow-${activeGrow.id}`);
                    if (btnStop) btnStop.onclick = () => this._stopGrow(device.entryId, activeGrow.id);
                    const btnEdit = section.querySelector(`#edit-grow-${activeGrow.id}`);
                    if (btnEdit) btnEdit.onclick = () => this._editGrow(device.entryId, activeGrow);
                    const btnEvent = section.querySelector(`#add-event-${activeGrow.id}`);
                    if (btnEvent) btnEvent.onclick = () => this._addEventDialog(device.entryId, activeGrow.id);
                    const btnReset = section.querySelector(`#reset-energy-${activeGrow.id}`);
                    if (btnReset) btnReset.onclick = () => this._resetEnergy(device.entryId, activeGrow.id);
                    const btnSnap = section.querySelector(`#take-snapshot-${activeGrow.id}`);
                    if (btnSnap) btnSnap.onclick = () => this._takeManualSnapshot(device.entryId, activeGrow.id);

                    // Render Gallery
                    const gallCont = section.querySelector(`#gallery-container-${activeGrow.id}`);
                    if (gallCont) this._renderPhotoGallery(gallCont, device, activeGrow);

                    // Render sparkline if data exists
                    if (device.entities.vpd && this.historyData[device.entities.vpd]) {
                        const svg = section.querySelector(`#vpd-sparkline-${device.id}`);
                        if (svg) {
                            const phase = activeGrow.phase || 'vegetative';
                            const targets = {
                                'seedling': [0.4, 0.8],
                                'vegetative': [0.8, 1.2],
                                'flowering': [1.2, 1.6],
                                'drying': [0.8, 1.0],
                                'curing': [0.5, 0.7]
                            };
                            const [minT, maxT] = targets[phase] || [0.8, 1.2];
                            this._renderSparkline(svg, this.historyData[device.entities.vpd], minT, maxT);
                        }
                    } else if (device.entities.vpd) {
                        this.fetchHistoryData(device.entities.vpd);
                    }
                }, 0);
            }

            // History
            const historyTable = document.createElement('div');
            historyTable.style.background = 'rgba(0,0,0,0.2)';
            historyTable.style.borderRadius = '8px';
            historyTable.style.overflow = 'hidden';
            
            let rows = '';
            (device.grows || []).filter(g => g.status === 'finished').forEach(g => {
                const cost = g.total_cost || '--';
                const energy = g.total_kwh || g.consumed_kwh || 0;
                const events = (g.events || []).map(e => `• ${e.type}`).join(', ');
                
                const startDt = new Date(g.start_date);
                const endDt = new Date(g.end_date || g.start_date);
                const durationDays = Math.max(1, Math.ceil((endDt - startDt) / (1000 * 60 * 60 * 24)));

                rows += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding:12px;">
                            ${g.name}<br>
                            <small style="opacity:0.6;">${g.strain || ''}</small>
                            ${events ? `<div style="font-size:10px; color:var(--primary-color); margin-top:4px;">${events}</div>` : ''}
                        </td>
                        <td style="padding:12px;">${startDt.toLocaleDateString()}</td>
                        <td style="padding:12px; text-align:center;">${durationDays} Tage</td>
                        <td style="padding:12px; text-align:center; color:#fbbf24;">
                            ${parseFloat(energy).toFixed(2)} kWh<br>
                            <small style="color:#4ade80;">${cost} €</small>
                        </td>
                        <td style="padding:12px; text-align:right;">
                            ${g.photos && g.photos.length > 0 ? `<button class="btn" style="width:auto; padding:4px 10px; font-size:10px; display:inline-flex; margin-right:8px;" onclick='this.parentElement.parentElement.parentElement.querySelector(".row-gallery-${g.id}").style.display="table-row"; this.style.display="none";'>📸 ${g.photos.length}</button>` : ''}
                            <button class="btn" style="padding:4px 8px; font-size:10px;" id="del-grow-${g.id}">🗑️</button>
                            <button class="btn" style="padding:4px 8px; font-size:10px; margin-left:4px;" id="edit-hist-${g.id}">📝</button>
                        </td>
                    </tr>
                `;
            });

            historyTable.innerHTML = `
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead>
                        <tr style="background:rgba(255,255,255,0.05); color:var(--primary-color);">
                            <th style="padding:12px; text-align:left;">Name / Sorte</th>
                            <th style="padding:12px; text-align:left;">Start</th>
                            <th style="padding:12px; text-align:center;">Dauer</th>
                            <th style="padding:12px; text-align:center;">Verbrauch</th>
                            <th style="padding:12px; text-align:right;">Aktion</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="5" style="padding:32px; text-align:center; color:var(--text-secondary);">Noch keine abgeschlossenen Grows.</td></tr>'}
                    </tbody>
                </table>
            `;
            section.appendChild(historyTable);
            
            setTimeout(() => {
                section.querySelector(`#start-grow-${device.id}`).onclick = () => this._startGrowDialog(device.entryId);
                (device.grows || []).filter(g => g.status === 'finished').forEach(g => {
                    const btnDel = section.querySelector(`#del-grow-${g.id}`);
                    if (btnDel) btnDel.onclick = () => this._deleteGrow(device.entryId, g.id);
                    
                    if (g.photos && g.photos.length > 0) {
                        const histGall = section.querySelector(`#hist-gallery-${g.id}`);
                        if (histGall) this._renderPhotoGallery(histGall, device, g);
                    }
                    const btnEdit = section.querySelector(`#edit-hist-${g.id}`);
                    if (btnEdit) btnEdit.onclick = () => this._editGrow(device.entryId, g);
                });
            }, 0);

            container.appendChild(section);
        });
    }

    _updateDiaryValues() {
        if (!this._devices) return;
        this._devices.forEach(device => {
            const card = this.shadowRoot.getElementById(`active-grow-card-${device.id}`);
            if (!card) return;

            const activeGrow = (device.grows || []).find(g => g.status === 'active');
            if (!activeGrow) return;

            // Days & Progress
            const startDate = new Date(activeGrow.start_date);
            const days = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));
            const totalDays = (activeGrow.expected_weeks || 8) * 7;
            const progress = Math.min(100, (days / totalDays) * 100);
            
            const elDays = card.querySelector('.val-days');
            if (elDays) elDays.innerText = `Tag ${days} / ${totalDays}`;
            
            const elBar = card.querySelector('[style*="width:"]');
            if (elBar) elBar.style.width = `${progress}%`;

            // Energy & Cost
            let consumed = activeGrow.consumed_kwh || 0;
            const price = device.options.electric_price || 0.35;

            if (consumed <= 0 && device.options.energy_sensor) {
                const currentEnergy = this._getSummedValue(device.options.energy_sensor);
                if (currentEnergy !== null) {
                    consumed = Math.max(0, currentEnergy - (activeGrow.start_energy || 0));
                }
            }

            const elKwh = card.querySelector('.val-kwh');
            if (elKwh) elKwh.innerText = consumed.toFixed(2);
            const elCost = card.querySelector('.val-cost');
            if (elCost) elCost.innerText = (consumed * price).toFixed(2);

            // Power
            if (device.options.power_sensor) {
                const currentWatts = this._getSummedValue(device.options.power_sensor);
                if (currentWatts !== null) {
                    const elWatts = card.querySelector('.val-watts');
                    if (elWatts) elWatts.innerText = Math.round(currentWatts);
                }
            }
        });
    }

    async _resetEnergy(entryId, growId) {
        if (!confirm("Den Energieverbrauch für diesen Grow wirklich auf 0 zurücksetzen? (Der aktuelle Zählerstand wird als neuer Nullpunkt genommen)")) return;
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/reset_grow_energy',
                entry_id: entryId,
                grow_id: growId
            });
            this._updateContent();
        } catch (err) {
            alert("Fehler: " + err.message);
        }
    }

    async _addEventDialog(entryId, growId) {
        const types = ["Topping", "Dünger", "Wasser", "LST", "Defoliation", "Umgetopft", "Sonstiges"];
        const type = prompt(`Event Typ wählen:\n${types.join(", ")}`, "Topping");
        if (!type) return;
        const note = prompt("Zusatz-Notiz (optional):", "");
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/add_grow_event',
                entry_id: entryId,
                grow_id: growId,
                event_type: type,
                note: note || ""
            });
            this._updateContent();
        } catch (err) {
            alert("Fehler: " + err.message);
        }
    }

    async _startGrowDialog(entryId) {
        const name = prompt("Name für den neuen Grow:", "Mein Grow " + new Date().toLocaleDateString());
        if (!name) return;
        const strain = prompt("Sorte (optional):", "");
        const weeks = prompt("Erwartete Dauer (Wochen):", "8");
        if (weeks === null) return;
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/start_grow',
                entry_id: entryId,
                name: name,
                strain: strain,
                expected_weeks: parseInt(weeks) || 8
            });
            this._updateContent();
        } catch (err) {
            alert("Fehler beim Starten: " + err.message);
        }
    }

    async _stopGrow(entryId, growId) {
        if (!confirm("Möchtest du diesen Grow wirklich beenden? Der aktuelle Stromzählerstand wird gespeichert.")) return;
        try {
            await this._hass.callWS({
                type: 'local_grow_box/stop_grow',
                entry_id: entryId,
                grow_id: growId
            });
            this._updateContent();
        } catch (err) {
            alert("Fehler beim Beenden: " + err.message);
        }
    }

    async _deleteGrow(entryId, growId) {
        if (!confirm("Eintrag unwiderruflich löschen?")) return;
        try {
            await this._hass.callWS({
                type: 'local_grow_box/delete_grow',
                entry_id: entryId,
                grow_id: growId
            });
            this._updateContent();
        } catch (err) {
            alert("Fehler beim Löschen: " + err.message);
        }
    }

    async _editGrow(entryId, grow) {
        const notes = prompt("Notizen / Ertrag / Fazit:", grow.notes || "");
        if (notes === null) return;
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/update_grow',
                entry_id: entryId,
                grow_id: grow.id,
                updates: { notes: notes }
            });
            this._updateContent();
        } catch (err) {
            alert("Fehler beim Speichern: " + err.message);
        }
    }
    _renderRecipes(container) {
        if (!this._devices || this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden.</div>';
            return;
        }

        const buildInRecipes = [
            {
                name: "🌱 Autoflower (Standard)",
                desc: "Optimiert für automatische Sorten. Konstant 18h Licht, angepasster VPD für schnelles Wachstum.",
                phases: {
                    seedling: { target_temp: 24, target_humidity: 75, vpd_range: [0.4, 0.8], light_hours: 18 },
                    vegetative: { target_temp: 26, target_humidity: 60, vpd_range: [0.8, 1.2], light_hours: 18 },
                    flowering: { target_temp: 25, target_humidity: 45, vpd_range: [1.2, 1.6], light_hours: 18 }
                }
            },
            {
                name: "🌸 Photoperiodisch (Classic)",
                desc: "Der Klassiker: 18/6 in der Vegi, automatischer Switch auf 12/12 in der Blüte inkl. VPD-Anpassung.",
                phases: {
                    seedling: { target_temp: 23, target_humidity: 70, vpd_range: [0.4, 0.8], light_hours: 18 },
                    vegetative: { target_temp: 26, target_humidity: 60, vpd_range: [0.8, 1.2], light_hours: 18 },
                    flowering: { target_temp: 24, target_humidity: 45, vpd_range: [1.2, 1.6], light_hours: 12 }
                }
            },
            {
                name: "❄️ Eco-Growing (Low-Temp)",
                desc: "Energiesparend bei kühleren Temperaturen. Reduzierte Zielwerte für Winter-Grows.",
                phases: {
                    seedling: { target_temp: 21, target_humidity: 65, vpd_range: [0.4, 1.0], light_hours: 18 },
                    vegetative: { target_temp: 22, target_humidity: 55, vpd_range: [0.8, 1.2], light_hours: 18 },
                    flowering: { target_temp: 21, target_humidity: 50, vpd_range: [1.2, 1.8], light_hours: 12 }
                }
            }
        ];

        const recipesDiv = document.createElement('div');
        recipesDiv.style.maxWidth = '1000px';
        recipesDiv.style.margin = '0 auto';

        recipesDiv.innerHTML = `
            <div style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.1) 0%, rgba(56, 189, 248, 0.05) 100%); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 12px; padding: 24px; margin-bottom: 32px; text-align: center;">
                <h2 style="margin: 0 0 8px 0; color: #38bdf8;">📋 Grow-Rezepte</h2>
                <p style="color: var(--text-secondary); margin: 0; font-size: 14px;">Wähle ein Profil aus oder importiere Einstellungen aus der Community.</p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px;">
                ${buildInRecipes.map((r, idx) => `
                    <div class="card" style="display: flex; flex-direction: column;">
                        <div style="padding: 20px; flex: 1;">
                            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: var(--primary-color);">${r.name}</h3>
                            <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px;">${r.desc}</p>
                            
                            <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; font-size: 11px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; opacity: 0.7;">
                                    <span>Phase</span>
                                    <span>Licht / Temp / Feuchte</span>
                                </div>
                                ${Object.keys(r.phases).map(p => `
                                    <div style="display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.05);">
                                        <span style="text-transform: capitalize;">${p}</span>
                                        <span style="font-weight: 600;">${r.phases[p].light_hours}h | ${r.phases[p].target_temp}° | ${r.phases[p].target_humidity}%</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div style="padding: 16px; border-top: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.1);">
                            <select id="recipe-box-${idx}" style="margin-bottom: 10px;">
                                ${this._devices.map(d => `<option value="${d.entryId}">${d.name}</option>`).join('')}
                            </select>
                            <button class="btn active" style="width: 100%;" id="apply-recipe-${idx}">Rezept anwenden</button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="settings-section">
                <div class="section-title">🤝 Community & Sharing</div>
                <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 32px;">
                    <div>
                        <h4 style="margin: 0 0 12px 0;">Rezept importieren</h4>
                        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Füge hier den JSON-Code eines Community-Rezepts ein.</p>
                        <textarea id="import-area" style="width: 100%; height: 120px; background: #0b1121; border: 1px solid rgba(255,255,255,0.1); color: #4ade80; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; resize: none; margin-bottom: 12px;" placeholder='{"name": "Mein Setup", "phases": ...}'></textarea>
                        <div style="display: flex; gap: 12px;">
                            <select id="import-box" style="flex: 1;">
                                ${this._devices.map(d => `<option value="${d.entryId}">${d.name}</option>`).join('')}
                            </select>
                            <button class="btn active" id="btn-import-recipe" style="width: auto; padding: 0 24px;">Importieren</button>
                        </div>
                    </div>
                    <div style="border-left: 1px dashed rgba(255,255,255,0.1); padding-left: 32px;">
                        <h4 style="margin: 0 0 12px 0;">Teilen & Exportieren</h4>
                        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Erstelle einen Code aus deinen aktuellen Einstellungen einer Box.</p>
                        <select id="export-box" style="margin-bottom: 12px;">
                            ${this._devices.map(d => `<option value="${d.entryId}">${d.name}</option>`).join('')}
                        </select>
                        <button class="btn" id="btn-export-recipe" style="width: 100%; margin-bottom: 16px;">Rezept-Code generieren</button>
                        <div id="export-result" style="display: none;">
                            <p style="font-size: 11px; margin-bottom: 4px; color: #4ade80;">Fertig! Kopiere diesen Code:</p>
                            <div style="background: rgba(0,0,0,0.4); padding: 10px; border-radius: 6px; font-size: 10px; font-family: monospace; word-break: break-all; opacity: 0.8; border: 1px solid rgba(74, 222, 128, 0.2);" id="export-code"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(recipesDiv);

        // Listeners for built-in
        buildInRecipes.forEach((r, idx) => {
            const btn = recipesDiv.querySelector(`#apply-recipe-${idx}`);
            btn.onclick = () => {
                const entryId = recipesDiv.querySelector(`#recipe-box-${idx}`).value;
                this._applyRecipe(entryId, r);
            };
        });

        // Listeners for import
        recipesDiv.querySelector('#btn-import-recipe').onclick = () => {
            const code = recipesDiv.querySelector('#import-area').value.trim();
            const entryId = recipesDiv.querySelector('#import-box').value;
            if (!code) return;
            try {
                const recipe = JSON.parse(code);
                this._applyRecipe(entryId, recipe);
            } catch (e) {
                alert("Ungültiger Rezept-Code! Bitte prüfe das JSON-Format.");
            }
        };

        // Listeners for export
        recipesDiv.querySelector('#btn-export-recipe').onclick = () => {
            const entryId = recipesDiv.querySelector('#export-box').value;
            const device = this._devices.find(d => d.entryId === entryId);
            if (!device) return;

            const recipe = {
                name: "Community-Grow Profile",
                phases: {
                    seedling: { 
                        target_temp: parseFloat(device.options.target_temp || 24), 
                        target_humidity: parseFloat(device.options.target_humidity || 70),
                        light_hours: parseFloat(device.options.phase_seedling_hours || 18)
                    },
                    vegetative: { 
                        target_temp: parseFloat(device.options.target_temp || 26), 
                        target_humidity: parseFloat(device.options.target_humidity || 60),
                        light_hours: parseFloat(device.options.phase_vegetative_hours || 18)
                    },
                    flowering: { 
                        target_temp: parseFloat(device.options.target_temp || 25), 
                        target_humidity: parseFloat(device.options.target_humidity || 45),
                        light_hours: parseFloat(device.options.phase_flowering_hours || 12)
                    }
                }
            };
            
            recipesDiv.querySelector('#export-result').style.display = 'block';
            recipesDiv.querySelector('#export-code').innerText = JSON.stringify(recipe);
        };
    }

    async _applyRecipe(entryId, recipe) {
        if (!confirm(`Möchtest du das Rezept "${recipe.name}" auf diese Grow Box anwenden? Alle Phasen-Sollwerte werden überschrieben.`)) return;

        try {
            await this._hass.callWS({
                type: 'local_grow_box/apply_recipe',
                entry_id: entryId,
                recipe: recipe
            });

            const toast = this.shadowRoot.getElementById('save-toast');
            toast.innerText = `✅ Rezept "${recipe.name}" aktiviert!`;
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 3000);
            
            // Re-fetch everything to show updated state
            await this._fetchDevices();
        } catch (e) {
            console.error("Apply recipe failed", e);
            alert("Fehler beim Anwenden des Rezepts: " + e.message);
        }
    }
    _renderPhotoGallery(container, device, grow) {
        if (!grow.photos || grow.photos.length === 0) {
            container.innerHTML = '<div style="font-size:11px; color:var(--text-secondary); opacity:0.6;">Noch keine Fotos für diesen Grow vorhanden.</div>';
            return;
        }

        container.innerHTML = `
            <div style="font-size:11px; color:var(--text-secondary); margin-bottom:10px; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Foto-Chronik</div>
            <div style="display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; scrollbar-width: thin;">
                ${grow.photos.map(photo => `
                    <div style="flex:0 0 100px; height:75px; border-radius:6px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); cursor:pointer; transition:transform 0.2s;" 
                         onclick='const modal=this.closest("local-grow-box-panel").shadowRoot.getElementById("camera-modal"); 
                                 modal.querySelector("img").src="/local/local_grow_box_images/grows/${grow.id}/${photo}"; 
                                 modal.querySelector("#modal-title").innerText="${photo}";
                                 modal.classList.add("visible");'>
                        <img src="/local/local_grow_box_images/grows/${grow.id}/${photo}" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                `).join('')}
            </div>
        `;
    }

    async _takeManualSnapshot(entryId, grow_id) {
        try {
            await this._hass.callWS({
                type: 'local_grow_box/take_snapshot',
                entry_id: entryId,
                grow_id: grow_id
            });
            
            const toast = this.shadowRoot.getElementById('save-toast');
            toast.innerText = "📸 Snapshot gespeichert!";
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 3000);
            
            // Refresh grows to show new photo
            await this._fetchGrows();
        } catch (e) {
            console.error("Snapshot failed", e);
            alert("Snapshot fehlgeschlagen: " + e.message);
        }
    }
}

customElements.define('local-grow-box-panel', LocalGrowBoxPanel);
