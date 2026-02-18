class FlowOpenKairo extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    setConfig(config) {
        if (!config.solar && !config.battery && !config.grid) {
            throw new Error('Please define at least one entity (solar, battery, grid)');
        }
        this.config = config;
    }

    set hass(hass) {
        // Debounce simple updates or just render
        // For performance, we only re-render if values changed significantly
        // But for simplicity of this "Vanilla" version, we render on update.
        this._hass = hass;
        this.render();
    }

    getVal(entityId) {
        if (!entityId || !this._hass.states[entityId]) return 0;
        const val = parseFloat(this._hass.states[entityId].state);
        return isNaN(val) ? 0 : val;
    }

    render() {
        if (!this.config || !this._hass) return;

        const solar = this.getVal(this.config.solar);
        const battery = this.getVal(this.config.battery); // +/- logic handled visually
        const grid = this.getVal(this.config.grid);       // +/- logic handled visually
        const home = this.getVal(this.config.home);

        // Colors
        const cSolar = this.config.color_solar || '#ffb74d';
        const cBat = this.config.color_battery || '#00e676'; // heavy neon green
        const cGrid = this.config.color_grid || '#29b6f6';   // neon blue
        const cHome = this.config.color_home || '#d500f9';   // neon purple

        // Logic
        const isSolar = solar > 5;
        const isBatCharge = battery > 5;
        const isBatDischarge = battery < -5;
        const isGridImport = grid > 5;
        const isGridExport = grid < -5;
        const isHome = home > 5;

        // Abs values for display and speed
        const vBat = Math.abs(battery);
        const vGrid = Math.abs(grid);

        // --- HTML Structure ---
        // We reuse the Shadow DOM to avoid flickering.
        // A simple brute-force innerHTML is okay for 1Hz updates, 
        // but updating just attributes is better. 
        // To keep this file small and readable, we do full render but check existence first? 
        // No, full render is fine for V1.

        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; }
                .card {
                    background: rgba(16, 16, 18, 0.95);
                    border-radius: 16px;
                    padding: 16px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    color: white;
                    font-family: sans-serif;
                    position: relative;
                    height: 320px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    border: 1px solid #333;
                }
                .canvas {
                    position: absolute;
                    top: 0; left: 0; width: 100%; height: 100%;
                    pointer-events: none;
                    z-index: 1;
                }
                .node {
                    position: absolute;
                    width: 80px;
                    text-align: center;
                    z-index: 2;
                    transition: transform 0.2s;
                }
                .icon-box {
                    width: 50px; height: 50px;
                    margin: 0 auto;
                    border-radius: 50%;
                    border: 2px solid #555;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #222;
                    font-size: 24px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.3);
                }
                .node[active="true"] .icon-box {
                    box-shadow: 0 0 20px var(--glow-color);
                    border-color: var(--glow-color);
                    color: white;
                }
                .text { margin-top: 5px; }
                .val { font-weight: bold; font-size: 14px; }
                .lbl { font-size: 10px; opacity: 0.7; text-transform: uppercase; }

                /* Positions */
                .pos-solar { top: 20px; left: 50%; transform: translateX(-50%); }
                .pos-bat   { top: 50%; left: 20px; transform: translateY(-50%); }
                .pos-grid  { top: 50%; right: 20px; transform: translateY(-50%); }
                .pos-home  { bottom: 20px; left: 50%; transform: translateX(-50%); }
            </style>

            <div class="card">
                <!-- SVG Canvas for flows -->
                <svg class="canvas" viewBox="0 0 300 300">
                    <defs>
                        <marker id="dot-s" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
                            <circle cx="5" cy="5" r="5" fill="${cSolar}" />
                        </marker>
                        <marker id="dot-b" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
                            <circle cx="5" cy="5" r="5" fill="${cBat}" />
                        </marker>
                        <marker id="dot-g" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
                            <circle cx="5" cy="5" r="5" fill="${cGrid}" />
                        </marker>
                    </defs>

                    <!-- Flows -->
                    ${isSolar ? this.makeFlow(150, 60, 150, 240, solar, cSolar) : ''}          <!-- Solar->Home -->
                    ${isBatCharge ? this.makeFlow(150, 60, 40, 150, solar, cSolar) : ''}       <!-- Solar->Bat -->
                    ${isBatDischarge ? this.makeFlow(40, 150, 150, 240, vBat, cBat) : ''}      <!-- Bat->Home -->
                    ${isGridImport ? this.makeFlow(260, 150, 150, 240, vGrid, cGrid) : ''}     <!-- Grid->Home -->
                    ${isGridExport && isSolar ? this.makeFlow(150, 60, 260, 150, vGrid, cSolar) : ''} <!-- Solar->Export -->
                </svg>

                <!-- Nodes -->
                ${this.makeNode('solar', solar, '☀️', 'Solar', 'pos-solar', cSolar, isSolar)}
                ${this.makeNode('bat', vBat, '🔋', 'Bat ' + (isBatCharge ? '+' : (isBatDischarge ? '-' : '')), 'pos-bat', cBat, isBatCharge || isBatDischarge)}
                ${this.makeNode('grid', vGrid, '⚡', 'Grid', 'pos-grid', cGrid, isGridImport || isGridExport)}
                ${this.makeNode('home', home, '🏠', 'Home', 'pos-home', cHome, isHome)}
            </div>
        `;
    }

    makeNode(id, val, icon, label, posClass, color, active) {
        return `
        <div class="node ${posClass}" active="${active}" style="--glow-color: ${color}">
            <div class="icon-box" style="color: ${color}">${icon}</div>
            <div class="text">
                <div class="val">${Math.round(val)} W</div>
                <div class="lbl">${label}</div>
            </div>
        </div>
        `;
    }

    makeFlow(x1, y1, x2, y2, watts, color) {
        // Simple straight line flow
        // Animation speed calculation: 
        // 5000W = 0.5s, 0W = 10s?
        if (watts < 1) return '';
        const dur = Math.max(0.5, 3 - (watts / 2000));

        return `
            <path d="M${x1},${y1} L${x2},${y2}" stroke="${color}" stroke-opacity="0.2" stroke-width="2" fill="none" />
            <circle r="4" fill="${color}">
                <animateMotion dur="${dur}s" repeatCount="indefinite" path="M${x1},${y1} L${x2},${y2}" />
            </circle>
        `;
    }

    getCardSize() {
        return 4;
    }
}

customElements.define('flow-openkairo', FlowOpenKairo);
