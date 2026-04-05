import type { ZeruxConfig } from '@zeruxjs/core'

const zeruxConfig: ZeruxConfig = {
    "type": "fix",
    "database": {
        "default": "something",
        "connections": [
            {
                "name": "Something",
                "slug": "something",
                "connecter": "@zeruxjs/mongo",
                "options": {
                    "key_1": "KEY_1_VALUE",
                    "key_2": "KEY_2_VALUE"
                }
            }
        ]
    }
}

export default zeruxConfig;