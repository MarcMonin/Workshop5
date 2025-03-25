import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  //Node State Setup
  let state: NodeState = {
    killed: false,
    x: isFaulty? null: initialValue,
    decided: isFaulty? null: false,
    k:  isFaulty? null:0,
  };

  let MessagePhase1 : {k : number, x: Value}[] = [];
  let MessagePhase2 : {k : number, x: Value}[] = [];



  ////////////
  // BEN-OR //
  ////////////


  async function sendVote(phase: number, k: number, x: Value) {
    if (isFaulty || state.killed) {
      return;
    }
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        const NODE_PORT=BASE_NODE_PORT + i;
        promises.push(
        fetch(`http://localhost:${NODE_PORT}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({phase, k, x}),
        }));
      }
    }
    await Promise.all(promises);

  }



  async function Consensus() {
    if (isFaulty || state.killed) {
      return;
    }

    // Phase 1: Send vote
    await sendVote(1, state.k!, state.x!); 
    let phase1Messages = MessagePhase1.filter(m => m.k === state.k);
    let counts1 = {0:0, 1:0};

    // Tally up the votes for phase 1
    phase1Messages.forEach(m => { 
      if (m.x === 0 || m.x === 1) { 
        counts1[m.x]++; 
      }
    });

    let proposition: Value;
    let threshold = Math.floor((N + 1) / 2);
    
    if (counts1[1] >= threshold) {
      proposition = 1;
    } else if (counts1[0] >= threshold) {
      proposition = 0;
    } else {
      proposition = 1;
    }

    // Phase 2: Send proposition vote
    await sendVote(2, state.k!, proposition);

    let phase2Messages = MessagePhase2.filter(m => m.k === state.k);
    const counts2 = {0: 0, 1: 0};

    // Tally up the votes for phase 2
    phase2Messages.forEach(m => {  
      if (m.x === 0 || m.x === 1) {
        counts2[m.x]++;
      }
    });
    threshold = Math.ceil((N - F) / 2);

    // Determine final value based on votes
    if (F * 2 < N) {
      if (counts2[1] >= threshold) {
        state.x = 1;
        state.decided = true;
      } else if (counts2[0] >= threshold) {
        state.x = 0;
        state.decided = true;
      } else {
        state.x = proposition;
        state.decided = state.k! >= 1;
      }
    } else {
      state.x = proposition;
      state.decided = false;
    }

    state.k!++;

    // If not decided, continue to the next round
    if (!state.decided) {
      setImmediate(Consensus);
    }
}





  ////////////
  // ROUTES //
  ////////////



  // Status Route
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });


  // Message Route
node.post("/message", (req, res) => {
  if (state.killed || isFaulty) {
    return res.status(500).send("node not working");
  }
  const { value, phase, round } = req.body;
  if (phase === 1) {
    MessagePhase1.push({ k: round, x: value });  
  } else if (phase === 2) {
    MessagePhase2.push({ k: round, x: value }); 
  } else {
    return res.status(400).send("Invalid phase value");  
  }
  return res.status(200).send("message received");
});


  //Start Route
  node.get("/start", async (req, res) => {
    if (isFaulty) {
      res.status(400).send("Node is Faulty");
      return
    } 
    MessagePhase1 = [];
    MessagePhase2 = [];
    state.k = 0;
    state.x = initialValue;
    state.decided = false;
    setTimeout(Consensus,90);
    res.json({started: true});
  });

  //Stop Route
  node.get("/stop", async (req, res) => {
    if(state.killed){
      return res.status(400).send(" already killed");
    }
    state.killed = true;
    return res.status(200).send("stopped");
  });


  //GetState Route
  node.get("/getState", (req, res) => {
    res.status(200).json(state).send();
  });
  const NODE_PORT = BASE_NODE_PORT + nodeId;
  const server = node.listen(NODE_PORT, async () => {
    console.log(
      `Node ${nodeId} : listening on port ${NODE_PORT}`
    );
    setNodeIsReady(nodeId);
  });

  return server;
}
