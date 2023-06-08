const mqtt = require("mqtt");
const rpio = require("rpio");
const express = require("express");
const { logger } = require("./logger");


const app = express();

app.get('/heath', (_, res) => { res.send("ok") })

app.listen(3000, () => { log("web server is online. port 3000") })

let isInitialStart = true;


// possible states: open, opening, closing, closed, stopped
// click open, set to opening, toggle button, on sensor change, set to open
//

const client = mqtt.connect("mqtt://192.168.36.11:1883", {
  username: "mqtt",
  password: "mqtt",
});

rpio.init();

const doorContactPin = 18;
const relayPin = 7;

log(`using pin ${doorContactPin} for CONTACT`);
log(`using pin ${relayPin} for RELAY`);

const state = {
 open: "open",
 closed: "closed",
 closing: "closing",
 opening: "opening",
}

const topics = {
  command: "garage/door/set",
  availability: "garage/door/availability",
  state: "garage/door/state",
  toggle: "garage/door/toggle"
}

rpio.open(doorContactPin, rpio.INPUT, rpio.PULL_UP)

rpio.open(relayPin, rpio.OUTPUT, rpio.HIGH)

let currentState = getDoorState();
let lastDoorState = currentState;

client.on("connect", () => {
  log("Connected to MQTT server", "online", currentState);

  client.subscribe(topics.command);
  client.subscribe(topics.toggle);
  
  client.publish(topics.availability, "online");
  client.publish(topics.state, currentState);
  
  client.on("message", (topic, message) => {
   if (isInitialStart) {
    isInitialStart = false;
    return;
   }

    const data = message.toString()

   log(topic, topic === topics.toggle)
    if (topic === topics.toggle) {
    
      cancelFutureOpenStateUpdate();

      pressDoorButton(() => {
        if (currentState === state.closed) {
	 setState(state.opening);
	}

	if (currentState === state.open) {
	  setState(state.closing);
	}

	if (currentState === state.opening || currentState === state.closing) {
	  setState(state.open);
	}
      })
    }

    if (topic === topics.command) {
      const action = data
      const isInTransition = currentState === "opening" || currentState === "closing";

      if (action === "OPEN") {
        handleOpenRequest();
      }

      if (action === "CLOSE") {
        handleCloseRequest();
      }

      if (action === "STOP" && isInTransition) {
	log('handling STOP request');
	
	cancelFutureOpenStateUpdate();
	
	pressDoorButton(() => {
	  setState(state.open);
	});
      }
    }
  });
});

function setState(value) {
  log('Setting and publishing current state to', value);
  currentState = value;
  client.publish(topics.state, currentState);
}

const TIME_DOOR_TAKES_TO_OPEN = 10000;

let transitionTimer

function cancelFutureOpenStateUpdate() {
  if (transitionTimer) {
    log('Cancelling future open state update', transitionTimer.transactionId)
    clearTimeout(transitionTimer.timer);
  }
}



function handleOpenRequest() {
  if (currentState === state.open || currentState === state.opening) return;
  
  let transactionId = uuid = Math.random().toString(36).slice(-6);
		
  log('opening door', transactionId);

  pressDoorButton(() => {
    // currently closing but we want to open the door mid close, so the first button press stops the door, the second button press will open the door.
    if (currentState === state.closing) {
      pressDoorButton();
    }
    
    setState(state.opening);
  });
  
   const timer = setTimeout(() => {
    transitionTimer = null;
    setState(state.open);
    lastDoorState = state.open;
    log('door is open', transactionId)
  }, TIME_DOOR_TAKES_TO_OPEN);

  transitionTimer = { timer, transactionId }
}


function handleCloseRequest() {
  if (currentState === state.closed || currentState === state.closing) return;

  log('closing door');

  pressDoorButton(() => {
    if (currentState === state.opening) {
      cancelFutureOpenStateUpdate();
      pressDoorButton();
    }

    setState(state.closing);
  });
}


let inProgressDoorPress = null;

function pressDoorButton(cb) {
  if (inProgressDoorPress) {
    log('button pressed too fast. there is a door press already in progress')
    return;
  }

  rpio.write(relayPin, rpio.LOW);

  inProgressDoorPress = setTimeout(() => {
    rpio.write(relayPin, rpio.HIGH);
    inProgressDoorPress = null;

    if(cb) {
     cb();
    }
  }, 250);
}

function getDoorState() {
  return rpio.read(doorContactPin) ? state.open : state.closed;  
}

function log(...args) {
  logger.info(...args);
}


function pollContactPin() {
  const interval = setInterval(()=> {
    const doorState = getDoorState();
	  
    log('Status', { doorState, lastDoorState, currentState });

   if (doorState !== lastDoorState) {
     log(`Door status has changed from ${lastDoorState} to ${doorState}`);
     lastDoorState = doorState;
      
      // report closed here, we'll report open above, after a timeout since we dont know when the door is fully open.
      if (doorState === state.closed) {
        setState(state.closed);
      }
   }
  }, 1000);

  return () => clearInterval(interval);
}


pollContactPin();

process.on("exit", () => {
  client.publish(topics.availability, "offline");
});

process.on("SIGINT", () => {
  client.publish(topics.availability, "offline");

  process.exit();
});

process.on("uncaughtException", () => {
  client.publish(topics.availability, "offline");

  process.exit();
});

process.on("exit", () => {

  log("publishing offline")
  client.publish(topics.availability, "offline");
})
