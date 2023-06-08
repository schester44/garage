const { createLogger, transports, format, Logger } = require("winston");
const LokiTransport = require("winston-loki");


const logger = createLogger({
  transports: [
    new LokiTransport({
      host: "http://loki.bread.sh",
      labels: { app: "garage-door" },
      json: true,
      format: format.json(),
    }),
    new transports.Console({
      format: format.combine(format.simple(), format.colorize())
    })
  ]
});

module.exports = { logger }
