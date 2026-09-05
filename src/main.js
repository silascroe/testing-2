const canvas = document.querySelector("#world-canvas");
const ctx = canvas.getContext("2d");

const COLS = 30;
const ROWS = 20;
const TILE_SIZE = canvas.width / COLS;
const SAVE_KEY = "emberline-save-v1";

const TERRAIN = {
  plains: { label: "Plains", color: "#9a936d", accent: "#c7bd8b", movement: 1 },
  forest: { label: "Forest", color: "#466952", accent: "#86a567", movement: 2 },
  mountain: { label: "Mountain", color: "#64626b", accent: "#a9a4ad", movement: 3 },
  desert: { label: "Salt flats", color: "#a88465", accent: "#d4b28c", movement: 2 },
  water: { label: "Blackwater", color: "#345b6d", accent: "#70a8c8", movement: 99 },
};

const BUILDINGS = {
  farm: {
    label: "Hydroponics",
    short: "FARM",
    description: "Turns stable ground into food production.",
    cost: { iron: 8, energy: 2 },
    allowed: ["plains", "forest", "desert"],
    production: { food: 2 },
  },
  mine: {
    label: "Iron mine",
    short: "MINE",
    description: "Extracts iron from hard terrain.",
    cost: { iron: 12, energy: 4 },
    allowed: ["mountain", "desert"],
    production: { iron: 2 },
  },
  extractor: {
    label: "Crystal well",
    short: "WELL",
    description: "Harvests crystal and a trickle of power.",
    cost: { iron: 10, energy: 4 },
    allowed: ["plains", "forest", "mountain", "desert"],
    production: { crystal: 1, energy: 1 },
  },
  housing: {
    label: "Hab block",
    short: "HAB",
    description: "Raises the settlement population ceiling.",
    cost: { iron: 10, energy: 5 },
    allowed: ["plains", "forest", "desert"],
    maxPop: 4,
  },
  wall: {
    label: "Bastion wall",
    short: "WALL",
    description: "Slows raids and buys the core another breath.",
    cost: { iron: 6, energy: 1 },
    allowed: ["plains", "forest", "mountain", "desert"],
    defense: 1,
  },
  turret: {
    label: "Sentinel turret",
    short: "TURRET",
    description: "Targets nearby raiders automatically.",
    cost: { iron: 14, energy: 6 },
    allowed: ["plains", "forest", "mountain", "desert"],
    defense: 2,
  },
};

const RESOURCE_LABELS = {
  food: "Food",
  iron: "Iron",
  crystal: "Crystal",
  energy: "Energy",
};

let state;
let lastFrame = performance.now();
let tickAccumulator = 0;

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeed() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function key(x, y) { return `${x}:${y}`; }

function getTile(x, y) {
  if (!state || x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
  return state.tiles[y * COLS + x];
}

function randomOpenTile(random, options = {}) {
  const candidates = state.tiles.filter((tile) => {
    if (tile.building || tile.terrain === "water") return false;
    if (options.edge && tile.x > 6 && tile.x < COLS - 7 && tile.y > 5 && tile.y < ROWS - 6) return false;
    if (options.near && distance(tile, options.near) < options.minDistance) return false;
    return true;
  });
  return candidates[Math.floor(random() * candidates.length)] || state.tiles[0];
}

function generateWorld(seed) {
  const random = mulberry32(hashString(seed));
  const base = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
  const tiles = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const centerDistance = Math.hypot(x - base.x, y - base.y);
      const wave = (Math.sin(x * 0.63 + hashString(seed) * 0.00001) + Math.cos(y * 0.41)) * 0.13;
      const noise = random() + wave - centerDistance * 0.004;
      let terrain = "plains";
      if (noise < 0.13) terrain = "water";
      else if (noise > 0.87) terrain = "mountain";
      else if (noise > 0.68) terrain = "desert";
      else if (noise < 0.38) terrain = "forest";

      if (Math.abs(x - base.x) <= 2 && Math.abs(y - base.y) <= 2) terrain = "plains";

      const resourceRoll = random();
      const resource = terrain === "mountain" && resourceRoll > 0.34
        ? "iron"
        : resourceRoll > 0.91 && terrain !== "water"
          ? "crystal"
          : null;

      tiles.push({
        x,
        y,
        terrain,
        resource,
        building: null,
        variant: Math.floor(random() * 4),
      });
    }
  }

  const home = tiles.find((tile) => tile.x === base.x && tile.y === base.y);
  home.building = "hub";

  state = {
    version: 1,
    seed,
    tiles,
    tick: 0,
    speed: 1,
    selected: { x: base.x, y: base.y },
    hover: null,
    buildMode: null,
    resources: { food: 110, iron: 30, crystal: 4, energy: 24 },
    population: { current: 8, max: 10, morale: 72 },
    coreIntegrity: 100,
    raiders: [],
    factions: [],
    log: [],
    gameOver: false,
    lastProduction: { food: 0, iron: 0, crystal: 0, energy: 0 },
  };

  const factionNames = ["Sable Choir", "The Unmoored", "Red Meridian"];
  factionNames.forEach((name, index) => {
    const camp = randomOpenTile(random, { edge: true, near: base, minDistance: 14 });
    state.factions.push({
      id: index + 1,
      name,
      x: camp.x,
      y: camp.y,
      power: 2 + Math.floor(random() * 3),
      color: ["#d36a61", "#bf8b58", "#b75f82"][index],
    });
  });

  addLog("New basin acquired. Core systems waking.", "system");
  addLog("Build food first. Hunger makes poor diplomats.", "advice");
  return state;
}

function addLog(message, type = "info") {
  state.log.unshift({ message, type, tick: state.tick });
  state.log = state.log.slice(0, 12);
}

function formatNumber(value) { return String(Math.max(0, Math.floor(value))).padStart(3, "0"); }

function formatCost(cost) {
  return Object.entries(cost).map(([resource, amount]) => `${amount} ${resource.slice(0, 3).toUpperCase()}`).join("  ");
}

function hasCost(cost) {
  return Object.entries(cost).every(([resource, amount]) => state.resources[resource] >= amount);
}

function spend(cost) {
  Object.entries(cost).forEach(([resource, amount]) => { state.resources[resource] -= amount; });
}

function getProduction() {
  const production = { food: 0, iron: 0, crystal: 0, energy: 0 };
  state.tiles.forEach((tile) => {
    const building = BUILDINGS[tile.building];
    if (!building?.production) return;
    Object.entries(building.production).forEach(([resource, amount]) => { production[resource] += amount; });
  });
  production.food -= Math.max(1, Math.ceil(state.population.current / 4));
  production.energy -= Math.max(1, Math.ceil(state.population.current / 5));
  return production;
}

function getDefense() {
  return state.tiles.reduce((total, tile) => total + (BUILDINGS[tile.building]?.defense || 0), 0);
}

function canBuild(buildingKey, tile) {
  const building = BUILDINGS[buildingKey];
  if (!building || !tile || tile.building || tile.terrain === "water") return false;
  if (!building.allowed.includes(tile.terrain)) return false;
  if (buildingKey === "extractor" && tile.resource !== "crystal") return false;
  if (buildingKey === "mine" && tile.resource !== "iron" && tile.terrain !== "mountain") return false;
  return hasCost(building.cost);
}

function attemptBuild(buildingKey) {
  const tile = getTile(state.selected.x, state.selected.y);
  const building = BUILDINGS[buildingKey];
  if (!building || !tile) return;
  if (tile.building) {
    addLog("That tile is already occupied.", "warning");
  } else if (tile.terrain === "water") {
    addLog("The basin rejects construction on blackwater.", "warning");
  } else if (!building.allowed.includes(tile.terrain)) {
    addLog(`${building.label} cannot anchor on ${TERRAIN[tile.terrain].label.toLowerCase()}.`, "warning");
  } else if (buildingKey === "extractor" && tile.resource !== "crystal") {
    addLog("No crystal signal on this tile.", "warning");
  } else if (buildingKey === "mine" && tile.resource !== "iron" && tile.terrain !== "mountain") {
    addLog("No viable iron seam here.", "warning");
  } else if (!hasCost(building.cost)) {
    addLog("Construction denied: insufficient materials.", "warning");
  } else {
    spend(building.cost);
    tile.building = buildingKey;
    state.buildMode = null;
    if (building.maxPop) state.population.max += building.maxPop;
    addLog(`${building.label} anchored at ${tile.x + 1}:${tile.y + 1}.`, "build");
  }
  render();
}

function moveRaiders() {
  const hub = state.tiles.find((tile) => tile.building === "hub");
  if (!hub) return;

  state.factions.forEach((faction) => {
    if (state.tick % (9 + faction.id * 2) !== 0) return;
    const adjacent = state.raiders.find((raider) => raider.factionId === faction.id);
    if (adjacent) return;
    const spawn = getTile(faction.x, faction.y);
    if (!spawn || distance(spawn, hub) < 10) return;
    const dx = Math.sign(hub.x - faction.x);
    const dy = Math.sign(hub.y - faction.y);
    const primary = Math.abs(hub.x - faction.x) >= Math.abs(hub.y - faction.y) ? "x" : "y";
    const moves = primary === "x" ? [{ x: dx, y: 0 }, { x: 0, y: dy }] : [{ x: 0, y: dy }, { x: dx, y: 0 }];
    const move = moves.find((candidate) => {
      const next = getTile(faction.x + candidate.x, faction.y + candidate.y);
      return next && next.terrain !== "water";
    });
    if (move) {
      faction.x += move.x;
      faction.y += move.y;
      if (distance(faction, hub) <= 7) {
        state.raiders.push({ id: `${faction.id}-${state.tick}`, factionId: faction.id, x: faction.x, y: faction.y, hp: faction.power });
        addLog(`${faction.name} has sent a raiding party.`, "threat");
      }
    }
  });
}

function resolveCombat() {
  const hub = state.tiles.find((tile) => tile.building === "hub");
  const turrets = state.tiles.filter((tile) => tile.building === "turret");
  const walls = new Set(state.tiles.filter((tile) => tile.building === "wall").map((tile) => key(tile.x, tile.y)));

  turrets.forEach((turret) => {
    const target = state.raiders.find((raider) => distance(turret, raider) <= 5);
    if (target) {
      target.hp -= 1;
      if (target.hp <= 0) {
        state.raiders = state.raiders.filter((raider) => raider.id !== target.id);
        state.resources.crystal += 1;
        addLog("Sentinel turret neutralized a raider. Salvage recovered.", "combat");
      }
    }
  });

  state.raiders.forEach((raider) => {
    const target = getTile(raider.x, raider.y);
    if (!target || !hub) return;
    if (distance(raider, hub) <= 1) {
      const blocked = walls.has(key(raider.x, raider.y));
      state.coreIntegrity = Math.max(0, state.coreIntegrity - (blocked ? 1 : 3));
      state.population.morale = Math.max(0, state.population.morale - (blocked ? 1 : 4));
      addLog(blocked ? "A bastion wall absorbed a raid." : "The command core is under attack.", "threat");
      if (blocked) {
        target.building = null;
        state.raiders = state.raiders.filter((item) => item.id !== raider.id);
      }
    }
  });
}

function simulationTick() {
  if (state.gameOver || state.speed === 0) return;
  state.tick += 1;
  const production = getProduction();
  state.lastProduction = production;
  Object.entries(production).forEach(([resource, amount]) => {
    state.resources[resource] = Math.max(0, state.resources[resource] + amount);
  });

  if (state.resources.food === 0) {
    state.population.morale = Math.max(0, state.population.morale - 2);
    if (state.tick % 4 === 0 && state.population.current > 1) {
      state.population.current -= 1;
      addLog("Food stores failed. A settler has abandoned the basin.", "warning");
    }
  } else if (state.resources.food > 35 && state.population.current < state.population.max && state.tick % 12 === 0) {
    state.population.current += 1;
    state.population.morale = Math.min(100, state.population.morale + 4);
    addLog("A new settler joins the frontier line.", "growth");
  }

  if (state.tick % 20 === 0 && state.population.morale > 55) {
    state.population.morale = Math.min(100, state.population.morale + 1);
  }
  moveRaiders();
  resolveCombat();
  if (state.coreIntegrity <= 0) {
    state.gameOver = true;
    state.speed = 0;
    addLog("CORE FAILURE. The basin is lost.", "danger");
  }
}

function drawTerrain(tile) {
  const x = tile.x * TILE_SIZE;
  const y = tile.y * TILE_SIZE;
  const terrain = TERRAIN[tile.terrain];
  ctx.fillStyle = terrain.color;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = terrain.accent;
  ctx.lineWidth = 1;
  if (tile.terrain === "water") {
    for (let offset = 5; offset < TILE_SIZE; offset += 9) {
      ctx.beginPath();
      ctx.moveTo(x + 4, y + offset);
      ctx.quadraticCurveTo(x + 12, y + offset - 3, x + 22, y + offset);
      ctx.stroke();
    }
  } else if (tile.terrain === "mountain") {
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 26);
    ctx.lineTo(x + 13, y + 7);
    ctx.lineTo(x + 27, y + 26);
    ctx.stroke();
  } else if (tile.terrain === "forest") {
    for (let i = 0; i < 3; i += 1) {
      const px = x + 7 + ((tile.variant * 5 + i * 8) % 18);
      ctx.beginPath();
      ctx.moveTo(px, y + 25);
      ctx.lineTo(px + 4, y + 11);
      ctx.lineTo(px + 8, y + 25);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 3; i += 1) {
      const px = x + 6 + ((tile.variant * 7 + i * 9) % 19);
      ctx.beginPath();
      ctx.moveTo(px, y + 7 + i * 5);
      ctx.lineTo(px + 5, y + 7 + i * 5);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawResource(tile) {
  if (!tile.resource) return;
  const x = tile.x * TILE_SIZE + TILE_SIZE - 9;
  const y = tile.y * TILE_SIZE + 9;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = tile.resource === "crystal" ? "#70d4c1" : "#ed8d42";
  ctx.fill();
  ctx.strokeStyle = "rgba(8, 10, 13, 0.7)";
  ctx.stroke();
}

function drawBuilding(tile) {
  if (!tile.building) return;
  const x = tile.x * TILE_SIZE;
  const y = tile.y * TILE_SIZE;
  const centerX = x + TILE_SIZE / 2;
  const centerY = y + TILE_SIZE / 2;

  if (tile.building === "hub") {
    ctx.fillStyle = "#0c1114";
    ctx.strokeStyle = "#70d4c1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, y + 5);
    ctx.lineTo(x + 26, centerY);
    ctx.lineTo(centerX, y + 27);
    ctx.lineTo(x + 6, centerY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#70d4c1";
    ctx.fillRect(centerX - 2, centerY - 2, 4, 4);
    return;
  }

  const colors = { farm: "#9fc36b", mine: "#ed8d42", extractor: "#70d4c1", housing: "#c5a6d3", wall: "#a9a4ad", turret: "#d36a61" };
  ctx.strokeStyle = colors[tile.building];
  ctx.fillStyle = "rgba(8, 10, 13, 0.65)";
  ctx.lineWidth = 2;

  if (tile.building === "wall") {
    ctx.fillStyle = colors.wall;
    ctx.fillRect(x + 3, y + 13, TILE_SIZE - 6, 6);
    return;
  }
  if (tile.building === "turret") {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + 10, centerY - 7);
    ctx.stroke();
    return;
  }

  ctx.fillRect(x + 7, y + 7, TILE_SIZE - 14, TILE_SIZE - 14);
  ctx.strokeRect(x + 7, y + 7, TILE_SIZE - 14, TILE_SIZE - 14);
  ctx.fillStyle = colors[tile.building];
  if (tile.building === "farm") {
    for (let i = 0; i < 3; i += 1) ctx.fillRect(x + 10 + i * 6, y + 10, 2, 13);
  } else if (tile.building === "mine") {
    ctx.beginPath();
    ctx.moveTo(centerX, y + 11);
    ctx.lineTo(x + 22, centerY);
    ctx.lineTo(centerX, y + 22);
    ctx.lineTo(x + 10, centerY);
    ctx.closePath();
    ctx.fill();
  } else if (tile.building === "extractor") {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (tile.building === "housing") {
    ctx.fillRect(x + 11, y + 10, 11, 12);
    ctx.fillStyle = "#0c1114";
    ctx.fillRect(x + 14, y + 15, 5, 7);
  }
}

function drawFaction(faction) {
  const x = faction.x * TILE_SIZE + TILE_SIZE / 2;
  const y = faction.y * TILE_SIZE + TILE_SIZE / 2;
  ctx.fillStyle = "rgba(8, 10, 13, 0.8)";
  ctx.strokeStyle = faction.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x + 8, y + 8);
  ctx.lineTo(x - 8, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = faction.color;
  ctx.fillRect(x - 1, y - 6, 2, 9);
}

function drawRaider(raider) {
  const x = raider.x * TILE_SIZE + TILE_SIZE / 2;
  const y = raider.y * TILE_SIZE + TILE_SIZE / 2;
  ctx.fillStyle = "#d36a61";
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0c1114";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 3);
  ctx.lineTo(x + 3, y + 3);
  ctx.moveTo(x + 3, y - 3);
  ctx.lineTo(x - 3, y + 3);
  ctx.stroke();
}

function drawSelection(tile, color = "#ed8d42") {
  if (!tile) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(tile.x * TILE_SIZE + 2, tile.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  ctx.setLineDash([]);
}

function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.tiles.forEach((tile) => { drawTerrain(tile); drawResource(tile); drawBuilding(tile); });
  state.factions.forEach(drawFaction);
  state.raiders.forEach(drawRaider);
  drawSelection(getTile(state.selected.x, state.selected.y));
  drawSelection(state.hover ? getTile(state.hover.x, state.hover.y) : null, "rgba(229, 231, 232, 0.7)");
}

function renderResources() {
  Object.keys(RESOURCE_LABELS).forEach((resource) => {
    document.querySelector(`#${resource}-value`).textContent = formatNumber(state.resources[resource]);
    const rate = state.lastProduction[resource];
    const rateElement = document.querySelector(`#${resource}-rate`);
    rateElement.textContent = `${rate >= 0 ? "+" : ""}${rate} / cycle`;
  });
  document.querySelector("#population-label").textContent = `${state.population.current} / ${state.population.max}`;
  document.querySelector("#population-meter").style.width = `${Math.min(100, state.population.current / state.population.max * 100)}%`;
  document.querySelector("#morale-label").textContent = `${state.population.morale}%`;
  document.querySelector("#morale-meter").style.width = `${state.population.morale}%`;
  document.querySelector("#integrity-label").textContent = `${state.coreIntegrity}%`;
  document.querySelector("#integrity-meter").style.width = `${state.coreIntegrity}%`;

  const seconds = Math.floor(state.tick / 2);
  document.querySelector("#clock-label").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  document.querySelector("#cycle-label").textContent = `CYCLE ${String(Math.floor(state.tick / 2) + 1).padStart(3, "0")}`;
  document.querySelector("#seed-label").textContent = state.seed;
  document.querySelector("#run-status").textContent = state.gameOver ? "CORE FAILURE" : state.speed === 0 ? "PAUSED" : "LIVE";
  document.querySelector("#status-dot").className = `status-dot${state.gameOver ? " dead" : state.speed === 0 ? " paused" : ""}`;

  const threat = state.raiders.length + state.factions.filter((faction) => distance(faction, { x: 15, y: 10 }) < 11).length;
  const threatLabel = document.querySelector("#threat-label");
  threatLabel.textContent = threat >= 5 ? "THREAT CRITICAL" : threat >= 2 ? "THREAT ELEVATED" : "THREAT LOW";
  threatLabel.style.color = threat >= 5 ? "#d36a61" : threat >= 2 ? "#ed8d42" : "#9fc36b";
}

function renderBuildList() {
  const list = document.querySelector("#build-list");
  list.innerHTML = "";
  Object.entries(BUILDINGS).forEach(([buildingKey, building]) => {
    const button = document.createElement("button");
    button.className = `build-button${state.buildMode === buildingKey ? " selected" : ""}`;
    button.dataset.build = buildingKey;
    button.innerHTML = `<strong>${building.short} / ${building.label}</strong><small>${formatCost(building.cost)}<br>${building.description}</small>`;
    button.disabled = state.gameOver;
    button.addEventListener("click", () => {
      state.buildMode = state.buildMode === buildingKey ? null : buildingKey;
      render();
    });
    list.appendChild(button);
  });
  const modeLabel = document.querySelector("#build-mode-label");
  modeLabel.textContent = state.buildMode ? `PLACE ${BUILDINGS[state.buildMode].short}` : "SELECT TILE";
  modeLabel.classList.toggle("armed", Boolean(state.buildMode));
}

function renderSelectedTile() {
  const tile = getTile(state.selected.x, state.selected.y);
  const coords = document.querySelector("#selected-coordinates");
  const content = document.querySelector("#selected-tile-content");
  if (!tile) {
    coords.textContent = "-- : --";
    content.innerHTML = "<strong>No tile selected</strong><p>Click the frontier grid to inspect terrain and available resources.</p>";
    return;
  }
  coords.textContent = `${String(tile.x + 1).padStart(2, "0")} : ${String(tile.y + 1).padStart(2, "0")}`;
  const building = tile.building === "hub" ? { label: "Command core", description: "The settlement’s last line of continuity." } : BUILDINGS[tile.building];
  const resource = tile.resource ? RESOURCE_LABELS[tile.resource] : "None detected";
  content.innerHTML = `
    <strong>${building ? building.label : TERRAIN[tile.terrain].label}</strong>
    <p>${building ? building.description : `Terrain movement cost: ${TERRAIN[tile.terrain].movement}. ${tile.resource ? `${resource} signal detected.` : "No strategic resource detected."}`}</p>
    <div class="tile-stats">
      <div class="tile-stat"><span>TERRAIN</span><strong>${TERRAIN[tile.terrain].label.toUpperCase()}</strong></div>
      <div class="tile-stat"><span>RESOURCE</span><strong>${resource.toUpperCase()}</strong></div>
    </div>`;
}

function renderLog() {
  const log = document.querySelector("#event-log");
  log.innerHTML = state.log.map((event) => `<div class="event event-${event.type}"><time>CYCLE ${String(Math.floor(event.tick / 2) + 1).padStart(3, "0")}</time>${event.message}</div>`).join("");
}

function render() {
  renderCanvas();
  renderResources();
  renderBuildList();
  renderSelectedTile();
  renderLog();
}

function newWorld() {
  state = generateWorld(makeSeed());
  tickAccumulator = 0;
  render();
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  addLog("Local save written to this browser.", "system");
  render();
}

function loadGame() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) {
    addLog("No local save found in this browser.", "warning");
    render();
    return;
  }
  try {
    const loaded = JSON.parse(saved);
    if (loaded.version !== 1 || !Array.isArray(loaded.tiles)) throw new Error("Invalid save");
    state = loaded;
    addLog("Local save restored.", "system");
    render();
  } catch {
    addLog("Save data is unreadable. The basin remains untouched.", "warning");
    render();
  }
}

function canvasTileFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - rect.left) / rect.width * COLS),
    y: Math.floor((event.clientY - rect.top) / rect.height * ROWS),
  };
}

canvas.addEventListener("mousemove", (event) => {
  state.hover = canvasTileFromEvent(event);
  renderCanvas();
});

canvas.addEventListener("mouseleave", () => {
  state.hover = null;
  renderCanvas();
});

canvas.addEventListener("click", (event) => {
  const tile = canvasTileFromEvent(event);
  if (!getTile(tile.x, tile.y)) return;
  state.selected = tile;
  if (state.buildMode) attemptBuild(state.buildMode);
  else render();
});

document.querySelectorAll(".speed-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.speed = Number(button.dataset.speed);
    document.querySelectorAll(".speed-button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

document.querySelector("#new-world-button").addEventListener("click", () => {
  if (window.confirm("Generate a new basin? The current unsaved run will be lost.")) newWorld();
});
document.querySelector("#save-button").addEventListener("click", saveGame);
document.querySelector("#load-button").addEventListener("click", loadGame);

function frame(now) {
  const delta = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  tickAccumulator += delta * state.speed;
  while (tickAccumulator >= 0.5) {
    simulationTick();
    tickAccumulator -= 0.5;
  }
  renderCanvas();
  renderResources();
  renderLog();
  requestAnimationFrame(frame);
}

newWorld();
requestAnimationFrame(frame);
