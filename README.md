# Morrigan
_**Note:** Morrigan is an experimental project. It is not feature complete or audited for security._

The goal of Morrigan is to create a platform-independent, scalable and extendable solution for device administration and management.

**Platform independence:** Both the server and the client are designed to run in Node.js, and should not rely on OS specific functionality.

**Fault tolerance:** The server is intended to run as a peer in a cluster. Authentication and client state should remain valid across all server instances, so if a server goes down you just need to reconnect to another server and carry on where you left off.

**Scalability:** If you need more servers you can simply reuse existing settings when spinning up a new server/instance.

**Extendability:** The capabilities of the server and client sides of the system can be extended using providers.

## What Morrigan is NOT
The morrigan server does not provide a visual front-end, only a REST API and WebSocket message API.
