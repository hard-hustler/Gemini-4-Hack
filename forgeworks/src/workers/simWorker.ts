import { FactorySimulation } from '../engine/simulation';
import { SimSpeed, WorkerCommand, WorkerResponse } from '../types/factory';

let sim = new FactorySimulation();
let speed: SimSpeed = 1;
let lastBroadcast = 0;

function postMsg(msg: WorkerResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, { transfer });
  } else {
    self.postMessage(msg);
  }
}

function broadcastSnapshot() {
  const snapshot = sim.buildSnapshot();
  postMsg({ type: 'SNAPSHOT', snapshot }, [snapshot.itemRenderBuffer.buffer]);
}

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  switch (cmd.type) {
    case 'INIT': {
      sim = new FactorySimulation(cmd.serialized);
      postMsg({ type: 'READY', resources: sim.getResources() });
      broadcastSnapshot();
      break;
    }
    case 'SET_SPEED': {
      speed = cmd.speed;
      break;
    }
    case 'PLACE_ENTITIES': {
      const res = sim.placeEntities(cmd.placements);
      if (!res.ok && res.reason) {
        postMsg({ type: 'ACTION_REJECTED', reason: res.reason });
      }
      broadcastSnapshot();
      break;
    }
    case 'REMOVE_ENTITIES': {
      sim.removeEntities(cmd.coords);
      broadcastSnapshot();
      break;
    }
    case 'SET_RECIPE': {
      sim.setRecipe(cmd.machineId, cmd.recipeId);
      broadcastSnapshot();
      break;
    }
    case 'TOGGLE_CORNER_FLIP': {
      sim.toggleCornerFlip(cmd.machineId);
      broadcastSnapshot();
      break;
    }
    case 'UNLOCK_TECH': {
      const res = sim.unlockTech(cmd.techId);
      if (!res.ok && res.reason) {
        postMsg({ type: 'ACTION_REJECTED', reason: res.reason });
      }
      broadcastSnapshot();
      break;
    }
    case 'SPAWN_CONTRACT': {
      sim.spawnContract();
      broadcastSnapshot();
      break;
    }
    case 'SET_DAY_TIME': {
      sim.setDayTime(cmd.dayTime);
      broadcastSnapshot();
      break;
    }
    case 'REQUEST_EXPORT': {
      postMsg({ type: 'EXPORT_DATA', data: sim.exportSerialized() });
      break;
    }
  }
};

// Fixed 20 Hz simulation tick with sub-stepping for 2x / 5x / 20x speeds
setInterval(() => {
  if (speed > 0) {
    for (let i = 0; i < speed; i++) {
      sim.step();
    }
  }
  const now = performance.now();
  // Broadcast at 10 Hz while zero-copy Float32Array drives 3D items
  if (now - lastBroadcast >= 100) {
    lastBroadcast = now;
    broadcastSnapshot();
  }
}, 50);
