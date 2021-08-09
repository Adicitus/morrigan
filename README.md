# Morrigan
_**Note:** Morrigan is an experimental project. It is not feature complete or audited for security._

The goal of Morrigan is to create a platform-independent, scalable and extendable solution for device administration and management.

**Platform independence:** Both the server and the client are designed to run in Node.js, and should not rely on OS specific functionality.

**Scalability:** The server is intended to run as a peer in a cluster. Authentication and client state should remain valid across all server instances, so if a server goes down you just need to reconnect to another server and carry on where you left off.

**Extendability:** The capabilities of the server and client sides of the system can be extended using providers.
