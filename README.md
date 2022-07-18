# Morrigan
_**Note:** Morrigan is an experimental project. It is not feature complete or audited for security._

The goal of Morrigan is to create a platform-independent, scalable and extendable solution for device administration and management.

**Platform independence:** Both the server and the client are designed to run in Node.js, and should not rely on OS specific functionality.

**Fault tolerance:** The server is intended to run as a peer in a cluster. Authentication and client state should remain valid across all server instances, so if a server goes down you just need to reconnect to another server and carry on where you left off.

**Scalability:** If you need more servers you can simply reuse existing settings when spinning up a new server/instance.

**Extendability:** The capabilities of the server and client sides of the system can be extended using components and providers.

## Components & Providers
Morrigan uses Components to define server functionality, and each component is then expetcted to load providers that further define it's functionality.

### Components
Components are modules that exports a setup method:
```
setup(name, specification, router, environment)
```

Which should accept the following arguments:
- name: The name used to register the component in the component specifications (see server.settings)
- specification: The component specification. This can be used to quickly access component-specific settings.
- router: Express router to define routes on if necessary. This router will be mounted under `/${name}/` on the server.
- environment: The server environment under which the component should run. Contains the following keys:
  - db: The MongoDB database used by the server (using the 'mongodb' module's Db object, see https://mongodb.github.io/node-mongodb-native/3.7/api/Db.html).
  - info: Server info object.
  - log: Logging function (`log(message, level)`).
  - settings: The full settings object as passed to the server constructor function.

## What Morrigan is NOT
The morrigan server does not provide a visual front-end, only a REST API and WebSocket message API.
