const flags = {
    setupCalled: false,
    databaseProvided: false,
    collectionRetrievable: false,
    serverInfoProvided: false,
    logFunctionProvided: false,
    onShutdownCalled: false,
}

module.exports = {
    version: '1.0.0',
    name: 'testComponent',

    flags,

    setup: async (name, spec, router, environment) => {

        flags.setupCalled = true

        flags.databaseProvided = typeof environment.db === 'object'

        flags.serverInfoProvided = typeof environment.info === 'object'

        flags.logFunctionProvided = typeof environment.log === 'function'

        let collection = await environment.db.collection('morrigan.server.debug.testComponent')
        flags.collectionRetrievable = typeof collection === 'object'
        
        let handler = (req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.status(200)
            res.end(JSON.stringify({name, secret: spec.secret}))
        }

        handler.openapi = {
            get: {
                description: "Should return name and specification (spec) as a JSON object",
                responses: {
                    200: { $ref: '#/components/responses/morrigan.server.debug.reportObject' }
                }
            }
        }

        router.get('/', handler)
    },

    onShutdown: () => {
        flags.onShutdownCalled = true
    },

    openapi: {
        components: {
            schemas: {
                'morrigan.server.debug.componentSpec': {
                    description: "Component specification. Morrigan will try to load and configure a component based on the 'module' property. This object will be passed to the component via the component's 'setup' method.",
                    type: 'object',
                    required: [
                        'module'
                    ],
                    properties: {
                        module: {
                            oneOf: [
                                {
                                    description: "Name of a Node.js package that exports a component module.",
                                    type: 'string',
                                },
                                { $ref: '#/components/schemas/morrigan.server.debug.componentModule' }
                            ] 
                        }
                    }
                },
                'morrigan.server.debug.componentModule': {
                    description: "Loaded component object.",
                    type: 'object',
                    required: ['setup'],
                    properties: {
                        name: {
                            type: 'string',
                            pattern: '^[a-zA-z0-9\-_]+$',
                            description: "Intended name for this component. This will be overridden by the name in the component specification map.",
                            deprecated: true
                        },
                        version: {
                            description: "Semantic version of this module. If this isn't specified, Morrigan will attempt to get the version from the package.json version. This is mostly for testing, when you have a pre-loaded or non-package component.",
                            type: 'string',
                            pattern: '^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$',
                            deprecated: true
                        }
                    }
                }
            },
            responses: {
                'morrigan.server.debug.reportObject': {
                    description: "Name an specification object passed to the component by the core server.",
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: [
                                    'name',
                                    'secret'
                                ],
                                properties: {
                                    name: {
                                        description: "The name that the core server is using for this component. This may differ from the name declared by the component.",
                                        type: 'string',
                                        pattern: '^[0-9a-f]+$'
                                    },
                                    secret: {
                                        description: "The 'secret' property passed to the component via the ComponentSpec",
                                        type: 'string',
                                        pattern: '^[0-9a-f]+$'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}