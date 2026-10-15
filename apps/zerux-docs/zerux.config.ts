import type { ZeruxConfig } from 'zeruxjs'

const zeruxConfig: ZeruxConfig = {
    "type": "fix",
    "devtools": {
        "modules": [
            "sample-module"
        ]
    },
    "allowedDomains": ["zerux.shubkb.me"],
    "allowedDevDomain": "zdev.shubkb.me"
}

export default zeruxConfig;
