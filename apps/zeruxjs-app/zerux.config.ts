import type { ZeruxConfig } from '@zeruxjs/core'

const zeruxConfig: ZeruxConfig = {
    "type": "fix",
    "devtools": {
        "modules": [
            "sample-module"
        ]
    },
    "allowedDomains": ["zerux.shubkb.me"],
    "allowedDevDomain": "zdev.shubkb.me",
    "database": {
        "default": "something",
        "connections": [
            {
                "name": "Something",
                "slug": "something",
                "connecter": "@zeruxjs/db-mysql",
                "options": {
                    "host": process.env.DB_HOST,
                    "username": process.env.DB_USER,
                    "password": process.env.DB_PASSWORD,
                    "database": process.env.DB_NAME,
                    "port": process.env.DB_PORT,
                    "prefix": process.env.DB_PREFIX,
                    "polling": true,
                    "pollingInterval": 1000,
                }
            }
        ]
    }
}

export default zeruxConfig;
