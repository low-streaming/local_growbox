class LocalGrowBoxPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._initialized = false;
        this._activeTab = 'overview'; // 'overview', 'statistics', 'settings', 'phases'
        this._draft = {}; // entryId -> { key: value }
        this.historyData = {};
        this.fetchingHistory = {};
        this._renderScheduled = false;
        this._fetchingDevices = false;
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

        // Re-render logic: Throttle to max ~3 updates per second to prevent browser crash
        if (this._devices && !this._renderScheduled) {
            this._renderScheduled = true;
            setTimeout(() => {
                this._renderScheduled = false;
                this._actualUpdate();
            }, 300);
        }
    }

    _actualUpdate() {
        if (!this._hass || !this._devices) return;

        // Stability Fix: Only re-render 'overview' and 'statistics' on every state update.
        // Other tabs (settings, phases, logs, info, recipes) are static or input-heavy and should NOT
        // be wiped and re-created every time a sensor value changes in the background.
        const persistentTabs = ['settings', 'phases', 'logs', 'diary', 'info', 'recipes'];
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

    async _fetchDevices() {
        if (!this._hass || this._fetchingDevices) return;
        this._fetchingDevices = true;

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
                let tankData = { enabled: false, capacity_ml: 10000, current_ml: 10000, flow_ml_s: 20 };
                if (entry) {
                    try {
                        const confResp = await this._hass.callWS({
                            type: 'local_grow_box/get_config',
                            entry_id: entry.entry_id
                        });
                        combinedOptions = confResp.config || {};
                    } catch (e) {
                        console.warn(`[FETCH] Failed to fetch config for ${device.name}:`, e);
                    }
                    try {
                        const tankResp = await this._hass.callWS({
                            type: 'local_grow_box/get_tank',
                            entry_id: entry.entry_id
                        });
                        tankData = tankResp.tank || tankData;
                    } catch (e) {}
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
                    tankData: tankData,
                    entities: {
                        phase: findEntity('_phase'),
                        master: findEntity('_master_switch'),
                        vpd: findEntity('_vpd'),
                        pump: findEntity('_water_pump'),
                        humidifier: findEntity('_humidifier_switch'),
                        days: findEntity('_days_in_phase'),
                        tank: findEntity('_tank_level'),
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
        } finally {
            this._fetchingDevices = false;
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
            <rect x="0" y="${targetTop}" width="${width}" height="${targetBottom - targetTop}" fill="rgba(74, 222, 128, 0.12)" />
            <line x1="0" y1="${targetTop}" x2="${width}" y2="${targetTop}" stroke="rgba(74, 222, 128, 0.4)" stroke-width="0.5" stroke-dasharray="2,2" />
            <line x1="0" y1="${targetBottom}" x2="${width}" y2="${targetBottom}" stroke="rgba(74, 222, 128, 0.4)" stroke-width="0.5" stroke-dasharray="2,2" />
        `;
        
        // Path
        let path = `M ${getX(points[0].x)} ${getY(points[0].y)}`;
        for (let i = 1; i < points.length; i++) {
            path += ` L ${getX(points[i].x)} ${getY(points[i].y)}`;
        }
        
        html += `<path d="${path}" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 2px rgba(56, 189, 248, 0.3));" />`;
        
        svg.innerHTML = html;
    }

    _renderStructure() {
        const style = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;800&display=swap');
                
                :host {
                    /* Logo Matched Neon Colors */
                    --primary-color: #00f2ff; /* Cyan Neon */
                    --accent-color: #00ff41;  /* Green Neon */
                    --warn-color: #fbbf24;    /* Amber */
                    --bg-dark: #050914;
                    --card-bg: rgba(13, 18, 30, 0.8);
                    --glass-bg: rgba(255, 255, 255, 0.03);
                    --glass-border: rgba(255, 255, 255, 0.1);
                    
                    --text-primary: #f8fafc;
                    --text-secondary: #94a3b8;
                    --success-glow: 0 0 15px rgba(0, 255, 65, 0.3);
                    --cyan-glow: 0 0 15px rgba(0, 242, 255, 0.3);
                    
                    font-family: 'Outfit', sans-serif;
                    display: block;
                    background-color: var(--bg-dark);
                    position: relative;
                    overflow-x: hidden;
                    min-height: 100vh;
                    color: var(--text-primary);
                }

                /* Floating Neon Blobs */
                :host::before, :host::after {
                    content: "";
                    position: fixed;
                    width: 500px;
                    height: 500px;
                    border-radius: 50%;
                    filter: blur(120px);
                    z-index: -1;
                    opacity: 0.15;
                    pointer-events: none;
                }
                :host::before {
                    background: var(--primary-color);
                    top: -100px;
                    left: -100px;
                    animation: drift 25s ease-in-out infinite alternate;
                }
                :host::after {
                    background: var(--accent-color);
                    bottom: -150px;
                    right: -100px;
                    animation: drift 35s ease-in-out infinite alternate-reverse;
                }
                @keyframes drift {
                    0% { transform: translate(0, 0) scale(1); }
                    100% { transform: translate(100px, 50px) scale(1.2); }
                }
                /* Cyber Circuit Background Pattern */
                .main-container {
                    background-image: 
                        url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M10 10 L30 10 L30 30 M70 10 L90 10 L90 30 M10 70 L10 90 L30 90 M90 70 L90 90 L70 90' stroke='rgba(0, 242, 255, 0.04)' stroke-width='0.5' fill='none'/%3E%3C/svg%3E");
                    background-attachment: fixed;
                    min-height: 100vh;
                }

                /* Scanline Overlay */
                .scanlines {
                    position: fixed;
                    inset: 0;
                    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.02), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.02));
                    background-size: 100% 4px, 3px 100%;
                    pointer-events: none;
                    z-index: 999;
                    opacity: 0.1;
                }

                /* Typography Polish */
                h1, h2, h3, h4 { letter-spacing: -0.02em; }
                
                /* Advanced Header */
                .header { 
                    background: rgba(11, 17, 33, 0.85);
                    backdrop-filter: blur(25px);
                    padding: 24px 32px; 
                    border-bottom: 1px solid var(--glass-border);
                    display: flex; align-items: center; 
                    position: sticky; top: 0; z-index: 100;
                    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
                    flex-wrap: nowrap; gap: 16px;
                }
                .header h1 { 
                    margin: 0; 
                    font-size: 28px; 
                    font-weight: 800; 
                    background: linear-gradient(135deg, var(--accent-color) 0%, var(--primary-color) 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    display: flex; align-items: center; gap: 14px;
                    text-transform: uppercase;
                    filter: drop-shadow(0 0 12px rgba(0, 242, 255, 0.4));
                    animation: shine 5s linear infinite;
                    background-size: 200% auto;
                }
                @keyframes shine {
                    to { background-position: 200% center; }
                }
                
                .tabs { 
                    display: flex; gap: 8px; margin-left: auto;
                    background: rgba(0,0,0,0.5); padding: 6px; border-radius: 14px;
                    border: 1.5px solid var(--glass-border);
                }
                .tab { 
                    cursor: pointer; padding: 10px 24px; border-radius: 10px;
                    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    text-transform: uppercase; 
                    font-size: 12px; font-weight: 800; letter-spacing: 1.2px;
                    color: var(--text-secondary);
                    position: relative;
                    overflow: hidden;
                }
                .tab:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
                .tab.active { 
                    background: var(--primary-color);
                    color: #000;
                    box-shadow: 0 0 15px rgba(0, 242, 255, 0.4);
                }

                .content { padding: 40px; max-width: 1500px; margin: 0 auto; position: relative; z-index: 10; }
                
                /* Premium Cards with 3D Interaction */
                .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 40px; }
                
                .card {
                    background: var(--card-bg);
                    backdrop-filter: blur(20px);
                    border-radius: 24px;
                    overflow: hidden;
                    border: 1.5px solid var(--glass-border);
                    transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
                    position: relative;
                    transform-style: preserve-3d;
                }
                .card:hover {
                    transform: translateY(-8px) scale(1.01) rotateX(2deg);
                    border-color: rgba(0, 242, 255, 0.5);
                    box-shadow: 
                        0 30px 60px -12px rgba(0, 0, 0, 0.6),
                        0 0 20px rgba(0, 242, 255, 0.1);
                }
                .card::before {
                    content: ""; position: absolute; inset: 0;
                    background: radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.08) 0%, transparent 80%);
                    opacity: 0; transition: opacity 0.3s; pointer-events: none;
                }
                .card:hover::before { opacity: 1; }
                
                /* Image Section */
                .card-image {
                    height: 260px; background: #000; position: relative;
                    border-bottom: 1px solid var(--glass-border);
                }
                .card-image img { width: 100%; height: 100%; object-fit: cover; opacity: 0.85; transition: transform 0.6s ease; }
                .card:hover .card-image img { transform: scale(1.05); }
                .card-image::after {
                    content: ""; position: absolute; inset: 0;
                    background: linear-gradient(0deg, var(--bg-dark) 0%, transparent 65%);
                }

                .live-badge {
                    position: absolute; top: 20px; right: 20px;
                    background: rgba(239, 68, 68, 0.3); 
                    color: #fff; padding: 6px 14px;
                    border-radius: 20px; font-size: 11px; font-weight: 800;
                    border: 1.5px solid rgba(239, 68, 68, 0.5);
                    backdrop-filter: blur(8px);
                    box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);
                    animation: pulse-red 2s infinite;
                    z-index: 2;
                }
                @keyframes pulse-red {
                    0% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.4); }
                    50% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.7); }
                    100% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.4); }
                }
                
                .card-header {
                    padding: 28px; display: flex; justify-content: space-between; align-items: flex-start;
                }
                .card-title { font-size: 24px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.8px; }
                .card-subtitle { font-size: 13px; color: var(--text-secondary); margin-top: 4px; font-weight: 500; opacity: 0.7; }
                
                .card-body { padding: 0 28px 28px 28px; }
                
                /* Advanced Sensor Tiles */
                .sensor-grid {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;
                }
                .sensor-tile {
                    background: rgba(255, 255, 255, 0.03);
                    padding: 20px; border-radius: 20px;
                    border: 1.5px solid var(--glass-border);
                    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    position: relative;
                    overflow: hidden;
                }
                .sensor-tile:hover {
                    background: rgba(255, 255, 255, 0.07);
                    transform: translateY(-4px) scale(1.02);
                }
                .sensor-tile.glow-ok { border-color: rgba(0, 255, 65, 0.4); box-shadow: inset 0 0 20px rgba(0, 255, 65, 0.05); }
                .sensor-tile.glow-warn { border-color: rgba(251, 191, 36, 0.4); box-shadow: inset 0 0 20px rgba(251, 191, 36, 0.05); }

                .sensor-label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; font-weight: 800; display: flex; align-items: center; gap: 8px; letter-spacing: 0.5px; }
                .sensor-value { font-size: 22px; font-weight: 900; margin-top: 12px; color: #fff; display: flex; align-items: baseline; }
                .sensor-unit { font-size: 14px; opacity: 0.5; margin-left: 4px; font-weight: 600; }
                
                .status-indicator { width: 10px; height: 10px; border-radius: 50%; display: inline-block; position: relative; }
                .status-ok { background: var(--accent-color); box-shadow: 0 0 15px var(--accent-color); }
                .status-warn { background: var(--warn-color); box-shadow: 0 0 15px var(--warn-color); }
                .status-ok::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 1px solid var(--accent-color); animation: ripple 2s infinite; }
                
                @keyframes ripple {
                    0% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(2.5); opacity: 0; }
                }

                /* Controls Bar with Neon Glow */
                .controls { 
                    padding: 24px 28px; background: rgba(0, 0, 0, 0.3); 
                    display: flex; gap: 14px; border-top: 1.5px solid var(--glass-border);
                }
                .btn {
                    padding: 12px; border-radius: 12px; border: 1.5px solid var(--glass-border);
                    background: rgba(255, 255, 255, 0.05); color: var(--text-primary);
                    font-size: 13px; font-weight: 800; cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
                    display: flex; align-items: center; justify-content: center; gap: 10px;
                    text-transform: uppercase; letter-spacing: 0.8px;
                }
                .btn:hover:not(:disabled) {
                    background: rgba(255, 255, 255, 0.1);
                    border-color: var(--primary-color);
                    transform: translateY(-3px);
                    box-shadow: 0 10px 20px -10px rgba(0, 242, 255, 0.3);
                }
                .btn.active {
                    background: rgba(0, 242, 255, 0.2);
                    color: var(--primary-color);
                    border-color: var(--primary-color);
                    box-shadow: 0 0 20px rgba(0, 242, 255, 0.2);
                    animation: btn-pulse 2s infinite;
                }
                @keyframes btn-pulse {
                    0% { box-shadow: 0 0 10px rgba(0, 242, 255, 0.2); }
                    50% { box-shadow: 0 0 25px rgba(0, 242, 255, 0.4); }
                    100% { box-shadow: 0 0 10px rgba(0, 242, 255, 0.2); }
                }

                @keyframes pulse-soft {
                    0% { opacity: 0.4; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.05); }
                    100% { opacity: 0.4; transform: scale(1); }
                }

                /* Mobile Optimizations */
                @media (max-width: 600px) {
                    .header { 
                        padding: 12px; 
                        flex-direction: column;
                        align-items: stretch;
                        gap: 12px;
                    }
                    .header h1 { font-size: 20px; text-align: center; justify-content: center; }
                    .tabs { 
                        overflow-x: auto; 
                        max-width: 100%; 
                        padding: 4px;
                        border-radius: 10px;
                        justify-content: flex-start;
                        scrollbar-width: none;
                    }
                    .tabs::-webkit-scrollbar { display: none; }
                    .tab { 
                        padding: 8px 14px; 
                        font-size: 10px; 
                        white-space: nowrap; 
                    }
                    .content { padding: 12px; }
                    .grid { grid-template-columns: 1fr; gap: 16px; }
                    .sensor-grid { gap: 12px; }
                    .sensor-tile { padding: 14px; }
                    .sensor-value { font-size: 20px; }
                    .card-header { padding: 16px; }
                    .card-body { padding: 0 16px 16px 16px; }
                    .controls { padding: 16px; gap: 8px; flex-wrap: wrap; }
                    .btn { padding: 10px; flex: 1 1 45%; font-size: 11px; }

                    .diary-active-grid { 
                        grid-template-columns: 1fr; 
                        gap: 12px; 
                    }
                    .settings-section { padding: 16px; }
                    .section-title { font-size: 12px; }
                    .form-grid { grid-template-columns: 1fr; }

                    .community-export-section { 
                        border-left: none !important; 
                        padding-left: 0 !important; 
                        border-top: 1.5px solid var(--glass-border); 
                        padding-top: 32px; 
                        margin-top: 32px;
                    }
                }

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
                
                /* Score Gauge */
                .score-gauge {
                    position: relative; width: 64px; height: 64px; margin: 8px auto;
                    filter: drop-shadow(0 0 8px rgba(3, 169, 244, 0.2));
                }
                .score-gauge svg { width: 64px; height: 64px; transform: rotate(-90deg); }
                .score-gauge .bg { fill: none; stroke: rgba(255, 255, 255, 0.05); stroke-width: 3.5; }
                .score-gauge .fill { 
                    fill: none; stroke-width: 3.5; stroke-linecap: round; 
                    transition: stroke-dasharray 1s ease-out, stroke 0.5s ease;
                }
                .score-value {
                    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                    font-size: 15px; font-weight: 800; letter-spacing: -0.5px;
                }

                .status-label {
                    font-size: 10px; font-weight: 700; text-transform: uppercase; 
                    letter-spacing: 0.8px; margin-top: 4px; padding: 2px 8px; border-radius: 4px;
                    display: inline-block;
                }
                
                @keyframes pulse-soft {
                    0% { transform: scale(1); opacity: 0.8; }
                    50% { transform: scale(1.05); opacity: 1; }
                    100% { transform: scale(1); opacity: 0.8; }
                }

                /* Layout Polish */
                .diary-active-grid {
                    display: grid; grid-template-columns: 1.4fr 1fr 1fr auto; gap: 24px; align-items: stretch;
                }
                .active-grow-card {
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                }
                .info-val { font-size: 13px; font-weight: 500; color: var(--text-primary); }
                
                /* Settings Form */
                .settings-section { 
                    background: var(--card-bg); border-radius: 20px; padding: 32px; margin-bottom: 32px; 
                    border: 1px solid var(--glass-border);
                }
                .section-title { 
                    font-size: 14px; color: var(--primary-color); margin-bottom: 24px; 
                    border-bottom: 1.5px solid var(--glass-border); padding-bottom: 12px;
                    font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px;
                    display: flex; align-items: center; justify-content: space-between;
                }
                
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
                @keyframes spin { 100% { transform: rotate(360deg); } }

                /* Modal */
                .modal {
                    display: none; position: fixed; z-index: 2000; left: 0; top: 0; width: 100%; height: 100%;
                    background-color: rgba(11, 17, 33, 0.9); backdrop-filter: blur(15px);
                    align-items: center; justify-content: center;
                }
                .modal.visible { display: flex; animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
                .modal-content {
                    background: var(--glass-bg); padding: 32px; border-radius: 24px; 
                    max-width: 90%; max-height: 90vh; overflow: auto;
                    position: relative; border: 1.5px solid var(--glass-border);
                    box-shadow: 0 40px 60px -15px rgba(0, 0, 0, 0.7);
                    animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                
                .close-modal {
                    position: absolute; top: 20px; right: 20px; color: var(--text-secondary); font-size: 24px; cursor: pointer;
                    width: 40px; height: 40px; border-radius: 12px;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border);
                    transition: all 0.2s ease;
                }
                .close-modal:hover { background: rgba(255,255,255,0.1); color: #fff; transform: rotate(90deg); }

                /* Custom Thumbnails */
                .photo-thumb:hover {
                    border-color: var(--primary-color) !important;
                    box-shadow: 0 0 15px rgba(0, 242, 255, 0.3) !important;
                    transform: translateY(-5px);
                }
                .photo-thumb:hover img { transform: scale(1.1); }
                
                .log-item:hover {
                    border-color: var(--primary-color) !important;
                    background: rgba(0, 242, 255, 0.03) !important;
                    transform: translateX(5px);
                }

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
                    .card-body { padding: 16px; }
                    .controls {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 10px;
                        padding: 16px;
                    }
                    .btn { padding: 14px 8px; font-size: 11px; }
                    /* Mobile Diary Adjustments */
                    .diary-active-grid {
                        grid-template-columns: 1fr !important;
                        gap: 16px !important;
                    }
                    .diary-controls-grid {
                        grid-template-columns: 1fr !important;
                        gap: 16px !important;
                    }
                    .active-grow-card {
                        padding: 15px !important;
                    }
                    .scroll-wrapper {
                        overflow-x: auto;
                        -webkit-overflow-scrolling: touch;
                        background: rgba(0,0,0,0.2);
                        border-radius: 8px;
                        margin-bottom: 20px;
                    }
                    .history-table {
                        min-width: 600px;
                    }
                    /* Log Adjustments */
                    .log-item {
                        padding: 12px 16px !important;
                        gap: 12px !important;
                    }
                    .log-time {
                        min-width: 70px !important;
                        padding-right: 12px !important;
                    }
                    .log-icon {
                        width: 32px !important;
                        height: 32px !important;
                        font-size: 16px !important;
                    }
                    /* Phase & Settings Mobile Adjustments */
                    .phase-row {
                        padding: 12px 16px !important;
                        gap: 12px !important;
                        flex-wrap: wrap;
                    }
                    .phase-input-box {
                        margin-left: auto;
                        padding: 4px 12px !important;
                    }
                    .phase-input-box input {
                        font-size: 16px !important;
                        width: 50px !important;
                    }
                    .form-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .form-group label {
                        font-size: 11px !important;
                    }
                    .section-title {
                        font-size: 16px !important;
                        flex-direction: column;
                        align-items: flex-start !important;
                        gap: 10px;
                    }
                    .section-title h2 {
                        font-size: clamp(16px, 5vw, 22px) !important;
                    }
                    .btn {
                        padding: 14px !important; /* Larger touch targets */
                    }
                }
            </style>
            
            <div class="scanlines"></div>
            <div class="main-container">
                <div class="header">
                    <h1>🌿 <span>Grow Box Central</span></h1>
                    <div class="tabs">
                        <div class="tab active" data-tab="overview">Dashboard</div>
                        <div class="tab" data-tab="diary">Tagebuch</div>
                        <div class="tab" data-tab="statistics">Analyse</div>
                        <div class="tab" data-tab="recipes">Rezepte 📋</div>
                        <div class="tab" data-tab="phases">Zeitplan</div>
                        <div class="tab" data-tab="settings">Hardware</div>
                        <div class="tab" data-tab="logs">Log-Buch</div>
                    </div>
                </div>
                
                <div class="content" id="main-content"></div>
            </div>
            
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
            { id: 'curing', label: '🍯 Veredelung' }
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
                    ${isLive ? '<div class="live-badge">LIVE-BILD</div>' : ''}
                    <div style="position:absolute; bottom:0; left:0; right:0; padding:20px; background:linear-gradient(to top, rgba(11, 17, 33, 0.95), transparent); display:flex; justify-content:space-between; align-items:flex-end; z-index:3;">
                        <div>
                             <select class="phase-select" id="phase-select-${device.id}" style="
                                background: rgba(0, 242, 255, 0.1); 
                                border: 1px solid rgba(0, 242, 255, 0.3); 
                                color: var(--primary-color); 
                                padding: 6px 12px; 
                                border-radius: 8px; 
                                font-size: 13px;
                                font-weight: 700;
                                cursor: pointer;
                                outline: none;
                                backdrop-filter: blur(8px);
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                             ">
                                ${phaseOptions}
                            </select>
                            <div style="color:var(--text-secondary); font-weight:700; font-size:11px; margin-top:8px; margin-left:4px; text-transform: uppercase; letter-spacing: 1px;">
                                <span style="color: var(--primary-color);">Woche</span> ${Math.floor(daysInPhase / 7) + 1} 
                                <span style="margin: 0 4px; opacity: 0.3;">|</span>
                                <span style="color: var(--text-primary);">Tag ${daysInPhase}</span>
                            </div>
                        </div>
                        ${(!device.options.tank_level_sensor) ? `
                            <div id="tank-refill-${device.id}" style="
                                background: rgba(0, 255, 65, 0.15); 
                                padding: 8px; border-radius: 50%; 
                                width: 32px; height: 32px; 
                                display: flex; align-items: center; justify-content: center;
                                cursor: pointer; border: 1px solid rgba(0, 255, 65, 0.3);
                                box-shadow: 0 0 10px rgba(0, 255, 65, 0.1);
                            " title="Tank füllen">💧</div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="card-header">
                    <div>
                        <div class="card-title">${device.name}</div>
                        <div class="card-subtitle">Local Grow Box Engine v2.1.8</div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                        <div class="status-badge ${masterState && masterState.state === 'on' ? 'online' : 'offline'}" style="display:flex; align-items:center; gap:6px;">
                            <span class="status-indicator ${masterState && masterState.state === 'on' ? 'status-ok' : ''}" style="width:6px; height:6px;"></span>
                            ${masterState && masterState.state === 'on' ? 'Bereit' : 'Standby'}
                        </div>
                        ${masterState && masterState.state === 'on' ? `
                            <div style="font-size: 9px; font-weight: 900; color: ${Math.abs(vpd - vpdTarget.min) < 0.2 || Math.abs(vpd - vpdTarget.max) < 0.2 || (vpd >= vpdTarget.min && vpd <= vpdTarget.max) ? 'var(--accent-color)' : '#fbbf24'}; text-transform: uppercase; letter-spacing: 1.5px; background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 4px; border: 1px solid currentColor;">
                                ${Math.abs(vpd - vpdTarget.min) < 0.2 || Math.abs(vpd - vpdTarget.max) < 0.2 || (vpd >= vpdTarget.min && vpd <= vpdTarget.max) ? 'SYSTEM STABIL' : 'KLIMA-ALARM'}
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="card-body">
                    <div class="sensor-grid">
                        ${this._renderSensorTile('Temperatur', temp, '°C', '🌡️', tempTarget, this._hass.states[device.options.heater_entity]?.state === 'on')}
                        ${this._renderSensorTile('Luftfeuchte', hum, '%', '💧', humTarget)}
                        ${this._renderSensorTile('Klima Score', vpd, 'VPD', '🍃', vpdTarget)}
                        ${device.options.moisture_sensor ? this._renderSensorTile('Boden', getVal(device.options.moisture_sensor), '%', '🌱', { min: parseFloat(device.options.target_moisture || 60) - 2, max: parseFloat(device.options.target_moisture || 60) + 2 }) : `
                            <div class="sensor-tile" style="opacity: 0.3; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                                Kein Bodensensor
                            </div>
                        `}
                    </div>

                    <div style="margin-top:24px; display:grid; grid-template-columns: repeat(3, 1fr); gap:12px;">
                        <div class="info-box">
                            <div class="info-content">
                                <div class="info-label">Leistung</div>
                                <div class="info-val">${Math.round(this._getSummedValue(device.options.power_sensor) || 0)}W</div>
                            </div>
                        </div>
                        <div class="info-box">
                            <div class="info-content">
                                <div class="info-label">Licht</div>
                                <div class="info-val" style="color: ${isLightOn ? 'var(--accent-color)' : 'var(--text-secondary)'}">${isLightOn ? 'AN' : 'AUS'}</div>
                            </div>
                        </div>
                        <div class="info-box">
                            <div class="info-content">
                                <div class="info-label">Abluft</div>
                                <div class="info-val" style="color: ${this._hass.states[device.options.fan_entity]?.state === 'on' ? 'var(--primary-color)' : 'var(--text-secondary)'}">${this._hass.states[device.options.fan_entity]?.state === 'on' ? 'AKTIV' : 'AUS'}</div>
                            </div>
                        </div>
                    </div>

                    ${(device.options.pump_entity) ? `
                        <div style="margin-top:20px; padding:20px; border-radius:20px; background: rgba(0, 242, 255, 0.04); border: 1.5px solid rgba(0, 242, 255, 0.15); box-shadow: inset 0 0 20px rgba(0,242,255,0.03);">
                            <div style="display:flex; justify-content:space-between; margin-bottom:14px; font-size:11px; text-transform:uppercase; font-weight:900; color:var(--text-secondary); letter-spacing: 1.2px;">
                                <span>Tank-Status</span>
                                <span id="tank-config-${device.id}" style="cursor:pointer; color: var(--primary-color); border-bottom: 1px dashed currentColor; padding-bottom: 2px;">
                                    ${device.options.tank_level_sensor ? 'Sensor aktiv' : (device.tankData?.enabled ? 'Einstellungen' : 'Aktivieren')}
                                 </span>
                            </div>
                            ${(device.tankData?.enabled || device.options.tank_level_sensor) ? (() => {
                                // Reactive logic: Prefer live HA state of the sensor over stale tankData
                                let levelPct = 0;
                                let levelLiters = 0;
                                const cap = parseFloat(device.tankData?.capacity_ml || 10000);
                                
                                const tankState = this._hass.states[device.entities.tank];
                                if (tankState && !isNaN(tankState.state)) {
                                    levelPct = parseFloat(tankState.state);
                                    levelLiters = (levelPct / 100.0) * (cap / 1000.0);
                                } else {
                                    // Fallback to tankData if sensor not found
                                    levelPct = Math.round((device.tankData.current_ml / cap) * 100);
                                    levelLiters = device.tankData.current_ml / 1000.0;
                                }

                                return `
                                    <div style="height:12px; background:rgba(0,0,0,0.4); border-radius:6px; overflow:hidden; border: 1px solid rgba(255,255,255,0.05); position:relative;">
                                        <div style="height:100%; width:${Math.min(100, Math.max(0, levelPct))}%; background: ${levelPct <= 0 ? 'linear-gradient(90deg, #ef4444, #f87171, #ef4444)' : 'linear-gradient(90deg, #3b82f6, var(--primary-color), #3b82f6)'}; background-size: 200% 100%; box-shadow: ${levelPct <= 0 ? '0 0 15px rgba(239, 68, 68, 0.5)' : '0 0 15px rgba(0, 242, 255, 0.3)'}; transition:all 1s cubic-bezier(0.4, 0, 0.2, 1); animation: waterFlow 3s linear infinite;"></div>
                                    </div>
                                    <style>
                                        @keyframes waterFlow {
                                            0% { background-position: 0% center; }
                                            100% { background-position: 200% center; }
                                        }
                                    </style>
                                    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:800; margin-top:12px;">
                                        <span style="color: ${levelPct <= 0 ? 'var(--warn-color)' : 'var(--text-primary)'};">
                                            ${levelPct <= 0 ? '⚠️ LEER' : levelLiters.toFixed(1) + 'L'} 
                                            <span style="opacity:0.4; font-weight:600; font-size:10px;">${levelPct <= 0 ? 'BITTE NACHFÜLLEN' : 'VERFÜGBAR'}</span>
                                        </span>
                                        <span style="color: ${levelPct <= 0 ? '#ef4444' : 'var(--primary-color)'}; text-shadow: 0 0 8px ${levelPct <= 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 242, 255, 0.3)'};">${Math.round(levelPct)}%</span>
                                    </div>
                                `;
                            })() : `<div style="font-size:11px; color: var(--text-secondary); text-align:center; padding: 4px 0; font-weight:600; opacity:0.6;">${device.options.tank_level_sensor ? 'Sensorgesteuert' : 'Tank-Tracking ist deaktiviert.'}</div>`}
                        </div>
                    ` : ''}

                    ${(device.options.heater_entity) ? `
                        <div class="info-box" style="margin-top:12px; width:100%; grid-column: span 3; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-size:18px; ${this._hass.states[device.options.heater_entity]?.state === 'on' ? 'filter: drop-shadow(0 0 8px #f97316);' : 'opacity:0.3;'}">${this._hass.states[device.options.heater_entity]?.state === 'on' ? '🔥' : '❄️'}</span>
                                <div style="display:flex; flex-direction:column;">
                                    <span style="font-size:10px; text-transform:uppercase; font-weight:900; color:var(--text-secondary); letter-spacing:1px;">Heizung</span>
                                    <span style="font-size:12px; font-weight:800; color:${this._hass.states[device.options.heater_entity]?.state === 'on' ? '#f97316' : 'var(--text-secondary)'}">${this._hass.states[device.options.heater_entity]?.state === 'on' ? 'HEIZT AKTIV' : 'STANDBY'}</span>
                                </div>
                            </div>
                            <button class="btn ${this._hass.states[device.options.heater_entity]?.state === 'on' ? 'active' : ''}" style="width:auto; padding:6px 16px; font-size:10px;" onclick="this.getRootNode().host._toggle('${device.options.heater_entity}')">
                                ${this._hass.states[device.options.heater_entity]?.state === 'on' ? 'STOP' : 'MANUELL'}
                            </button>
                        </div>
                    ` : ''}
                </div>
                
                <div class="controls">
                    <button class="btn ${masterState?.state === 'on' ? 'active' : ''}" id="btn-master-${device.id}">
                        SYST-EIN
                    </button>
                    ${device.options.pump_entity ? `
                    <button class="btn ${pumpState?.state === 'on' ? 'active' : ''}" id="btn-pump-${device.id}" ${( (device.tankData?.enabled || device.options.tank_level_sensor) && device.tankData.current_ml <= 0 ) ? 'disabled style="opacity:0.5; border-color:#ef4444; color:#ef4444;" title="Tank leer - Pumpe gesperrt"' : ''}>
                        ${( (device.tankData?.enabled || device.options.tank_level_sensor) && device.tankData.current_ml <= 0 ) ? '🔒 ' : ''}PUMPE
                    </button>
                    ` : ''}
                    ${device.options.humidifier_entity ? `
                    <button class="btn ${this._hass.states[device.options.humidifier_entity]?.state === 'on' ? 'active' : ''}" id="btn-humid-${device.id}">
                        NEBEL
                    </button>
                    ` : ''}
                    <button class="btn" id="btn-upload-${device.id}">
                        KAMERA
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

            const btnTankConfig = q(`#tank-config-${device.id}`);
            if (btnTankConfig) btnTankConfig.onclick = () => this._configureTank(device);
            const btnTankRefill = q(`#tank-refill-${device.id}`);
            if (btnTankRefill) btnTankRefill.onclick = () => this._refillTank(device);

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

            // Mouse Tracking for 3D Glow
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                card.style.setProperty('--mouse-x', `${x}%`);
                card.style.setProperty('--mouse-y', `${y}%`);
            });

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

    _renderSensorTile(label, val, unit, icon, targetRange, isHeating = false) {
        let isNull = (val === null || val === undefined);
        const displayVal = isNull ? '--' : `${val}`;
        
        let statusClass = 'status-ok';
        let statusLabel = 'Optimal';
        let glowClass = 'glow-ok';
        
        if (!isNull && targetRange) {
            if (val < targetRange.min || val > targetRange.max) {
                statusClass = 'status-warn';
                statusLabel = val < targetRange.min ? 'Zu Niedrig' : 'Zu Hoch';
                glowClass = 'glow-warn';
            }
        }

        return `
            <div class="sensor-tile ${glowClass}">
                <div class="sensor-label">
                    <span style="font-size: 16px; filter: drop-shadow(0 0 5px currentColor);">${icon}</span>
                    <span>${label}</span>
                    ${isHeating ? `<span style="margin-left:8px; font-size:14px; animation: pulse 2s infinite;">🔥</span>` : ''}
                    ${!isNull ? `<span class="status-indicator ${statusClass}" style="margin-left:auto;"></span>` : ''}
                </div>
                <div class="sensor-value">
                    ${displayVal}<span class="sensor-unit">${unit}</span>
                </div>
                ${targetRange ? `
                    <div style="font-size: 10px; color: var(--text-secondary); margin-top: 12px; font-weight: 700; display:flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px;">
                        <span style="opacity:0.6;">ZIEL: ${targetRange.min} - ${targetRange.max}</span>
                        <span style="color: ${statusClass === 'status-ok' ? 'var(--accent-color)' : 'var(--warn-color)'}; text-transform: uppercase; letter-spacing: 0.5px;">${statusLabel}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    _renderStatBar(label, val, unit, min, max, color, icon, targetRange) {
        let isNull = (val === null || val === undefined);
        const displayVal = isNull ? '--' : `${val} ${unit}`;
        const pct = isNull ? 0 : Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));

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
            <div style="margin-bottom:12px; opacity: ${isNull ? '0.5' : '1'};">
                <div class="stat-row" style="margin-bottom:4px;">
                    <span class="stat-label">${label}</span>
                    <span class="stat-value">${displayVal}</span>
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

            const helpBlock = document.createElement('div');
            helpBlock.style.cssText = "background: rgba(56, 189, 248, 0.05); border-left: 3px solid #38bdf8; padding: 16px; margin-bottom: 24px; border-radius: 4px;";
            helpBlock.innerHTML = `
                <h4 style="margin:0 0 8px 0; color:#38bdf8;">Willkommen in der Geräte-Konfiguration!</h4>
                <p style="margin:0; font-size:13px; color:var(--text-secondary); line-height:1.5;">Hier verknüpfst du deine Home Assistant Geräte (Sensoren & smarte Steckdosen) mit der Grow Box. Die eigentlichen Zielwerte für Temperatur und Luftfeuchtigkeit brauchst du hier nicht zwingend einzugeben – diese steuerst du viel bequemer über den Reiter <strong>Rezepte</strong>!</p>
            `;
            section.appendChild(helpBlock);

            const title = document.createElement('div');
            title.className = 'section-title';
            title.innerText = `${device.name} - Konfiguration`;
            section.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'form-grid';

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
            const appendSelector = (parent, label, configKey, domain, multiple = false, helpText = '') => {
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

                if (helpText) {
                    const hz = document.createElement('div');
                    hz.style.cssText = "font-size:11px; color:var(--text-secondary); margin-top:4px; margin-left:2px;";
                    hz.innerText = helpText;
                    group.appendChild(hz);
                }

                parent.appendChild(group);
            };

            // DOM-based Helper for Input
            const appendInput = (parent, label, configKey, type = 'text', icon = '', helpText = '') => {
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

                if (helpText) {
                    const hz = document.createElement('div');
                    hz.style.cssText = "font-size:11px; color:var(--text-secondary); margin-top:4px; margin-left:2px;";
                    hz.innerHTML = helpText;
                    group.appendChild(hz);
                }

                parent.appendChild(group);
            };

            // NEW: Card Helper
            const createCard = (title, icon) => {
                const card = document.createElement('div');
                card.style.cssText = "background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 20px; padding: 24px; display: flex; flex-direction: column; gap: 4px; backdrop-filter: blur(10px); position: relative; overflow: hidden;";
                
                const header = document.createElement('div');
                header.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid var(--glass-border); padding-bottom: 12px;";
                header.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px;">
                        <span style="font-size: 20px;">${icon}</span> 
                        <span style="font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: var(--primary-color);">${title}</span>
                    </div>
                `;
                card.appendChild(header);

                const body = document.createElement('div');
                body.style.display = 'flex';
                body.style.flexDirection = 'column';
                body.style.gap = '12px';
                card.appendChild(body);

                return { card, body, header };
            };

            const settingsGrid = document.createElement('div');
            settingsGrid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr)); gap: 24px; width: 100%;";

            // --- Card: Temperatur & Klima 🌡️ ---
            const cardTemp = createCard('Temperatur & Klima', '🌡️');
            appendSelector(cardTemp.body, 'Temperatur Sensor', 'temp_sensor', ['sensor']);
            appendInput(cardTemp.body, 'Standard Ziel Temperatur (°C)', 'target_temp', 'number', '', 'Wird evtl. von Rezepten überschrieben.');
            appendInput(cardTemp.body, 'Temp Hysterese (Lüfter °C)', 'temp_hysteresis', 'number', '', 'Ab welcher Abweichung nach oben soll der Abluft-Ventilator kühlen? (Standard: 1.0)');
            appendSelector(cardTemp.body, 'Heizung (Steckdose)', 'heater_entity', ['switch', 'input_boolean']);
            appendInput(cardTemp.body, 'Heizung Hysterese (°C)', 'heater_hysteresis', 'number', '', 'Ab welcher Abweichung nach unten soll die Heizung heizen? (Standard: 1.0)');
            settingsGrid.appendChild(cardTemp.card);

            // --- Card: Abluft & Luftfeuchte 🌪️ ---
            const cardHum = createCard('Abluft & Luftfeuchte', '🌪️');
            appendSelector(cardHum.body, 'Luftfeuchtigkeits Sensor', 'humidity_sensor', ['sensor']);
            appendInput(cardHum.body, 'Standard Ziel Feuchte (%)', 'target_humidity', 'number', '', 'Wird evtl. von Rezepten überschrieben.');
            appendSelector(cardHum.body, 'Abluft Ventilator (Steckdose)', 'fan_entity', ['switch', 'fan', 'input_boolean']);
            appendSelector(cardHum.body, 'Luftbefeuchter (Steckdose)', 'humidifier_entity', ['switch', 'input_boolean', 'humidifier']);
            appendInput(cardHum.body, 'Feuchte Hysterese (Befeuchter %)', 'humidity_hysteresis', 'number', '', 'Ab welcher Abweichung nach unten soll der Befeuchter sprühen? (Standard: 5.0)');
            appendInput(cardHum.body, 'Abluft-Limit (Notfall Max %)', 'max_humidity', 'number', '', 'Bei wie viel % LF soll die Abluft sofort angehen um Schimmel zu verhindern? (Bsp: 80)');
            appendInput(cardHum.body, 'Abluft Nachlauf/Hysterese (%)', 'fan_hysteresis', 'number', '', 'Wie stark muss die LF unter das Notfall-Limit fallen, bis der Lüfter wieder stoppt? (Std: 5.0)');
            settingsGrid.appendChild(cardHum.card);

            // --- Card: Bewässerung & Boden 💧 ---
            const cardWater = createCard('Bewässerung & Boden', '💧');
            appendSelector(cardWater.body, 'Bodenfeuchte Sensor', 'moisture_sensor', ['sensor']);
            appendInput(cardWater.body, 'Standard Ziel Bodenfeuchte (%)', 'target_moisture', 'number', '', 'Wird evtl. von Rezepten überschrieben.');
            appendSelector(cardWater.body, 'Wasserpumpe (Steckdose)', 'pump_entity', ['switch', 'input_boolean']);
            appendSelector(cardWater.body, 'Füllstand Sensor (Tank)', 'tank_level_sensor', ['sensor'], false, 'Optional: Meldet den aktuellen Tank-Füllstand in % (0-100).');
            appendInput(cardWater.body, 'Pumpen Dauer (Sek)', 'pump_duration', 'number', '', 'Wie viele Sekunden läuft die Wasserpumpe beim Gießen? (Standard: 5)');
            settingsGrid.appendChild(cardWater.card);

            // --- Card: Licht & Basis-Setup 💡 ---
            const cardLight = createCard('Licht & Basis-Setup', '💡');
            appendSelector(cardLight.body, 'Pflanzenbeleuchtung (Steckdose)', 'light_entity', ['switch', 'light', 'input_boolean']);
            appendInput(cardLight.body, 'Licht Start-Uhrzeit (Stunde)', 'light_start_hour', 'number', '⏰', 'Beispiel: 6 bedeutet das Licht geht um 06:00 Uhr morgens an.');
            appendSelector(cardLight.body, 'Kamera', 'camera_entity', ['camera'], false, 'Verbindet dein Dashboard mit der Live-Kamera.');
            appendInput(cardLight.body, 'Grow Start-Datum', 'phase_start_date', 'date', '📅', 'Tipp: Kann im Tagebuch präziser pro Grow verwaltet werden.');
            settingsGrid.appendChild(cardLight.card);

            // --- Card: Energie & Kosten ⚡ ---
            const cardEnergy = createCard('Energie & Kosten', '⚡');
            appendSelector(cardEnergy.body, 'Stromverbrauch (kWh Sensor)', 'energy_sensor', ['sensor'], true, 'Zählt Gesamtkosten. Bei Mehrfachauswahl addiert.');
            appendSelector(cardEnergy.body, 'Aktuelle Leistung (Watt Sensor)', 'power_sensor', ['sensor'], true, 'Optional, dient zur Anzeige oben rechts im Dashboard.');
            
            const rowPrice = document.createElement('div');
            rowPrice.className = 'form-group';
            rowPrice.innerHTML = `<label>Strompreis (€ / kWh)</label>`;
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
            cardEnergy.body.appendChild(rowPrice);
            settingsGrid.appendChild(cardEnergy.card);

            // --- Card: KI Pflanzenanalyse 🧠 ---
            const cardAI = createCard('KI Pflanzenanalyse', '🧠');
            const rowProvider = document.createElement('div');
            rowProvider.className = 'form-group';
            rowProvider.innerHTML = `<label>KI-Anbieter auswählen</label>`;
            const selectProvider = document.createElement('select');
            selectProvider.style.cssText = "width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:white; padding:10px; border-radius:6px;";
            selectProvider.innerHTML = `
                <option value="none" ${device.options.ai_provider === 'none' ? 'selected' : ''}>Kein AI-Check</option>
                <option value="openai" ${device.options.ai_provider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4o Vision)</option>
                <option value="gemini" ${device.options.ai_provider === 'gemini' ? 'selected' : ''}>Google Gemini 1.5 Pro</option>
            `;
            selectProvider.onchange = (e) => {
                this._draft[device.entryId] = this._draft[device.entryId] || {};
                this._draft[device.entryId].ai_provider = e.target.value;
            };
            rowProvider.appendChild(selectProvider);
            cardAI.body.appendChild(rowProvider);
            
            appendInput(cardAI.body, 'API Key', 'ai_api_key', 'password', '🔑', 'Dein persönlicher Schlüssel von OpenAI oder Google.');

            const rowAuto = document.createElement('div');
            rowAuto.style.cssText = "display:flex; align-items:center; gap:10px; margin-top:8px; background:rgba(255,255,255,0.03); padding:10px; border-radius:8px;";
            rowAuto.innerHTML = `
                <input type="checkbox" id="ai-auto-${device.id}" ${device.options.ai_enabled ? 'checked' : ''} style="width:20px; height:20px; margin:0;">
                <label for="ai-auto-${device.id}" style="font-size:12px; cursor:pointer;">Automatischer täglicher KI-Check (benötigt Kamera)</label>
            `;
            rowAuto.querySelector('input').onchange = (e) => {
                this._draft[device.entryId] = this._draft[device.entryId] || {};
                this._draft[device.entryId].ai_enabled = e.target.checked;
            };
            cardAI.body.appendChild(rowAuto);
            settingsGrid.appendChild(cardAI.card);

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
            section.style.background = 'transparent';

            const renderPhaseRow = (label, sub, icon, configKey, val) => `
                <div class="phase-row" style="
                    display: flex; 
                    align-items: center; 
                    justify-content: space-between; 
                    padding: 20px 24px; 
                    background: var(--glass-bg); 
                    border: 1.5px solid var(--glass-border); 
                    border-radius: 16px; 
                    margin-bottom: 14px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    backdrop-filter: blur(10px);
                " onmouseover="this.style.borderColor='var(--primary-color)'; this.style.transform='translateX(5px)'; this.style.background='rgba(0, 242, 255, 0.03)'" onmouseout="this.style.borderColor='var(--glass-border)'; this.style.transform='translateX(0)'; this.style.background='var(--glass-bg)'">
                    <div style="display:flex; align-items:center; gap:20px;">
                        <div style="width: 44px; height: 44px; background: rgba(0,0,0,0.2); border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px; border: 1.5px solid var(--glass-border); flex-shrink: 0;">
                            ${icon}
                        </div>
                        <div>
                            <div style="font-size:11px; color:var(--primary-color); font-weight:900; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">${label}</div>
                            <div style="font-size:12px; color:var(--text-secondary); font-weight: 500;">${sub}</div>
                        </div>
                    </div>
                    <div class="phase-input-box" style="display:flex; align-items:center; gap:12px; background: rgba(0,0,0,0.3); padding:8px 16px; border-radius:12px; border:1.5px solid var(--glass-border);">
                        <input type="number" step="0.5" value="${val}" data-key="${configKey}"
                            style="width:70px; text-align:center; font-weight:900; font-size:20px; color:#fff; background:transparent; border:none; border-bottom:2.5px solid var(--primary-color); border-radius:0; padding:4px;">
                        <span style="font-size:10px; font-weight:800; color: var(--text-secondary); text-transform:uppercase; letter-spacing:1px;">Std</span>
                    </div>
                </div>
            `;

            section.innerHTML = `
                <div class="card" style="max-width:900px; margin: 0 auto; background: var(--card-bg); border-radius: 24px; border: 1.5px solid var(--glass-border); overflow: hidden; backdrop-filter: blur(15px);">
                    <div style="background: linear-gradient(90deg, rgba(0, 242, 255, 0.1) 0%, transparent 100%); padding: 32px; border-bottom: 1.5px solid var(--glass-border);">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="font-size: 32px; filter: drop-shadow(0 0 10px var(--primary-color));">⏱️</div>
                            <div>
                                <h2 style="margin:0; font-size:clamp(18px, 5vw, 24px); color:#fff; font-weight: 900; text-transform: uppercase; letter-spacing: -0.5px; line-height: 1.2;">${device.name} Einstellungen</h2>
                                <p style="color:var(--text-secondary); margin:4px 0 0 0; font-size:12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Konfiguration der Lichtzyklus-Architektur</p>
                            </div>
                        </div>
                    </div>
                    
                    <div style="padding: 32px;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            ${renderPhaseRow('Keimling', 'Seedling Phase - LF 65-80%', '🌱', 'phase_seedling_hours', device.options.phase_seedling_hours !== undefined ? device.options.phase_seedling_hours : 18)}
                            ${renderPhaseRow('Wachstum', 'Vegetative Phase - Fokus Stickstoff', '🌿', 'phase_vegetative_hours', device.options.phase_vegetative_hours !== undefined ? device.options.phase_vegetative_hours : 18)}
                            ${renderPhaseRow('Blüte', 'Blüte Phase - 12/12 Zyklus Essentiell', '🌸', 'phase_flowering_hours', device.options.phase_flowering_hours !== undefined ? device.options.phase_flowering_hours : 12)}
                            ${renderPhaseRow('Trocknen', 'Trocknungs Phase - Dunkel & Kühl', '🍂', 'phase_drying_hours', device.options.phase_drying_hours !== undefined ? device.options.phase_drying_hours : 0)}
                            ${renderPhaseRow('Veredelung', 'Curing Phase - Luftfeuchte Stabil 58-62%', '🏺', 'phase_curing_hours', device.options.phase_curing_hours !== undefined ? device.options.phase_curing_hours : 0)}
                        </div>
                        
                        <div style="margin-top:40px; display:flex; justify-content:flex-end;">
                            <button class="btn active" id="save-p-${device.id}" style="width:auto; display:inline-flex; padding:16px 48px; font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; border-radius: 14px;">
                                PARAMETER ÜBERNEHMEN
                            </button>
                        </div>
                    </div>
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
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary); font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">No Operational Units Found</div>';
            return;
        }

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: var(--primary-color);">
                <div style="font-size: 40px; margin-bottom: 20px; animation: spin 2s linear infinite; filter: drop-shadow(0 0 10px var(--primary-color));">🔄</div>
                <div style="font-weight: 900; text-transform: uppercase; letter-spacing: 2px; font-size: 12px;">Synchronisiere System-Logs...</div>
            </div>
        `;

        try {
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
                    console.warn("Log sync failed for " + device.name);
                }
            }

            container.innerHTML = '';
            
            const outerWrapper = document.createElement('div');
            outerWrapper.style.cssText = "max-width: 900px; margin: 0 auto; padding: 20px;";
            
            const header = document.createElement('div');
            header.className = 'header';
            header.style.cssText = "background: var(--glass-bg); border-radius: 24px; margin-bottom: 32px; border: 1.5px solid var(--glass-border); backdrop-filter: blur(10px); position: relative; overflow: hidden; height: auto;";
            header.innerHTML = `
                <div style="display:flex; align-items:center; gap:20px;">
                    <div style="width: 48px; height: 48px; background: rgba(0, 242, 255, 0.1); border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 24px; border: 1px solid rgba(0, 242, 255, 0.2);">📋</div>
                    <div>
                        <div style="font-size:18px; font-weight:900; color: #fff; letter-spacing: -0.5px; text-transform: uppercase;">System Ledger</div>
                        <div style="font-size:11px; color: var(--primary-color); font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px;">Echtzeit Event Dechiffrierung</div>
                    </div>
                </div>
                <button class="btn active" id="btn-refresh-logs" style="width: auto; padding: 10px 20px; font-weight: 900; font-size: 11px;">SYNC AKTUALISIEREN</button>
            `;
            outerWrapper.appendChild(header);

            const listContainer = document.createElement('div');
            listContainer.style.display = 'flex';
            listContainer.style.flexDirection = 'column';
            listContainer.style.gap = '14px';

            allLogs.sort((a, b) => {
                const parseDate = (str) => {
                    const match = str.match(/^\[(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})\]/);
                    if (!match) return 0;
                    return new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}`).getTime();
                };
                return parseDate(b.line) - parseDate(a.line);
            });

            if (allLogs.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = "padding:60px; text-align:center; color:var(--text-secondary); font-weight: 800; text-transform: uppercase; letter-spacing: 1px; background: var(--glass-bg); border-radius: 20px; border: 1px solid var(--glass-border);";
                empty.innerText = "Keine kritischen biologischen Events aufgezeichnet.";
                listContainer.appendChild(empty);
            } else {
                for (const entry of allLogs) {
                    const item = document.createElement('div');
                    item.className = 'log-item';
                    item.style.cssText = "background: var(--glass-bg); border-radius: 16px; border: 1.5px solid var(--glass-border); display:flex; align-items:center; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); backdrop-filter: blur(10px);";
                    
                    let timeStr = "";
                    let msgStr = entry.line;
                    const match = entry.line.match(/^\[(.*?)\]\s+(.*)$/);
                    if (match) { timeStr = match[1]; msgStr = match[2]; }

                    let icon = '📝'; let accentColor = '#64748b';
                    if (msgStr.includes('Licht')) { icon = '💡'; accentColor = '#fbbf24'; }
                    else if (msgStr.includes('Pumpe')) { icon = '💧'; accentColor = '#3b82f6'; }
                    else if (msgStr.includes('Abluft')) { icon = '🌪️'; accentColor = '#9ca3af'; }
                    else if (msgStr.includes('Befeuchter')) { icon = '💦'; accentColor = '#38bdf8'; }
                    else if (msgStr.includes('Grow') || msgStr.includes('Zählerstand')) { icon = '🌿'; accentColor = 'var(--accent-color)'; }

                    item.style.borderLeft = `4px solid ${accentColor}`;

                    item.innerHTML = `
                        <div class="log-time" style="color:var(--text-secondary); font-size:11px; font-weight: 800; border-right: 1.5px solid var(--glass-border);">
                            <div style="color:var(--text-primary); font-size: 13px;">${timeStr.split(' ')[1]}</div>
                            <div style="opacity: 0.5; margin-top: 4px;">${timeStr.split(' ')[0]}</div>
                        </div>
                        
                        <div class="log-icon" style="background: rgba(0,0,0,0.2); border-radius: 50%; display: flex; align-items:center; justify-content:center; border: 1.5px solid var(--glass-border); flex-shrink: 0;">
                            ${icon}
                        </div>
                        
                        <div style="display:flex; flex-direction:column; gap:4px; flex:1; overflow: hidden;">
                            <div style="font-size:10px; font-weight:900; color:${accentColor}; text-transform:uppercase; letter-spacing:1px; display: flex; align-items: center; gap: 8px;">
                                ${entry.devName} <span class="status-indicator status-ok" style="width: 4px; height: 4px;"></span>
                            </div>
                            <div style="font-size:14px; color:var(--text-primary); font-weight: 500; line-height: 1.4; word-break: break-word;">
                                ${msgStr.replace(/eingeschaltet/g, '<span style="color:var(--accent-color); font-weight:800;">ON</span>').replace(/ausgeschaltet/g, '<span style="color:#ef4444; font-weight:800;">OFF</span>')}
                            </div>
                        </div>
                    `;
                    listContainer.appendChild(item);
                }
            }

            outerWrapper.appendChild(listContainer);
            container.appendChild(outerWrapper);
            
            setTimeout(() => {
                const btn = this.shadowRoot.getElementById('btn-refresh-logs');
                if (btn) btn.onclick = () => this._renderLogs(container);
            }, 0);

        } catch (e) {
            console.error("Log fetch failed", e);
            container.innerHTML = `<div style="color:#ef4444; padding:40px; text-align:center; font-weight:900;">DECRYPTION ERROR: ${e.message}</div>`;
        }
    }

    _renderInfo(container) {
        container.innerHTML = `
            <div style="max-width:1000px; margin:0 auto; padding:16px;">
                <div style="text-align:center; margin-bottom:48px; position:relative;">
                    <div style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 200px; height: 2px; background: linear-gradient(90deg, transparent, var(--primary-color), transparent); opacity:0.6;"></div>
                    <h2 style="padding-top: 24px; margin: 0; background: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 950; font-size: 36px; text-transform: uppercase; letter-spacing: -1px;">
                        System Dokumentation
                    </h2>
                    <p style="color: var(--text-secondary); font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-top: 8px;">Neural Grow Guide & Hilfe</p>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 32px;">
                    <!-- VPD Section -->
                    <div class="card" style="background: var(--glass-bg); border: 1.5px solid var(--glass-border); border-radius: 24px; padding: 32px; backdrop-filter: blur(15px);">
                        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; border-bottom: 1.5px solid var(--glass-border); padding-bottom: 16px;">
                            <span style="font-size: 32px; filter: drop-shadow(0 0 10px var(--accent-color));">🍃</span>
                            <div style="font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--accent-color);">VPD Kalibrierung</div>
                        </div>
                        <div class="card-body" style="padding: 0;">
                            <p style="color:var(--text-secondary); margin-bottom:24px; font-size: 13px; line-height: 1.7; font-weight: 500;">
                                Vapor Pressure Deficit (VPD) gibt an, wie "durstig" deine Atmosphäre ist. Eine präzise Abstimmung maximiert den Nährstofftransport und das Wachstum.
                            </p>
                            <div style="background: rgba(0, 255, 65, 0.03); border: 1px solid rgba(0, 255, 65, 0.1); border-radius: 16px; padding: 20px;">
                                <table style="width:100%; text-align:left; border-collapse:collapse; color:#fff; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                                    <tr style="border-bottom:1.5px solid rgba(0, 255, 65, 0.1);">
                                        <th style="padding:12px; color: var(--accent-color); font-weight: 900;">Phase</th>
                                        <th style="padding:12px; color: var(--accent-color); font-weight: 900; text-align: right;">Ziel (kPa)</th>
                                    </tr>
                                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                                        <td style="padding:12px;">🌱 Keimling</td>
                                        <td style="padding:12px; color:var(--accent-color); text-align: right;">0.4 - 0.8</td>
                                    </tr>
                                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                                        <td style="padding:12px;">🌿 Wachstum</td>
                                        <td style="padding:12px; color:var(--accent-color); text-align: right;">0.8 - 1.2</td>
                                    </tr>
                                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                                        <td style="padding:12px;">🌸 Blüte</td>
                                        <td style="padding:12px; color:var(--accent-color); text-align: right;">1.2 - 1.6</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:12px;">🍂 Trocknen</td>
                                        <td style="padding:12px; color:var(--accent-color); text-align: right;">0.8 - 1.0</td>
                                    </tr>
                                </table>
                            </div>
                        </div>
                    </div>

                    <!-- Humidity Section -->
                    <div class="card" style="background: var(--glass-bg); border: 1.5px solid var(--glass-border); border-radius: 24px; padding: 32px; backdrop-filter: blur(15px);">
                        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; border-bottom: 1.5px solid var(--glass-border); padding-bottom: 16px;">
                            <span style="font-size: 32px; filter: drop-shadow(0 0 10px var(--primary-color));">💦</span>
                            <div style="font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--primary-color);">Smart Misting</div>
                        </div>
                        <div class="card-body" style="padding: 0;">
                            <p style="color:var(--text-secondary); margin-bottom:20px; font-size: 13px; line-height: 1.7; font-weight: 500;">
                                Unsere pulsbasierte Verdunstungslogik verhindert Staunässe:
                            </p>
                            <div style="display: grid; gap: 12px;">
                                <div style="background: rgba(0, 242, 255, 0.05); padding: 14px; border-radius: 12px; border: 1px solid rgba(0, 242, 255, 0.1);">
                                    <div style="font-size: 10px; font-weight: 900; color: var(--primary-color); margin-bottom: 4px; text-transform: uppercase;">Puls-Zyklen</div>
                                    <div style="font-size: 12px; color: #fff; font-weight: 600;">Kurze aktive Stöße gefolgt von Verteilungspausen.</div>
                                </div>
                                <div style="background: rgba(0, 242, 255, 0.05); padding: 14px; border-radius: 12px; border: 1px solid rgba(0, 242, 255, 0.1);">
                                    <div style="font-size: 10px; font-weight: 900; color: var(--primary-color); margin-bottom: 4px; text-transform: uppercase;">Zonen-Tracking</div>
                                    <div style="font-size: 12px; color: #fff; font-weight: 600;">Visualisierung der Zielbereiche basierend auf aktiver Hysterese.</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Support Section -->
                    <div class="card" style="grid-column: 1 / -1; background: rgba(0, 255, 65, 0.03); border: 1.5px solid rgba(0, 255, 65, 0.2); border-radius: 24px; padding: 40px; text-align: center; position: relative; overflow: hidden;">
                        <div style="position: absolute; bottom: -20px; right: -20px; font-size: 140px; opacity: 0.03; font-weight: 900; letter-spacing: -5px; pointer-events: none;">OPENKAIRO</div>
                        <h3 style="margin: 0 0 16px 0; color: var(--accent-color); font-weight: 900; text-transform: uppercase; letter-spacing: 1px;">Die Evolution unterstützen</h3>
                        <p style="color:var(--text-secondary); max-width: 600px; margin: 0 auto 32px auto; font-size: 14px; line-height: 1.7; font-weight: 500;">
                            Local Grow Box ist ein Open-Source-Interface. Unterstütze die Entwicklung von Funktionen der nächsten Generation.
                        </p>
                        <a href="https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=info@low-streaming.de&currency_code=EUR" target="_blank" style="text-decoration:none;">
                            <button class="btn active" style="width:auto; padding:16px 48px; font-weight:900; font-size: 14px; background: var(--accent-color); color: #0b1121; box-shadow: 0 0 30px rgba(0, 255, 65, 0.2); text-transform: uppercase; letter-spacing: 1px;">
                                KAFFEE-MASCHINE FREISCHALTEN ☕
                            </button>
                        </a>
                    </div>
                </div>
                
                <div style="text-align:center; margin-top:60px; opacity:0.6; font-size:11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">
                    Local Grow Box OS v2.1.8 | Intelligence by OpenKAIRO
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
            return '<div style="height: 150px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: var(--glass-bg); border-radius: 16px; border: 1px solid var(--glass-border); margin-bottom: 20px; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 1px;">Lade ' + label + '...</div>';
        }

        const data = this.historyData[entityId] || [];
        const currentState = this._hass && this._hass.states[entityId] ? this._hass.states[entityId].state : '-';

        if (data.length === 0 || data.filter(d => !isNaN(parseFloat(d.state))).length === 0) {
            return `
                <div class="chart-row" data-entity="${entityId}" style="margin-bottom: 24px; text-align: left; cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; padding: 0 4px;">
                        <h4 style="color: ${colorHex}; margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 800;">${label}</h4>
                        <span style="color: #fff; font-size: 16px; font-weight: 800;">${currentState} ${unit}</span>
                    </div>
                    <div style="height: 140px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: var(--glass-bg); border-radius: 16px; border: 1px solid var(--glass-border);">
                        <div style="text-align:center;">
                            <div style="font-size:24px; margin-bottom:8px; animation: pulse-soft 2s infinite;">🕒</div>
                            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Warte auf Datenpunkte...</span>
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
            <div class="chart-row" data-entity="${entityId}" style="margin-bottom: 24px; text-align: left; cursor: pointer;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; padding: 0 4px;">
                    <h4 style="color: ${colorHex}; margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 800;">${label}</h4>
                    <span style="color: #fff; font-size: 18px; font-weight: 800; letter-spacing: -0.5px;">${lastState} ${unit}</span>
                </div>
                <div style="position: relative; height: ${height + padding * 2}px; border-radius: 16px; background: var(--glass-bg); border: 1px solid var(--glass-border); overflow: hidden; transition: border-color 0.3s ease;">
                    <svg viewBox="0 -${padding} ${width} ${height + padding * 2}" preserveAspectRatio="none" style="width: 100%; height: 100%; display: block;">
                        <defs>
                            <linearGradient id="grad_${safeId}" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:${colorHex};stop-opacity:0.3" />
                                <stop offset="100%" style="stop-color:${colorHex};stop-opacity:0.0" />
                            </linearGradient>
                        </defs>
                        <path d="${fillPathData}" fill="url(#grad_${safeId})" />
                        <path d="${pathData}" fill="none" stroke="${colorHex}" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" style="filter: drop-shadow(0 0 5px ${colorHex}50);"/>
                    </svg>
                    <div style="position: absolute; top: 12px; left: 16px; color: ${colorHex}; font-size: 10px; font-weight: 800; text-transform: uppercase; opacity: 0.6;">MAX: ${maxVal.toFixed(1)}</div>
                    <div style="position: absolute; bottom: 12px; left: 16px; color: var(--text-secondary); font-size: 10px; font-weight: 800; text-transform: uppercase;">MIN: ${minVal.toFixed(1)}</div>
                </div>
            </div>
        `;
    }

    _renderStatistics(container) {
        if (!this._devices || this._devices.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">Keine Grow Box gefunden. Bitte Integration hinzuf??gen.</div>';
            return;
        }

        const statsDiv = document.createElement('div');
        statsDiv.innerHTML = `
            <div style="max-width:1200px; margin:0 auto; padding:16px;">
                <h2 style="color:var(--text-primary); margin-bottom:12px;">📈 Statistiken & Graphen</h2>
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
                <div style="border-bottom: 1px solid var(--glass-border); padding-bottom: 20px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
                    <div style="width: 4px; height: 24px; background: var(--primary-color); border-radius: 2px; box-shadow: var(--cyan-glow);"></div>
                    <h3 style="margin:0; font-size:18px; font-weight: 800; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">${device.name} Analytik</h3>
                </div>
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    ${tempSensor ? this._renderChart(tempSensor, '#ef4444', '🌡️ Temperatur-Verlauf', getUnit(tempSensor, '°C')) : ''}
                    ${humSensor ? this._renderChart(humSensor, 'var(--primary-color)', '💧 Feuchtigkeits-Verlauf', getUnit(humSensor, '%')) : ''}
                    ${vpdSensor ? this._renderChart(vpdSensor, 'var(--accent-color)', '🍃 Klima-Effizienz (VPD)', getUnit(vpdSensor, 'VPD')) : ''}
                    ${moistSensor ? this._renderChart(moistSensor, '#8b5cf6', '🪴 Substratfeuchte', getUnit(moistSensor, '%')) : ''}
                </div>
                <div style="margin-top: 24px; text-align: left; padding: 16px; background: rgba(0, 242, 255, 0.02); border-radius: 12px; border: 1px solid rgba(0, 242, 255, 0.1);">
                    <h4 style="margin: 0; color: var(--primary-color); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 14px;">💡</span> Interaktive Ansicht: Tippe auf einen Graphen für Details
                    </h4>
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
            title.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:20px; filter: drop-shadow(0 0 8px var(--primary-color));">📖</span>
                    <span>${device.name} - LOGBUCH</span>
                </div>
                <button class="btn active" style="padding:8px 20px; font-size:11px; box-shadow: 0 0 15px rgba(0,242,255,0.2);" id="start-grow-${device.id}">
                    🌱 NEUER GROW
                </button>
            `;
            section.appendChild(title);

            const activeGrow = (device.grows || []).find(g => g.status === 'active');
            
            if (activeGrow) {
                const activeCard = document.createElement('div');
                activeCard.id = `active-grow-card-${device.id}`;
                activeCard.className = 'active-grow-card';
                activeCard.style.cssText = "background: rgba(0, 242, 255, 0.02); border: 1px solid rgba(0, 242, 255, 0.15); border-radius: 20px; padding: 24px; margin-bottom: 24px; position:relative; overflow:hidden; backdrop-filter: blur(10px);";
                
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
                const healthColor = vpdScore > 80 ? "var(--accent-color)" : (vpdScore > 50 ? "#fbbf24" : "#ef4444");

                activeCard.innerHTML = `
                    <div style="position:absolute; top:-30px; right:-30px; font-size:160px; opacity:0.04; pointer-events:none; filter: blur(5px); transform: rotate(15deg);">🌿</div>
                    
                    <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 28px; border-bottom: 1px solid var(--glass-border); padding-bottom: 20px;">
                        <div style="background: var(--accent-color); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; box-shadow: var(--success-glow);">🚀</div>
                        <div>
                            <div style="font-size:11px; color:var(--accent-color); text-transform:uppercase; font-weight:900; letter-spacing:2.5px;">MISSION STATUS: AKTIV</div>
                            <div style="font-size:28px; font-weight:950; color: #fff; letter-spacing: -1px; text-transform: uppercase;">${activeGrow.name}</div>
                        </div>
                        <div style="margin-left: auto; text-align: right;">
                             <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:800; letter-spacing:1px;">Genetik</div>
                             <div style="font-size:15px; font-weight:700; color:var(--primary-color);">${activeGrow.strain || 'Unbekannt'}</div>
                        </div>
                    </div>

                    <div class="diary-active-grid">
                        <!-- Segment 1: Progress -->
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; padding: 20px;">
                            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:900; letter-spacing:1.5px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                                <span style="color:var(--primary-color);">●</span> ZEITSTRAHL
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px;">
                                <span style="font-size:32px; font-weight:950; color:#fff;">TAG ${days}</span>
                                <span style="font-size:12px; font-weight:800; color:var(--text-secondary);">ZIEL: ${totalDays} TAGE</span>
                            </div>
                            <div style="height:12px; background:rgba(0,0,0,0.3); border-radius:6px; overflow:hidden; border: 1px solid rgba(255,255,255,0.05); position:relative;">
                                <div style="width:${progress}%; height:100%; background:linear-gradient(90deg, var(--accent-color), var(--primary-color)); box-shadow: 0 0 15px rgba(0, 242, 255, 0.3); transition: width 1s ease;"></div>
                            </div>
                            <div style="font-size:10px; color:var(--text-secondary); margin-top:10px; text-align:right; font-weight:800; letter-spacing:1px;">PROGRESS: ${Math.round(progress)}%</div>
                        </div>

                        <!-- Segment 2: Energy -->
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; padding: 20px; text-align: center;">
                            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:900; letter-spacing:1.5px; margin-bottom:12px; display:flex; align-items:center; justify-content:center; gap:8px;">
                                <span style="color:#fbbf24;">●</span> ENERGIE & KOSTEN
                            </div>
                            <div style="font-size:32px; font-weight:950; color: #fff;"><span class="val-kwh">${powerStr}</span><small style="font-size:12px; color:var(--text-secondary); margin-left:4px;">kWh</small></div>
                            <div style="font-size:18px; font-weight:900; color:var(--accent-color); margin-top:4px;">~ <span class="val-cost">${costStr}</span> €</div>
                            <div style="font-size:9px; color: var(--text-secondary); font-weight:800; margin-top:10px; text-transform:uppercase; display:flex; align-items:center; justify-content:center; gap:6px;">
                                <span class="val-watts" style="color:#fff; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">${wattStr}</span> WATT CURRENT LOAD
                            </div>
                        </div>

                        <!-- Segment 3: Bios-Index -->
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 16px; padding: 20px; text-align: center; display:flex; flex-direction:column; align-items:center;">
                            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:900; letter-spacing:1.5px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                                <span style="color:${healthColor};">●</span> BIOS-INDEX
                            </div>
                            <div class="score-gauge" style="width: 56px; height: 56px; margin-bottom: 12px;">
                                <svg viewBox="0 0 36 36">
                                    <path class="bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                    <path class="fill" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                                          stroke="${healthColor}" 
                                          stroke-dasharray="${vpdScore}, 100" />
                                </svg>
                                <div class="score-value" style="font-size:14px; color:#fff;">${vpdScore}%</div>
                            </div>
                            <div style="background:rgba(0,0,0,0.3); border-radius:8px; padding:4px 8px; border: 1px solid var(--glass-border);">
                                <svg id="vpd-sparkline-${device.id}" width="80" height="25" viewBox="0 0 100 40"></svg>
                            </div>
                        </div>
                    </div>

                    <!-- AI Alert Module -->
                    <div id="ai-module-${activeGrow.id}"></div>

                    <!-- Mission Log / Notes Module -->
                    <div id="notes-module-${activeGrow.id}"></div>

                    <!-- Controls & Gallery Container -->
                    <div class="diary-controls-grid" style="margin-top:28px; display:grid; grid-template-columns: 200px 1fr; gap:20px; border-top:1px solid var(--glass-border); padding-top:24px;">
                        <div style="display:flex; flex-direction:column; gap:10px;">
                            <button class="btn active" style="justify-content:flex-start; font-size:11px;" id="add-event-${activeGrow.id}">📝 EVENT LOG</button>
                            <button class="btn" style="justify-content:flex-start; font-size:11px;" id="edit-grow-${activeGrow.id}">📓 NOTIZ</button>
                            <button class="btn" style="justify-content:flex-start; font-size:11px;" id="take-snapshot-${activeGrow.id}">📸 FOTO SCAN</button>
                            <button class="btn" style="background:rgba(239, 68, 68, 0.08); color:#ef4444; border-color:rgba(239, 68, 68, 0.3); justify-content:flex-start; font-size:11px;" id="stop-grow-${activeGrow.id}">🔴 BEENDEN</button>
                        </div>
                        <div id="gallery-container-${activeGrow.id}" style="min-height:100px;"></div>
                    </div>
                `;
                section.appendChild(activeCard);

                // AI Report Display (Integrated into Dashboard)
                if (activeGrow.ai_reports && activeGrow.ai_reports.length > 0) {
                    const latestReport = activeGrow.ai_reports[activeGrow.ai_reports.length - 1];
                    const aiModule = section.querySelector(`#ai-module-${activeGrow.id}`);
                    if (aiModule) {
                        aiModule.style.cssText = "background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 12px; padding: 16px; margin-top: 24px; position:relative; animation: slideUp 0.4s ease-out;";
                        aiModule.innerHTML = `
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                                <span style="font-size:18px; filter: drop-shadow(0 0 8px #a855f7);">🧠</span>
                                <span style="font-weight:900; font-size:11px; text-transform:uppercase; color:#a855f7; letter-spacing:1px;">KI-Gesundheitsbericht (Stand: ${new Date(latestReport.date).toLocaleDateString()})</span>
                            </div>
                            <div style="font-size:13px; line-height:1.6; color:var(--text-primary); font-weight:500;">${latestReport.analysis}</div>
                        `;
                    }
                }

                // Mission Log Display
                const notesModule = section.querySelector(`#notes-module-${activeGrow.id}`);
                if (notesModule) {
                    const notes = activeGrow.notes || "Keine Notizen vorhanden. Nutze den 'NOTIZ' Button für Einträge.";
                    notesModule.style.cssText = "background: rgba(255, 255, 255, 0.03); border: 1px solid var(--glass-border); border-radius: 12px; padding: 16px; margin-top: 20px; position:relative;";
                    notesModule.innerHTML = `
                        <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:900; letter-spacing:1px; margin-bottom:10px; display:flex; align-items:center; gap:8px;">
                            <span style="color:var(--primary-color);">📓</span> MISSION LOG / NOTIZEN
                        </div>
                        <div style="font-size:13px; line-height:1.6; color:var(--text-primary); font-weight:500; font-family:'JetBrains Mono', monospace; white-space: pre-wrap;">${notes}</div>
                    `;
                }
                
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
                const events = (g.events || []).map(e => `🔹 ${e.type}`).join(', ');
                
                const startDt = new Date(g.start_date);
                const endDt = new Date(g.end_date || g.start_date);
                const durationDays = Math.max(1, Math.ceil((endDt - startDt) / (1000 * 60 * 60 * 24)));

                let yieldHtml = '';
                if (g.yield_grams && parseFloat(g.total_cost) > 0) {
                    const costPerGram = (parseFloat(g.total_cost) / parseFloat(g.yield_grams)).toFixed(2);
                    yieldHtml = `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.1); font-size:11px; color:#c084fc; line-height: 1.4;">⚖️ Ertrag: ${g.yield_grams}g<br/><span style="color:#a855f7;">(${costPerGram} €/g)</span></div>`;
                } else if (g.yield_grams) {
                    yieldHtml = `<div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.1); font-size:11px; color:#c084fc;">⚖️ Ertrag: ${g.yield_grams}g</div>`;
                }

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
                            ${yieldHtml}
                        </td>
                        <td style="padding:12px; text-align:right;">
                            ${g.photos && g.photos.length > 0 ? `<button class="btn" style="width:auto; padding:4px 10px; font-size:10px; display:inline-flex; margin-right:8px;" onclick='this.parentElement.parentElement.parentElement.querySelector(".row-gallery-${g.id}").style.display="table-row"; this.style.display="none";'>🖼️ ${g.photos.length}</button>` : ''}
                            <button class="btn" style="padding:4px 8px; font-size:10px;" id="del-grow-${g.id}">LÖSCHEN</button>
                            <button class="btn" style="padding:4px 8px; font-size:10px; margin-left:4px;" id="edit-hist-${g.id}">NOTE</button>
                        </td>
                    </tr>
                    <tr class="row-gallery-${g.id}" style="display:none; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.3);">
                        <td colspan="5" style="padding: 16px;">
                            ${g.ai_reports && g.ai_reports.length > 0 ? `
                                <div style="background: rgba(168, 85, 247, 0.05); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                                    <div style="font-weight:700; font-size:11px; color:#a855f7; margin-bottom:6px;">🧠 Letzter KI-Bericht</div>
                                    <div style="font-size:12px; opacity:0.8;">${g.ai_reports[g.ai_reports.length-1].analysis}</div>
                                </div>
                            ` : ''}
                            <div id="hist-gallery-${g.id}"></div>
                        </td>
                    </tr>
                `;
            });

            historyTable.innerHTML = `
                <div class="scroll-wrapper">
                <table class="history-table" style="width:100%; border-collapse:collapse; font-size:13px;">
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
                </div>
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
        const types = ["Topping", "Dünger", "Wasser", "LST", "Entlaubung", "Umgetopft", "Sonstiges"];
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

    async _configureTank(device) {
        const isEnabled = device.tankData?.enabled || false;
        const hasSensor = device.options.tank_level_sensor;
        
        let msg = "Virtueller Wassertank Konfiguration\n\n";
        
        if (hasSensor) {
            msg += "⚠️ HINWEIS: Ein physikalischer Sensor ist konfiguriert.\n";
            msg += "Manuelle Einstellungen werden ignoriert, da der Sensor Vorrang hat.\n\n";
        }
        
        msg += "Möchtest du den Wassertank-Track " + (isEnabled ? "deaktivieren (0)" : "aktivieren (1)") + "?\n";
        msg += "Tippe 1 für Aktivieren, 0 für Deaktivieren.";
        const enableStr = prompt(msg, isEnabled ? "1" : "0");
        if (enableStr === null) return;
        
        const enable = enableStr.trim() === "1";
        let updates = { enabled: enable };
        
        if (enable) {
            const capL = (device.tankData?.capacity_ml || 10000) / 1000;
            const capStr = prompt("Gesamt-Fassungsvermögen in Liter:", capL);
            if (capStr !== null && !isNaN(parseFloat(capStr))) {
                updates.capacity_ml = parseFloat(capStr) * 1000;
                // Autofill tank when configuring bounds
                updates.current_ml = updates.capacity_ml; 
            }
            
            const flow = device.tankData?.flow_ml_s || 20;
            const flowStr = prompt("Durchflussgeschwindigkeit deiner Pumpe (ml pro Sekunde):\n(Beispiel: Kleine Bewässerungspumpen schaffen ca. 20-30 ml/s)", flow);
            if (flowStr !== null && !isNaN(parseFloat(flowStr))) {
                updates.flow_ml_s = parseFloat(flowStr);
            }
        }
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/update_tank',
                entry_id: device.entryId,
                updates: updates
            });
            await this._fetchDevices();
        } catch (e) {
            alert("Fehler beim Speichern der Tank-Config: " + e.message);
        }
    }

    async _refillTank(device) {
        if (!confirm("Bist du sicher, dass du den Wassertank physisch komplett randvoll gefüllt hast?")) return;
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/update_tank',
                entry_id: device.entryId,
                updates: { current_ml: device.tankData.capacity_ml }
            });
            await this._fetchDevices();
        } catch (e) {
            alert("Fehler beim Refill: " + e.message);
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
        
        let yieldStr = prompt("Optional: Ernte in Gramm eintragen (Trockengewicht):\n(Lass es leer oder auf 0, falls noch nicht getrocknet)", "0");
        let yieldGrams = parseFloat(yieldStr);
        if (isNaN(yieldGrams) || yieldGrams <= 0) yieldGrams = null;

        let payload = {
            type: 'local_grow_box/stop_grow',
            entry_id: entryId,
            grow_id: growId
        };
        
        if (yieldGrams !== null) {
            payload.yield_grams = yieldGrams;
        }

        try {
            await this._hass.callWS(payload);
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
        const notes = prompt("Notizen / Fazit:", grow.notes || "");
        if (notes === null) return;
        
        let updates = { notes: notes };
        
        if (grow.status === 'finished') {
            let yieldStr = prompt("Ernte in Gramm (Trockengewicht) für Effizienz-Berechnung:", grow.yield_grams || "0");
            if (yieldStr !== null) {
                let yieldGrams = parseFloat(yieldStr);
                if (!isNaN(yieldGrams) && yieldGrams > 0) updates.yield_grams = yieldGrams;
                else updates.yield_grams = null; // Can optionally clear it
            }
        }
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/update_grow',
                entry_id: entryId,
                grow_id: grow.id,
                updates: updates
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
                    seedling: { target_temp: 24, target_humidity: 75, vpd_range: [0.4, 0.8], light_hours: 18, target_moisture: 70 },
                    vegetative: { target_temp: 26, target_humidity: 60, vpd_range: [0.8, 1.2], light_hours: 18, target_moisture: 60 },
                    flowering: { target_temp: 25, target_humidity: 45, vpd_range: [1.2, 1.6], light_hours: 18, target_moisture: 45 }
                }
            },
            {
                name: "🌿 Photoperiodisch (Classic)",
                desc: "Der Klassiker: 18/6 in der Vegi, automatischer Switch auf 12/12 in der Blüte inkl. VPD-Anpassung.",
                phases: {
                    seedling: { target_temp: 23, target_humidity: 70, vpd_range: [0.4, 0.8], light_hours: 18, target_moisture: 70 },
                    vegetative: { target_temp: 26, target_humidity: 60, vpd_range: [0.8, 1.2], light_hours: 18, target_moisture: 60 },
                    flowering: { target_temp: 24, target_humidity: 45, vpd_range: [1.2, 1.6], light_hours: 12, target_moisture: 45 }
                }
            },
            {
                name: "❄️ Eco-Growing (Niedrig-Temp)",
                desc: "Energiesparend bei kühleren Temperaturen. Reduzierte Zielwerte für Winter-Grows.",
                phases: {
                    seedling: { target_temp: 21, target_humidity: 65, vpd_range: [0.4, 1.0], light_hours: 18, target_moisture: 65 },
                    vegetative: { target_temp: 22, target_humidity: 55, vpd_range: [0.8, 1.2], light_hours: 18, target_moisture: 55 },
                    flowering: { target_temp: 21, target_humidity: 50, vpd_range: [1.2, 1.8], light_hours: 12, target_moisture: 50 }
                }
            }
        ];

        const recipesDiv = document.createElement('div');
        recipesDiv.style.maxWidth = '1000px';
        recipesDiv.style.margin = '0 auto';

        recipesDiv.innerHTML = `
            <div style="background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 20px; padding: 40px; margin-bottom: 40px; text-align: center; position: relative; overflow: hidden; backdrop-filter: blur(20px);">
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--primary-color), transparent); opacity: 0.5;"></div>
                <h2 style="margin: 0 0 12px 0; color: var(--primary-color); font-weight: 900; text-transform: uppercase; letter-spacing: 2px;">🚀 Grow Engine Profile</h2>
                <p style="color: var(--text-secondary); margin: 0; font-size: 14px; font-weight: 500;">Wähle ein vorkonfiguriertes biologisches Profil oder importiere Community-Einstellungen.</p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; margin-bottom: 48px;">
                ${buildInRecipes.map((r, idx) => `
                    <div class="card" style="display: flex; flex-direction: column; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 24px; overflow: hidden; transition: transform 0.3s ease, border-color 0.3s ease;">
                        <div style="padding: 24px; flex: 1;">
                            <h3 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 900; color: #fff; letter-spacing: -0.5px;">${r.name}</h3>
                            <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 24px; min-height: 60px;">${r.desc}</p>
                            
                            <div style="background: rgba(0, 242, 255, 0.03); border: 1px solid rgba(0, 242, 255, 0.1); border-radius: 16px; padding: 16px; font-size: 11px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 12px; opacity: 0.5; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid rgba(0, 242, 255, 0.1); padding-bottom: 8px;">
                                    <span>Lifecycle</span>
                                    <span>Parameters</span>
                                </div>
                                ${Object.keys(r.phases).map(p => `
                                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.03);">
                                        <span style="text-transform: uppercase; font-weight: 800; color: var(--primary-color); font-size: 10px; letter-spacing: 0.5px;">${p}</span>
                                        <span style="font-weight: 700; color: #fff;">${r.phases[p].light_hours}h | ${r.phases[p].target_temp}°C | ${r.phases[p].target_humidity}%</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div style="padding: 24px; border-top: 1px solid var(--glass-border); background: rgba(0,0,0,0.1); display: flex; flex-direction: column; gap: 12px;">
                            <select id="recipe-box-${idx}" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #fff; padding: 10px; border-radius: 12px; font-weight: 700; font-size: 13px;">
                                ${this._devices.map(d => `<option value="${d.entryId}">${d.name}</option>`).join('')}
                            </select>
                            <button type="button" class="btn active" style="width: 100%; height: 44px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px;" id="apply-recipe-${idx}">PROFIL AKTIVIEREN</button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="settings-section" style="background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 24px; padding: 32px; backdrop-filter: blur(10px);">
                <div class="section-title" style="border-bottom: 1px solid var(--glass-border); padding-bottom: 16px; margin-bottom: 32px; color: var(--accent-color); font-weight: 900; letter-spacing: 1px;">🌍 Community Hub & Import</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr)); gap: 40px;">
                    <div>
                        <h4 style="margin: 0 0 16px 0; font-weight: 800; text-transform: uppercase; color: #fff; font-size: 14px; display: flex; align-items: center; gap: 10px;">
                            <span style="color: var(--primary-color);">01</span> Profil Import
                        </h4>
                        <div style="background: rgba(0, 242, 255, 0.02); border: 1px dashed rgba(0, 242, 255, 0.3); border-radius: 16px; padding: 32px; margin-bottom: 16px; text-align: center;">
                            <input type="file" id="recipe-file-input" accept=".json,.growbox" style="display: none;">
                            <button type="button" class="btn" id="btn-upload-recipe" style="width: 100%; max-width: 400px; padding: 10px 24px; font-weight: 800;">REZEPT-DATEI WÄHLEN (.growbox)</button>
                            <div id="file-name-display" style="font-size: 11px; margin-top: 12px; color: var(--text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">KEIN ASSET GELADEN</div>
                        </div>
                        <p style="font-size: 10px; color: var(--text-secondary); margin-bottom: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6;">Direct Matrix Input (JSON):</p>
                        <textarea id="import-area" style="width: 100%; height: 100px; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: var(--accent-color); border-radius: 12px; padding: 16px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 11px; resize: none; margin-bottom: 16px;" placeholder='{"name": "Neural_Grow_v1", "phases": ...}'></textarea>
                        <div style="display: flex; gap: 16px;">
                            <select id="import-box" style="flex: 1; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #fff; padding: 10px; border-radius: 12px; font-weight: 700;">
                                ${this._devices.map(d => `<option value="${d.entryId}">${d.name}</option>`).join('')}
                            </select>
                            <button type="button" class="btn active" id="btn-import-recipe" style="width: auto; padding: 0 24px; font-weight: 900;">INJECT</button>
                        </div>
                    </div>
                    <div class="community-export-section" style="border-left: 1.5px solid var(--glass-border); padding-left: 40px;">
                        <h4 style="margin: 0 0 16px 0; font-weight: 800; text-transform: uppercase; color: #fff; font-size: 14px; display: flex; align-items: center; gap: 10px;">
                            <span style="color: var(--accent-color);">02</span> Export & Teilen
                        </h4>
                        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">Generiere eine tragbare Konfiguration aus deinem aktuellen Setup.</p>
                        <select id="export-box" style="width: 100%; margin-bottom: 16px; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #fff; padding: 10px; border-radius: 12px; font-weight: 700;">
                            ${this._devices.map(d => `<option value="${d.entryId}">${d.name}</option>`).join('')}
                        </select>
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            <button type="button" class="btn active" id="btn-download-recipe" style="width: 100%; font-weight: 900;">DATEI SPEICHERN (.growbox)</button>
                            <button type="button" class="btn" id="btn-export-recipe" style="width: 100%; border: 1px solid var(--glass-border); background: transparent; font-weight: 800;">CODE KOPIEREN</button>
                        </div>
                        <div id="export-result" style="display: none; margin-top: 24px; animation: slideUp 0.3s ease;">
                            <p style="font-size: 11px; margin-bottom: 8px; color: var(--accent-color); font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Ready! Copy operational matrix:</p>
                            <div style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 12px; font-size: 10px; font-family: monospace; word-break: break-all; color: var(--text-primary); border: 1px solid rgba(0, 255, 65, 0.2); max-height: 150px; overflow-y: auto;" id="export-code"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="margin-top: 40px; padding: 24px; background: rgba(0, 242, 255, 0.05); border-left: 4px solid var(--primary-color); border-radius: 16px; backdrop-filter: blur(5px);">
                <h4 style="margin: 0 0 12px 0; color: var(--primary-color); font-weight: 900; text-transform: uppercase; letter-spacing: 1px;">SYSTEM-KERN: BETRIEBSMODI</h4>
                <p style="margin: 0 0 12px 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); font-weight: 500;">
                    Engine-Profile sind biologische Anweisungssätze für deine Grow-Umgebung. Sie definieren die optimalen Zielwerte für jede Lebensphase. 
                    Das Aktivieren eines Profils synchronisiert sofort alle Sensoren mit diesen Parametern.
                </p>
                <div style="display: flex; gap: 20px; font-size: 11px; font-weight: 800; color: var(--primary-color); text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;">
                    <span>🛡️ BIOS-SYNC</span>
                    <span>🌡️ VPD-KALIBRIERUNG</span>
                    <span>⏰ LICHT-AUTOMATIK</span>
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
        const fileInput = recipesDiv.querySelector('#recipe-file-input');
        const fileNameDisplay = recipesDiv.querySelector('#file-name-display');
        let uploadedRecipe = null;

        recipesDiv.querySelector('#btn-upload-recipe').onclick = () => fileInput.click();
        
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            fileNameDisplay.innerText = `📂 ${file.name}`;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    uploadedRecipe = JSON.parse(event.target.result);
                    // Autofill name if possible
                    if (uploadedRecipe.name) fileNameDisplay.innerText = `📄 ${file.name} (Rezept: ${uploadedRecipe.name})`;
                } catch (err) {
                    alert("Konnte Datei nicht lesen. Ungültiges JSON-Format.");
                    fileInput.value = "";
                    fileNameDisplay.innerText = "Fehler beim Laden";
                }
            };
            reader.readAsText(file);
        };

        recipesDiv.querySelector('#btn-import-recipe').onclick = () => {
            const code = recipesDiv.querySelector('#import-area').value.trim();
            const entryId = recipesDiv.querySelector('#import-box').value;
            
            if (uploadedRecipe) {
                this._applyRecipe(entryId, uploadedRecipe);
                return;
            }

            if (!code) {
                alert("Bitte wähle eine Datei aus oder füge einen Code ein.");
                return;
            }

            try {
                const recipe = JSON.parse(code);
                this._applyRecipe(entryId, recipe);
            } catch (e) {
                alert("Ungültiger Rezept-Code! Bitte prüfe das JSON-Format.");
            }
        };

        // Helper to generate current recipe object
        const getCurrentRecipe = (entryId) => {
            const device = this._devices.find(d => d.entryId === entryId);
            if (!device) return null;
            return {
                name: `Rezept_${device.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`,
                phases: {
                    seedling: { 
                        target_temp: parseFloat(device.options.target_temp || 24), 
                        target_humidity: parseFloat(device.options.target_humidity || 70),
                        light_hours: parseFloat(device.options.phase_seedling_hours || 18),
                        target_moisture: parseFloat(device.options.target_moisture || 70)
                    },
                    vegetative: { 
                        target_temp: parseFloat(device.options.target_temp || 26), 
                        target_humidity: parseFloat(device.options.target_humidity || 60),
                        light_hours: parseFloat(device.options.phase_vegetative_hours || 18),
                        target_moisture: parseFloat(device.options.target_moisture || 60)
                    },
                    flowering: { 
                        target_temp: parseFloat(device.options.target_temp || 25), 
                        target_humidity: parseFloat(device.options.target_humidity || 45),
                        light_hours: parseFloat(device.options.phase_flowering_hours || 12),
                        target_moisture: parseFloat(device.options.target_moisture || 45)
                    }
                }
            };
        };

        // Listeners for export
        recipesDiv.querySelector('#btn-download-recipe').onclick = () => {
            const entryId = recipesDiv.querySelector('#export-box').value;
            const recipe = getCurrentRecipe(entryId);
            if (!recipe) return;

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(recipe, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", recipe.name + ".growbox");
            document.body.appendChild(downloadAnchorNode); 
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        };

        recipesDiv.querySelector('#btn-export-recipe').onclick = () => {
            const entryId = recipesDiv.querySelector('#export-box').value;
            const recipe = getCurrentRecipe(entryId);
            if (!recipe) return;
            
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
            toast.innerText = `🚀 Rezept "${recipe.name}" aktiviert!`;
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
            container.innerHTML = '<div style="font-size:11px; color:var(--text-secondary); opacity:0.6; padding: 20px; text-align: center; border: 1px dashed var(--glass-border); border-radius: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Initialer Asset-Scan: Keine Bilder gefunden</div>';
            return;
        }

        const photosStr = JSON.stringify(grow.photos).replace(/'/g, "\\'");

        container.innerHTML = `
            <div style="margin-bottom:16px; display: flex; justify-content: space-between; align-items:center; flex-wrap: wrap; gap: 10px;">
                <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:950; letter-spacing:1px; display: flex; align-items: center; gap: 8px;">
                    <span style="color:var(--primary-color);">●</span> ASSET-ZEITSTRAHL
                </div>
                <button class="btn" style="padding:6px 14px; font-size:10px; width:auto; border-radius:10px; background: rgba(0, 242, 255, 0.05); border: 1px solid var(--primary-color); display: flex; align-items: center; gap: 6px;" onclick='this.getRootNode().host._playTimelapse("${grow.id}", ${photosStr})'>
                    🎬 ZEITRAFFER
                </button>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap:12px; max-height: 200px; overflow-y:auto; padding: 4px; scrollbar-width: thin;">
                ${grow.photos.map(photo => `
                    <div class="photo-thumb" style="aspect-ratio: 4/3; border-radius:12px; overflow:hidden; border:1.5px solid var(--glass-border); cursor:pointer; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position:relative; box-shadow: 0 4px 6px rgba(0,0,0,0.2);" 
                         onclick='if(event.target.tagName !== "BUTTON") { const modal=this.getRootNode().host.shadowRoot.getElementById("camera-modal"); 
                                 modal.querySelector("img").src="/local/local_grow_box_images/grows/${grow.id}/${photo}"; 
                                 modal.querySelector("#modal-title").innerText="${photo}";
                                 modal.classList.add("visible"); }'>
                        <img src="/local/local_grow_box_images/grows/${grow.id}/${photo}" style="width:100%; height:100%; object-fit:cover; transition: transform 0.3s ease;">
                        <button style="position:absolute; bottom:6px; right:6px; background:rgba(168, 85, 247, 0.9); border:none; border-radius:8px; color:white; font-size:12px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor:pointer; box-shadow: 0 0 10px rgba(168, 85, 247, 0.4); border: 1px solid rgba(255,255,255,0.2);" 
                                title="Starte KI-Gesundheitsbericht"
                                onclick='event.stopPropagation(); this.getRootNode().host._runAICheck("${device.entryId}", "${grow.id}", "${photo}")'>🧠</button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _playTimelapse(growId, photos) {
        if (!photos || photos.length < 2) {
            alert("Es werden mindestens 2 Fotos für einen Zeitraffer benötigt!");
            return;
        }
        
        const modal = this.shadowRoot.getElementById("camera-modal");
        const img = modal.querySelector("img");
        const title = modal.querySelector("#modal-title");
        modal.classList.add("visible");
        
        let index = 0;
        let isPlaying = true;
        
        // Cleanup function for when modal is closed
        const origCleanup = modal.querySelector('.close-modal').onclick;
        const newCleanup = () => {
            isPlaying = false;
            if (origCleanup) origCleanup();
            modal.querySelector('.close-modal').onclick = origCleanup;
        };
        modal.querySelector('.close-modal').onclick = newCleanup;

        const playNext = () => {
             if (!isPlaying || !modal.classList.contains('visible')) return; 
             
             // Preload next image to avoid flickering
             const nextImg = new Image();
             nextImg.onload = () => {
                 if (!isPlaying) return;
                 img.src = nextImg.src;
                 title.innerHTML = `🎬 Zeitraffer (Tag ${index+1}/${photos.length}) <br/> <span style="font-size:12px;opacity:0.7;">${photos[index]}</span>`;
                 index++;
                 if (index < photos.length) {
                     setTimeout(playNext, 400); // 400ms delay per frame
                 } else {
                     title.innerText = `✅ Zeitraffer beendet - ${photos.length} Fotos abgespielt.`;
                 }
             };
             nextImg.src = `/local/local_grow_box_images/grows/${growId}/${photos[index]}`;
        };
        
        title.innerText = "Lade Zeitraffer...";
        playNext();
    }

    async _runAICheck(entryId, growId, photo) {
        if (!confirm("Möchtest du eine KI-Analyse für dieses Foto starten? (Verursacht API-Kosten bei OpenAI/Gemini)")) return;
        
        const toast = this.shadowRoot.getElementById('save-toast');
        toast.innerText = "🧠 KI-Analyse läuft... Bitte warten (kann 10-30s dauern).";
        toast.classList.add('visible');
        
        try {
            await this._hass.callWS({
                type: 'local_grow_box/run_ai_check',
                entry_id: entryId,
                grow_id: growId,
                photo: photo
            });
            
            toast.innerText = "✅ KI-Analyse erfolgreich!";
            setTimeout(() => toast.classList.remove('visible'), 4000);
            
            // Refresh instantly, because the backend awaited the API call
            await this._fetchGrows();
        } catch (e) {
            console.error("AI check error", e);
            toast.classList.remove('visible');
            alert("KI-Check fehlgeschlagen: " + e.message);
        }
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

