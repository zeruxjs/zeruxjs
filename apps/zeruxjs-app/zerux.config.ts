import type { ZeruxConfig } from 'zeruxjs'

const zeruxConfig: ZeruxConfig = {
    "type": "fix",
    "connectorManager": "@zeruxjs/db",
    "devtools": {
        "modules": [
            "sample-module",
            "sample-os"
        ]
    },
    "allowedDomains": ["zerux.shubkb.me"],
    "allowedDevDomain": "zdev.shubkb.me",
    "db": {
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
    },
    "apiKeys": {
        "lighthouse": process.env.LIGHTHOUSE_API_KEY
    }
};

export default zeruxConfig;
