import type { ZeruxConfig } from 'zeruxjs'
import { createServerLifecycleHooks } from '@zeruxjs/hooks/lifecycle'

const zeruxConfig: ZeruxConfig = {
    "type": "fix",
    server: { portless: process.env.ENABLE_PORTLESS_PROXY === "true", watchIgnoredPaths: [".workspace"] },
    lifecycleHooks: createServerLifecycleHooks(),
    "connectorManager": "@zeruxjs/db",
    "worker": {
        "minThreads": 1,
        "maxThreads": 4
    },
    "devtools": {
        "modules": [
            // "sample-module",
            // "sample-os",
            "sample-child",
            "sample-parent",
            // "sample-multi-section-module"
        ]
    },
    "allowedDomains": ["zerux.shubkb.me"],
    "allowedDevDomain": "zdev.shubkb.me",
    ...(process.env.ENABLE_MYSQL_DEMO === "true" ? { "db": {
        "default": "something",
        "connections": [
            {
                "name": "Something",
                "slug": "something",
                "connector": "@zeruxjs/db-mysql",
                "options": {
                    "host": process.env.DB_HOST,
                    "username": process.env.DB_USER,
                    "password": process.env.DB_PASSWORD,
                    "database": process.env.DB_NAME,
                    "port": Number(process.env.DB_PORT) || 3306,
                    "prefix": process.env.DB_PREFIX,
                    "polling": true,
                    "pollingInterval": 1000,
                }
            }
        ]
    }
    } : {})
};

export default zeruxConfig;
