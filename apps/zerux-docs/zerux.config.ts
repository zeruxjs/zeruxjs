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
        "default": "something"
    }
}

export default zeruxConfig;
