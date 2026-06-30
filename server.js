const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let tickets = [];

const services = [
  { id: "S1", prefix: "A", name: "Atención General", priority: false },
  { id: "S2", prefix: "C", name: "Caja y Pagos", priority: false },
  { id: "S3", prefix: "P", name: "Atención Preferencial", priority: true },
  { id: "S4", prefix: "E", name: "Trámites Especiales / Registro", priority: false }
];

// Cada módulo/oficina define qué letras puede llamar.
// Ejemplo:
// Caja llama C y P.
// Atención General llama A y P.
// Registro llama E y P.
const counters = [
  {
    id: "C1",
    name: "Caja 1",
    area: "Caja y Pagos",
    allowedPrefixes: ["C", "P"]
  },
  {
    id: "C2",
    name: "Caja 2",
    area: "Caja y Pagos",
    allowedPrefixes: ["C", "P"]
  },
  {
    id: "C3",
    name: "Módulo de Atención General",
    area: "Atención General",
    allowedPrefixes: ["A", "P"]
  },
  {
    id: "C4",
    name: "Módulo de Registro",
    area: "Trámites Especiales / Registro",
    allowedPrefixes: ["E", "P"]
  }
];

function sendState() {
  io.emit("state:update", { tickets, services, counters });
}

function getServiceByPrefix(prefix) {
  return services.find(s => s.prefix === prefix);
}

function sortTicketsByPriorityAndTime(a, b) {
  const serviceA = getServiceByPrefix(a.prefix);
  const serviceB = getServiceByPrefix(b.prefix);

  const priorityA = serviceA ? serviceA.priority : false;
  const priorityB = serviceB ? serviceB.priority : false;

  if (priorityA && !priorityB) return -1;
  if (!priorityA && priorityB) return 1;

  return new Date(a.createdAt) - new Date(b.createdAt);
}

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.emit("state:update", { tickets, services, counters });

  socket.on("ticket:create", ({ prefix, serviceName }) => {
    if (!prefix || !serviceName) return;

    const service = services.find(s => s.prefix === prefix);
    if (!service) {
      socket.emit("ticket:error", {
        message: "Servicio no válido."
      });
      return;
    }

    const count = tickets.filter(t => t.prefix === prefix).length + 1;

    const newTicket = {
      id: "T" + Date.now(),
      code: `${prefix}-${String(count).padStart(3, "0")}`,
      prefix,
      serviceName,
      status: "waiting",
      createdAt: new Date().toISOString(),
      calledAt: null,
      counterId: null,
      calledCount: 0
    };

    tickets.push(newTicket);

    sendState();
    socket.emit("ticket:created", newTicket);
  });

  socket.on("ticket:call-next", ({ activeCounterId }) => {
    const counter = counters.find(c => c.id === activeCounterId);

    if (!counter) {
      socket.emit("operator:no-pending-for-counter", {
        message: "El módulo seleccionado no existe."
      });
      return;
    }

    const allowedPrefixes = counter.allowedPrefixes || [];

    const pending = tickets
      .filter(t =>
        t.status === "waiting" &&
        allowedPrefixes.includes(t.prefix)
      )
      .sort(sortTicketsByPriorityAndTime);

    if (pending.length === 0) {
      socket.emit("operator:no-pending-for-counter", {
        message: `No hay turnos pendientes para ${counter.name}.`
      });
      return;
    }

    const ticket = pending[0];

    ticket.status = "called";
    ticket.calledAt = new Date().toISOString();
    ticket.counterId = activeCounterId;
    ticket.calledCount += 1;

    sendState();

    io.emit("ticket:called", { ticket, counter });
  });

  socket.on("ticket:recall", ({ activeCounterId }) => {
    const counter = counters.find(c => c.id === activeCounterId);
    if (!counter) return;

    const ticket = tickets.find(t =>
      t.status === "called" &&
      t.counterId === activeCounterId
    );

    if (!ticket) return;

    ticket.calledAt = new Date().toISOString();
    ticket.calledCount += 1;

    sendState();

    io.emit("ticket:called", { ticket, counter });
  });

  socket.on("ticket:no-show", ({ activeCounterId }) => {
    const ticket = tickets.find(t =>
      t.status === "called" &&
      t.counterId === activeCounterId
    );

    if (!ticket) return;

    ticket.status = "cancelled";
    sendState();
  });

  socket.on("ticket:complete", ({ activeCounterId }) => {
    const ticket = tickets.find(t =>
      t.status === "called" &&
      t.counterId === activeCounterId
    );

    if (!ticket) return;

    ticket.status = "completed";
    sendState();
  });

  socket.on("reset:all", () => {
    tickets = [];
    sendState();
  });
});

server.listen(3000, "0.0.0.0", () => {
  console.log("Servidor activo en http://localhost:3000");
});